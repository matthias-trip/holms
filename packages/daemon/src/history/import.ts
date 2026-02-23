import type { DeviceManager } from "../devices/manager.js";
import type { EventBus } from "../event-bus.js";
import type { HistoryStore, HistoryRow } from "./store.js";
import { HomeAssistantProvider, normalizeState } from "../devices/providers/home-assistant.js";
import type { HassEntity } from "home-assistant-js-websocket";

export interface ImportProgress {
  deviceId: string;
  phase: "fetching" | "processing" | "deleting" | "inserting" | "cataloging" | "done" | "error";
  processed: number;
  total: number;
  message?: string;
}

// Re-use helpers from ingestion
const BOOLEAN_TRUE = new Set(["on", "true", "open", "home"]);
const BOOLEAN_FALSE = new Set(["off", "false", "closed", "away"]);

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
    temperature: "°C", currenttemp: "°C", humidity: "%", brightness: "%",
    energy: "kWh", power: "W", voltage: "V", current: "A",
    battery: "%", pressure: "hPa", illuminance: "lx", speed: "m/s",
  },
  domain: { climate: "°C", sensor: "", light: "%" },
};

function inferUnit(key: string, domain: string): string {
  const lower = key.toLowerCase();
  for (const [pattern, unit] of Object.entries(UNIT_MAP.key)) {
    if (lower.includes(pattern)) return unit;
  }
  return UNIT_MAP.domain[domain] ?? "";
}

/** Units that indicate monotonic counters — keep last value per bucket. */
const COUNTER_UNITS = new Set(["kwh", "wh", "mwh", "m³", "ft³", "gal", "l"]);

/** Parse a resolution string like "1m", "5m", "1h" into milliseconds. */
function parseResolution(res: string): number {
  const match = res.match(/^(\d+)(s|m|h)$/);
  if (!match) return 60_000; // default 1m
  const val = parseInt(match[1]!, 10);
  const unit = match[2]!;
  if (unit === "s") return val * 1000;
  if (unit === "m") return val * 60_000;
  return val * 3_600_000; // "h"
}

interface HAHistoryState {
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
}

/** Downsample raw HA history states into time buckets. */
function downsample(
  states: HAHistoryState[],
  resolutionMs: number,
  unitOfMeasurement?: string,
): HAHistoryState[] {
  if (states.length === 0 || resolutionMs <= 0) return states;

  const isCounter = unitOfMeasurement
    ? COUNTER_UNITS.has(unitOfMeasurement.toLowerCase())
    : false;

  // Group into buckets
  const buckets = new Map<number, HAHistoryState[]>();
  for (const s of states) {
    const ts = new Date(s.last_changed).getTime();
    const bucketKey = Math.floor(ts / resolutionMs) * resolutionMs;
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = [];
      buckets.set(bucketKey, bucket);
    }
    bucket.push(s);
  }

  // Reduce each bucket to a single state
  const result: HAHistoryState[] = [];
  for (const [bucketKey, bucket] of buckets) {
    if (isCounter) {
      // Monotonic counter: keep last value in bucket
      result.push(bucket[bucket.length - 1]!);
    } else {
      // Numeric average or first non-numeric
      const numericValues: number[] = [];
      for (const s of bucket) {
        const n = parseFloat(s.state);
        if (!isNaN(n)) numericValues.push(n);
      }
      if (numericValues.length > 0) {
        const avg = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
        const representative = bucket[Math.floor(bucket.length / 2)]!;
        result.push({
          ...representative,
          state: String(Math.round(avg * 1000) / 1000), // 3 decimal places
          last_changed: new Date(bucketKey + resolutionMs / 2).toISOString(),
        });
      } else {
        // Non-numeric: keep first entry per bucket
        result.push(bucket[0]!);
      }
    }
  }

  return result;
}

const BATCH_SIZE = 1000;

