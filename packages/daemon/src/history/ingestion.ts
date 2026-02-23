import type { DeviceEvent } from "@holms/shared";
import type { EventBus } from "../event-bus.js";
import type { DeviceManager } from "../devices/manager.js";
import type { HistoryStore, HistoryRow, CatalogEntry } from "./store.js";

interface IngestionConfig {
  flushIntervalMs: number;
  flushBatchSize: number;
  catalogRefreshMs: number;
  ingestionEpsilon: number;
  /** Min ms between stored rows per entity. Events arriving faster are dropped. Default 60s. */
  minStorageIntervalMs: number;
}

const BOOLEAN_TRUE = new Set(["on", "true", "open", "home"]);
const BOOLEAN_FALSE = new Set(["off", "false", "closed", "away"]);
const MAX_BUFFER_SIZE = 10_000;

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1.0 : 0.0;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (BOOLEAN_TRUE.has(lower)) return 1.0;
    if (BOOLEAN_FALSE.has(lower)) return 0.0;
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) return parsed;
  }
  return null;
}

function inferValueType(value: unknown): "numeric" | "categorical" | "boolean" {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "numeric";
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (BOOLEAN_TRUE.has(lower) || BOOLEAN_FALSE.has(lower)) return "boolean";
    if (!isNaN(parseFloat(value))) return "numeric";
  }
  return "categorical";
}

const UNIT_MAP: Record<string, Record<string, string>> = {
  key: {
    temperature: "°C",
    currenttemp: "°C",
    humidity: "%",
    brightness: "%",
    energy: "kWh",
    power: "W",
    voltage: "V",
    current: "A",
    battery: "%",
    pressure: "hPa",
    illuminance: "lx",
    speed: "m/s",
  },
  domain: {
    climate: "°C",
    sensor: "",
    light: "%",
  },
};

function inferUnit(key: string, domain: string): string {
  const lower = key.toLowerCase();
  for (const [pattern, unit] of Object.entries(UNIT_MAP.key)) {
    if (lower.includes(pattern)) return unit;
  }
  return UNIT_MAP.domain[domain] ?? "";
}

export class HistoryIngestion {
  private buffer: HistoryRow[] = [];
  private knownEntities = new Set<string>();
  private lastStoredValues = new Map<string, number>();
  private lastStoredAt = new Map<string, number>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private catalogTimer: ReturnType<typeof setInterval> | null = null;
  private listener: ((event: DeviceEvent) => void) | null = null;

  constructor(
    private store: HistoryStore,
    private eventBus: EventBus,
    private deviceManager: DeviceManager,
    private config: IngestionConfig,
  ) {}

  start(): void {
    // Seed knownEntities from catalog so we don't re-emit "entity_discovered" on restart
    this.store.getCatalog().then((entries) => {
      for (const entry of entries) {
        if (typeof entry.entity_id === "string") {
          this.knownEntities.add(entry.entity_id);
        }
      }
      console.log(`[History] Seeded ${this.knownEntities.size} known entities from catalog`);
    }).catch((err) => console.error("[History] Failed to seed known entities:", err));

    this.listener = (event) => this.handleEvent(event);
    this.eventBus.on("device:event", this.listener);

    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => console.error("[History] Flush error:", err));
    }, this.config.flushIntervalMs);

    this.catalogTimer = setInterval(() => {
      this.store.refreshCatalog().catch((err) =>
        console.error("[History] Catalog refresh error:", err),
      );
    }, this.config.catalogRefreshMs);

    console.log("[History] Ingestion started");
  }

  stop(): void {
    if (this.listener) {
      this.eventBus.off("device:event", this.listener);
      this.listener = null;
    }
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.catalogTimer) {
      clearInterval(this.catalogTimer);
      this.catalogTimer = null;
    }

    // Final flush (best-effort sync)
    this.flush().catch((err) => console.error("[History] Final flush error:", err));
  }

  private handleEvent(event: DeviceEvent): void {
    const now = new Date(event.timestamp);
    const domain = event.domain ?? "unknown";
    const area = event.area ?? "unknown";

    for (const [key, value] of Object.entries(event.data)) {
      if (value === undefined || value === null) continue;

      const entityId = `${event.deviceId}.${key}`;
      const valueNum = parseNumeric(value);
      const valueStr = String(value);

      // Storage throttle: at most one row per entity per minStorageIntervalMs.
      // Near-duplicate numeric values (within epsilon) are always dropped.
      const nowMs = event.timestamp;
      const lastTime = this.lastStoredAt.get(entityId) ?? 0;
      const elapsed = nowMs - lastTime;

      if (valueNum !== null) {
        const lastStored = this.lastStoredValues.get(entityId);
        // Always drop near-duplicates
        if (lastStored !== undefined && Math.abs(valueNum - lastStored) < this.config.ingestionEpsilon) {
          continue;
        }
        // Time throttle: even if value changed, cap storage rate
        if (elapsed < this.config.minStorageIntervalMs) {
          continue;
        }
        this.lastStoredValues.set(entityId, valueNum);
      } else {
        // Non-numeric: time-throttle only
        if (elapsed < this.config.minStorageIntervalMs) {
          continue;
        }
      }

      this.lastStoredAt.set(entityId, nowMs);

      this.buffer.push({
        entity_id: entityId,
        timestamp: now,
        value_num: valueNum,
        value_str: valueStr,
        domain,
        area,
      });

      // Catalog upsert on first-seen
      if (!this.knownEntities.has(entityId)) {
        this.knownEntities.add(entityId);
        const device = this.deviceManager.getCachedDevice(event.deviceId);
        const friendlyName = device
          ? `${device.name} — ${key}`
          : `${event.deviceId} — ${key}`;
        const valueType = inferValueType(value);

        this.eventBus.emit("history:entity_discovered", {
          entityId,
          friendlyName,
          domain,
          area,
          valueType,
          timestamp: event.timestamp,
        });

        this.store
          .upsertCatalog({
            entity_id: entityId,
            friendly_name: friendlyName,
            domain,
            area,
            unit: inferUnit(key, domain),
            value_type: inferValueType(value),
            first_seen: now,
            last_seen: now,
            sample_count: 1,
          })
          .catch((err) => console.error("[History] Catalog upsert error:", err));
      }
    }

    // Flush if buffer exceeds batch size
    if (this.buffer.length >= this.config.flushBatchSize) {
      this.flush().catch((err) => console.error("[History] Flush error:", err));
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0);
    try {
      await this.store.insertBatch(batch);
      this.eventBus.emit("history:flush", {
        rowCount: batch.length,
        entityCount: this.knownEntities.size,
        bufferSize: this.buffer.length,
        timestamp: Date.now(),
      });
    } catch (err) {
      // Re-queue on failure, capped to prevent memory blow-up
      if (this.buffer.length + batch.length <= MAX_BUFFER_SIZE) {
        this.buffer.unshift(...batch);
      }
      throw err;
    }
  }
}
