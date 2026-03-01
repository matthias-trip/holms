import { runAdapter, type Adapter, type AdapterFactory, type CommandFieldDef, type RegistrationResult, type PropertyName } from "@holms/adapter-sdk";
import type { ISmartGateConfig, DoorInfo, EffectiveDoorStatus } from "./types.js";
import { ISmartGateClient } from "./api-client.js";

const TRANSITIONAL_TTL = 55_000; // 55 seconds
const DEFAULT_POLL_INTERVAL = 5_000;

interface TransitionalState {
  status: "opening" | "closing";
  expires: number;
}

export class ISmartGateAdapter implements Adapter {
  private client: ISmartGateClient;
  private pollInterval: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private doors: DoorInfo[] = [];
  private stateCache = new Map<string, Map<PropertyName, Record<string, unknown>>>();
  private transitional = new Map<number, TransitionalState>();

  constructor(config: Record<string, unknown>) {
    const cfg = config as unknown as ISmartGateConfig;
    if (!cfg.host || !cfg.username || !cfg.password) {
      throw new Error("iSmartGate adapter requires host, username, and password");
    }
    this.client = new ISmartGateClient(cfg.host, cfg.username, cfg.password);
    this.pollInterval = cfg.poll_interval ?? DEFAULT_POLL_INTERVAL;
  }

  async register(): Promise<RegistrationResult> {
    this.doors = await this.client.getInfo();

    const entities = this.doors
      .filter((d) => d.enabled && d.sensor)
      .map((door) => {
        const commandHints: Record<string, CommandFieldDef> = {
          open: { type: "boolean", description: "Open/close the door. Idempotent — no action if already in requested state." },
        };
        const properties: Array<{ property: PropertyName; features: string[]; commandHints?: Record<string, CommandFieldDef> }> = [
          { property: "access", features: ["cover"], commandHints },
        ];
        if (door.temperature !== null) {
          properties.push({ property: "climate", features: [] });
        }

        const entityId = `door_${door.id}`;

        // Cache initial state
        const stateMap = new Map<PropertyName, Record<string, unknown>>();
        stateMap.set("access", { open: this.resolveEffectiveStatus(door) !== "closed" });
        if (door.temperature !== null) {
          stateMap.set("climate", { current_temp: door.temperature });
        }
        this.stateCache.set(entityId, stateMap);

        return { entityId, properties };
      });

    return { entities };
  }

  async observe(entityId: string, property: PropertyName): Promise<Record<string, unknown>> {
    const doorId = this.parseDoorId(entityId);
    const doors = await this.client.getInfo();
    const door = doors.find((d) => d.id === doorId);
    if (!door) throw new Error(`Door ${doorId} not found`);

    const state = this.doorState(door, property);

    // Update cache
    const entityCache = this.stateCache.get(entityId) ?? new Map();
    entityCache.set(property, state);
    this.stateCache.set(entityId, entityCache);

    return state;
  }

  async execute(entityId: string, property: PropertyName, command: Record<string, unknown>): Promise<void> {
    if (property !== "access") throw new Error(`Property ${property} is not writable`);

    const doorId = this.parseDoorId(entityId);
    const doors = await this.client.getInfo();
    const door = doors.find((d) => d.id === doorId);
    if (!door) throw new Error(`Door ${doorId} not found`);

    const effectiveStatus = this.resolveEffectiveStatus(door);
    const isCurrentlyOpen = effectiveStatus === "opened" || effectiveStatus === "opening";
    const wantOpen = command.open as boolean;

    if (wantOpen === isCurrentlyOpen) return; // no-op

    await this.client.activate(door.id, door.apicode);

    // Set transitional state
    this.transitional.set(door.id, {
      status: wantOpen ? "opening" : "closing",
      expires: Date.now() + TRANSITIONAL_TTL,
    });
  }

  async subscribe(
    cb: (entityId: string, property: PropertyName, state: Record<string, unknown>) => void,
  ): Promise<void> {
    this.pollTimer = setInterval(async () => {
      try {
        const doors = await this.client.getInfo();

        for (const door of doors) {
          if (!door.enabled || !door.sensor) continue;
          const entityId = `door_${door.id}`;

          // Clear expired transitional states or if API returns definitive state
          this.clearTransitionalIfNeeded(door);

          const accessState = this.doorState(door, "access");
          this.emitIfChanged(entityId, "access", accessState, cb);

          if (door.temperature !== null) {
            const climateState = this.doorState(door, "climate");
            this.emitIfChanged(entityId, "climate", climateState, cb);
          }
        }
      } catch (err) {
        console.error("Poll error:", err instanceof Error ? err.message : String(err));
      }
    }, this.pollInterval);
  }

  async ping(): Promise<boolean> {
    return this.client.ping();
  }

  async destroy(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.stateCache.clear();
    this.transitional.clear();
  }

  // ── Private Helpers ─────────────────────────────────────────────────────

  private parseDoorId(entityId: string): number {
    const match = entityId.match(/^door_(\d+)$/);
    if (!match) throw new Error(`Invalid entity ID: ${entityId}`);
    return parseInt(match[1]!, 10);
  }

  private resolveEffectiveStatus(door: DoorInfo): EffectiveDoorStatus {
    const trans = this.transitional.get(door.id);
    if (trans && Date.now() < trans.expires) {
      return trans.status;
    }
    return door.status;
  }

  private clearTransitionalIfNeeded(door: DoorInfo): void {
    const trans = this.transitional.get(door.id);
    if (!trans) return;

    if (Date.now() >= trans.expires) {
      this.transitional.delete(door.id);
      return;
    }

    // If API returns a definitive state that differs from what we're transitioning to,
    // clear the override (e.g., transitioning to "opening" but API says "closed" still — keep override;
    // transitioning to "opening" but API says "opened" — clear, we're done)
    const targetState = trans.status === "opening" ? "opened" : "closed";
    if (door.status === targetState) {
      this.transitional.delete(door.id);
    }
  }

  private doorState(door: DoorInfo, property: PropertyName): Record<string, unknown> {
    if (property === "access") {
      const effective = this.resolveEffectiveStatus(door);
      return { open: effective === "opened" || effective === "opening" };
    }
    if (property === "climate") {
      return { current_temp: door.temperature };
    }
    throw new Error(`Unknown property: ${property}`);
  }

  private emitIfChanged(
    entityId: string,
    property: PropertyName,
    state: Record<string, unknown>,
    cb: (entityId: string, property: PropertyName, state: Record<string, unknown>) => void,
  ): void {
    const entityCache = this.stateCache.get(entityId) ?? new Map();
    const previous = entityCache.get(property);

    if (JSON.stringify(state) === JSON.stringify(previous)) return;

    entityCache.set(property, state);
    this.stateCache.set(entityId, entityCache);
    cb(entityId, property, state);
  }
}

const factory: AdapterFactory = (config) => new ISmartGateAdapter(config);
export default factory;

runAdapter(factory);
