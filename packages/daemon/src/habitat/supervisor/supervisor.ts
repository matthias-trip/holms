import { AdapterHandle, type StateChangeHandler, type AdapterLogEntry } from "./adapter-handle.js";
import type { EntityRegistration, EntityGroup } from "./ipc-protocol.js";
import type { AdapterConfig, AdapterHealth, PropertyName } from "../types.js";
import type { AdapterRegistry } from "./adapter-registry.js";
import type { SecretStore } from "../secret-store.js";

interface ManagedAdapter {
  handle: AdapterHandle;
  config: AdapterConfig;
  health: AdapterHealth;
  entities: EntityRegistration[];
  groups: EntityGroup[];
  pingInterval: ReturnType<typeof setInterval> | null;
  consecutiveFailures: number;
  restartCount: number;
  backoffMs: number;
}

const PING_INTERVAL = 30_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const MIN_BACKOFF = 2_000;
const MAX_BACKOFF = 60_000;

export class AdapterSupervisor {
  private adapters = new Map<string, ManagedAdapter>();
  private registry: AdapterRegistry;
  private onStateChange: StateChangeHandler;
  private onReachabilityChange: (adapterId: string, reachable: boolean) => void;
  private onEntityRegistration: (
    adapterId: string,
    entities: EntityRegistration[],
  ) => void;
  private onLog?: (adapterId: string, entry: AdapterLogEntry) => void;
  private secretStore?: SecretStore;

  constructor(opts: {
    registry: AdapterRegistry;
    onStateChange: StateChangeHandler;
    onReachabilityChange: (adapterId: string, reachable: boolean) => void;
    onEntityRegistration: (adapterId: string, entities: EntityRegistration[]) => void;
    onLog?: (adapterId: string, entry: AdapterLogEntry) => void;
    secretStore?: SecretStore;
  }) {
    this.registry = opts.registry;
    this.onStateChange = opts.onStateChange;
    this.onReachabilityChange = opts.onReachabilityChange;
    this.onEntityRegistration = opts.onEntityRegistration;
    this.onLog = opts.onLog;
    this.secretStore = opts.secretStore;
  }

  async startAdapter(config: AdapterConfig): Promise<void> {
    if (this.adapters.has(config.id)) {
      await this.stopAdapter(config.id);
    }

    const modulePath = this.registry.resolve(config.type);
    const handle = this.createHandle(config.id, config.type, modulePath, config.config);

    const managed: ManagedAdapter = {
      handle,
      config,
      entities: [],
      groups: [],
      health: {
        id: config.id,
        type: config.type,
        status: "stopped",
        entityCount: 0,
        restartCount: 0,
      },
      pingInterval: null,
      consecutiveFailures: 0,
      restartCount: 0,
      backoffMs: MIN_BACKOFF,
    };

    this.adapters.set(config.id, managed);
    await this.boot(managed);
  }

  async stopAdapter(id: string): Promise<void> {
    const managed = this.adapters.get(id);
    if (!managed) return;

    if (managed.pingInterval) clearInterval(managed.pingInterval);
    await managed.handle.stop();
    managed.health.status = "stopped";
    this.adapters.delete(id);
    this.onReachabilityChange(id, false);
  }

  async stopAll(): Promise<void> {
    const stops = Array.from(this.adapters.keys()).map((id) => this.stopAdapter(id));
    await Promise.allSettled(stops);
  }

  getRegistry(): AdapterRegistry {
    return this.registry;
  }

  getHealth(): AdapterHealth[] {
    return Array.from(this.adapters.values()).map((m) => ({
      ...m.health,
      pid: m.handle.pid,
    }));
  }

  getAdapterHealth(id: string): AdapterHealth | undefined {
    const managed = this.adapters.get(id);
    return managed ? { ...managed.health, pid: managed.handle.pid } : undefined;
  }

  getRunningAdapterIds(): string[] {
    return Array.from(this.adapters.entries())
      .filter(([, m]) => m.health.status === "running")
      .map(([id]) => id);
  }

  /** Get the raw entity registrations for an adapter (populated at boot time). */
  getAdapterEntities(id: string): EntityRegistration[] {
    return this.adapters.get(id)?.entities ?? [];
  }

  /** Get the entity groups reported by an adapter (rooms, zones, areas). */
  getAdapterGroups(id: string): EntityGroup[] {
    return this.adapters.get(id)?.groups ?? [];
  }

  async restartAdapter(id: string): Promise<void> {
    const managed = this.adapters.get(id);
    if (!managed) throw new Error(`Adapter ${id} not found`);

    if (managed.pingInterval) clearInterval(managed.pingInterval);
    managed.pingInterval = null;
    await managed.handle.stop();
    managed.health.status = "restarting";

    const modulePath = this.registry.resolve(managed.config.type);
    managed.handle = this.createHandle(managed.config.id, managed.config.type, modulePath, managed.config.config);
    await this.boot(managed);
  }

  getAdapterLogs(id: string): AdapterLogEntry[] {
    const managed = this.adapters.get(id);
    return managed ? managed.handle.getLogs() : [];
  }

  async observe(
    adapterId: string,
    entityId: string,
    property: PropertyName,
  ): Promise<Record<string, unknown>> {
    const managed = this.adapters.get(adapterId);
    if (!managed || !managed.handle.running) {
      throw new Error(`Adapter ${adapterId} is not running`);
    }
    return managed.handle.observe(entityId, property);
  }

  async execute(
    adapterId: string,
    entityId: string,
    property: PropertyName,
    command: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string }> {
    const managed = this.adapters.get(adapterId);
    if (!managed || !managed.handle.running) {
      return { success: false, error: `Adapter ${adapterId} is not running` };
    }
    return managed.handle.execute(entityId, property, command);
  }