export async function importHAHistory(
  deviceId: string,
  days: number,
  deps: {
    deviceManager: DeviceManager;
    historyStore: HistoryStore;
    eventBus: EventBus;
  },
  options?: { resolution?: string },
): Promise<{ totalRows: number }> {
  const { deviceManager, historyStore, eventBus } = deps;

  const emitProgress = (progress: ImportProgress) => {
    eventBus.emit("history:import_progress", progress);
  };

  // Validate device exists
  const device = deviceManager.getCachedDevice(deviceId);
  if (!device) {
    throw new Error(`Device not found: ${deviceId}`);
  }

  // Validate it's an HA device
  if (!deviceId.startsWith("ha:")) {
    throw new Error(`Device is not from Home Assistant: ${deviceId}`);
  }

  // Get the HA provider
  const provider = deviceManager.getProviderByName("home_assistant") as HomeAssistantProvider | undefined;
  if (!provider) {
    throw new Error("Home Assistant provider is not connected");
  }

  const entityId = deviceId.replace(/^ha:/, "");
  const domain = entityId.split(".")[0]!;

  // 1. Fetch history from HA
  emitProgress({ deviceId, phase: "fetching", processed: 0, total: 0 });
  const history = await provider.fetchHistory(entityId, days);

  if (!history.length || !history[0]?.length) {
    emitProgress({ deviceId, phase: "done", processed: 0, total: 0, message: "No history data found" });
    return { totalRows: 0 };
  }

  const rawStates = history[0]!;

  // 1b. Downsample if resolution is specified
  const resolutionMs = parseResolution(options?.resolution ?? "1m");
  const unitOfMeasurement = rawStates[0]?.attributes?.unit_of_measurement as string | undefined;
  const states = resolutionMs > 0
    ? downsample(rawStates, resolutionMs, unitOfMeasurement)
    : rawStates;

  // 2. Normalize into HistoryRows
  emitProgress({ deviceId, phase: "processing", processed: 0, total: states.length });

  const rows: HistoryRow[] = [];
  const catalogKeys = new Map<string, { value: unknown; friendlyName: string }>();
  const area = device.area?.id ?? "unknown";

  for (let i = 0; i < states.length; i++) {
    const entry = states[i]!;

    // Build a minimal HassEntity-like object for normalizeState
    const fakeEntity = {
      state: entry.state,
      attributes: entry.attributes ?? {},
      entity_id: entityId,
      last_changed: entry.last_changed,
      last_updated: entry.last_changed,
      context: { id: "", user_id: null, parent_id: null },
    } as HassEntity;

    const normalized = normalizeState(domain, fakeEntity);
    const timestamp = new Date(entry.last_changed);

    for (const [key, value] of Object.entries(normalized.state)) {
      if (value === undefined || value === null) continue;

      const histEntityId = `${deviceId}.${key}`;
      const valueNum = parseNumeric(value);
      const valueStr = String(value);

      rows.push({
        entity_id: histEntityId,
        timestamp,
        value_num: valueNum,
        value_str: valueStr,
        domain,
        area,
      });

      if (!catalogKeys.has(key)) {
        catalogKeys.set(key, {
          value,
          friendlyName: `${device.name} — ${key}`,
        });
      }
    }

    if (i % 500 === 0) {
      emitProgress({ deviceId, phase: "processing", processed: i, total: states.length });
    }
  }

  // 3. Delete existing rows for this device in the time range (idempotent)
  emitProgress({ deviceId, phase: "deleting", processed: 0, total: rows.length });
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  await historyStore.deleteByEntityPrefix(`${deviceId}.`, start, end);

  // 4. Insert in batches
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await historyStore.insertBatch(batch);
    emitProgress({ deviceId, phase: "inserting", processed: Math.min(i + BATCH_SIZE, rows.length), total: rows.length });
  }

  // 5. Update catalog
  emitProgress({ deviceId, phase: "cataloging", processed: 0, total: catalogKeys.size });
  for (const [key, info] of catalogKeys) {
    const histEntityId = `${deviceId}.${key}`;
    await historyStore.upsertCatalog({
      entity_id: histEntityId,
      friendly_name: info.friendlyName,
      domain,
      area,
      unit: inferUnit(key, domain),
      value_type: inferValueType(info.value),
      first_seen: start,
      last_seen: end,
      sample_count: rows.filter((r) => r.entity_id === histEntityId).length,
    });
  }

  emitProgress({ deviceId, phase: "done", processed: rows.length, total: rows.length, message: `Imported ${rows.length} rows` });
  return { totalRows: rows.length };
}