  async query(
    adapterId: string,
    entityId: string,
    property: PropertyName,
    params: Record<string, unknown>,
  ): Promise<{ items: Record<string, unknown>[]; total?: number; truncated?: boolean }> {
    const managed = this.adapters.get(adapterId);
    if (!managed || !managed.handle.running) {
      throw new Error(`Adapter ${adapterId} is not running`);
    }
    return managed.handle.query(entityId, property, params);
  }

  async discover(
    adapterId: string,
    params: Record<string, unknown> = {},
  ): Promise<{
    gateways: Array<{ id: string; name: string; address: string; metadata?: Record<string, unknown> }>;
    message?: string;
  }> {
    const managed = this.adapters.get(adapterId);
    if (!managed || !managed.handle.running) {
      throw new Error(`Adapter ${adapterId} is not running`);
    }
    return managed.handle.discover(params);
  }

  async pair(
    adapterId: string,
    params: Record<string, unknown> = {},
  ): Promise<{
    success: boolean;
    credentials?: Record<string, unknown>;
    error?: string;
    message?: string;
  }> {
    const managed = this.adapters.get(adapterId);
    if (!managed || !managed.handle.running) {
      throw new Error(`Adapter ${adapterId} is not running`);
    }
    return managed.handle.pair(params);
  }

  /** Start an onboarding adapter process (empty config, lazy, for discover/pair) */
  async startOnboardingAdapter(type: string): Promise<void> {
    const onboardingId = `__onboarding_${type}`;
    if (this.adapters.has(onboardingId)) return; // already running

    const modulePath = this.registry.resolve(type);
    const handle = this.createHandle(onboardingId, type, modulePath, {});

    const managed: ManagedAdapter = {
      handle,
      config: { id: onboardingId, type, config: {} },
      entities: [],
      groups: [],
      health: {
        id: onboardingId,
        type,
        status: "stopped",
        entityCount: 0,
        restartCount: 0,
      },
      pingInterval: null,
      consecutiveFailures: 0,
      restartCount: 0,
      backoffMs: MIN_BACKOFF,
    };

    this.adapters.set(onboardingId, managed);
    await this.boot(managed);
  }

  /** Stop an onboarding adapter if running */
  async stopOnboardingAdapter(type: string): Promise<void> {
    const onboardingId = `__onboarding_${type}`;
    await this.stopAdapter(onboardingId);
  }

  /** Check if an onboarding adapter is running */
  hasOnboardingAdapter(type: string): boolean {
    const onboardingId = `__onboarding_${type}`;
    const managed = this.adapters.get(onboardingId);
    return managed?.handle.running === true;
  }

  private createHandle(adapterId: string, adapterType: string, modulePath: string, config: Record<string, unknown>): AdapterHandle {
    return new AdapterHandle(
      adapterId,
      adapterType,
      modulePath,
      config,
      this.onStateChange,
      this.onLog ? (entry) => this.onLog!(adapterId, entry) : undefined,
      this.secretStore,
    );
  }

  private async boot(managed: ManagedAdapter): Promise<void> {
    managed.health.status = managed.restartCount > 0 ? "restarting" : "running";

    try {
      const { entities, groups } = await managed.handle.start();
      managed.health.status = "running";
      managed.health.entityCount = entities.length;
      managed.entities = entities;
      managed.groups = groups;
      managed.health.lastPing = Date.now();
      managed.consecutiveFailures = 0;
      managed.backoffMs = MIN_BACKOFF;

      this.onReachabilityChange(managed.config.id, true);
      this.onEntityRegistration(managed.config.id, entities);
      this.startPinging(managed);
    } catch (err) {
      console.error(
        `[supervisor] Failed to boot adapter ${managed.config.id}:`,
        err instanceof Error ? err.message : err,
      );
      managed.health.status = "crashed";
      this.onReachabilityChange(managed.config.id, false);
      this.scheduleRestart(managed);
    }
  }

  private startPinging(managed: ManagedAdapter): void {
    if (managed.pingInterval) clearInterval(managed.pingInterval);

    managed.pingInterval = setInterval(async () => {
      const ok = await managed.handle.ping();
      if (ok) {
        managed.consecutiveFailures = 0;
        managed.health.lastPing = Date.now();
      } else {
        managed.consecutiveFailures++;
        console.warn(
          `[supervisor] Adapter ${managed.config.id} ping failed (${managed.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`,
        );
        if (managed.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.error(`[supervisor] Adapter ${managed.config.id} unresponsive, restarting...`);
          if (managed.pingInterval) clearInterval(managed.pingInterval);
          managed.health.status = "crashed";
          this.onReachabilityChange(managed.config.id, false);
          await managed.handle.stop();
          this.scheduleRestart(managed);
        }
      }
    }, PING_INTERVAL);
  }

  private scheduleRestart(managed: ManagedAdapter): void {
    const delay = managed.backoffMs;
    managed.backoffMs = Math.min(managed.backoffMs * 2, MAX_BACKOFF);
    managed.restartCount++;
    managed.health.restartCount = managed.restartCount;

    console.log(
      `[supervisor] Restarting adapter ${managed.config.id} in ${delay}ms (attempt ${managed.restartCount})`,
    );

    setTimeout(async () => {
      // Re-create the handle for a fresh child process
      const modulePath = this.registry.resolve(managed.config.type);
      managed.handle = this.createHandle(managed.config.id, managed.config.type, modulePath, managed.config.config);
      await this.boot(managed);
    }, delay);
  }
}
