import type { Device, DeviceEvent, DeviceArea, DeviceDomain, CommandResult, DataQueryResult, DeviceProviderInfo } from "@holms/shared";
import type { DeviceProvider, DeviceProviderDescriptor } from "./types.js";
import type { DeviceProviderStore } from "./provider-store.js";

/** Sentinel value used to mask password fields in API responses */
export const PASSWORD_MASK = "••••••••";

export class DeviceManager {
  private providers: DeviceProvider[] = [];
  private listeners: Array<(event: DeviceEvent) => void> = [];
  private commandListeners: Array<(deviceId: string, command: string) => void> = [];
  private deviceCache = new Map<string, Device>();
  private descriptors = new Map<string, DeviceProviderDescriptor>();
  private providerStore: DeviceProviderStore | null;

  constructor(providerStore?: DeviceProviderStore) {
    this.providerStore = providerStore ?? null;
  }

  /** Register a descriptor (doesn't start the provider) */
  registerDescriptor(descriptor: DeviceProviderDescriptor): void {
    this.descriptors.set(descriptor.id, descriptor);
    console.log(`[DeviceManager] Registered descriptor: ${descriptor.displayName} (${descriptor.id})`);
  }

  /** Start providers that are enabled in the store with valid config */
  async startEnabledProviders(): Promise<void> {
    if (!this.providerStore) return;
    const configs = this.providerStore.getAllConfigs();

    for (const [id, { enabled, config }] of configs) {
      if (!enabled) continue;
      const descriptor = this.descriptors.get(id);
      if (!descriptor) continue;

      try {
        const errors = descriptor.validateConfig(config);
        if (errors) {
          console.warn(`[DeviceManager] Invalid config for ${id}:`, errors);
          descriptor.setStatus("error", `Invalid config: ${errors.join(", ")}`);
          continue;
        }

        const provider = descriptor.createProvider(config);
        this.registerProvider(provider);
        await provider.connect();
        descriptor.setStatus("connected");
        console.log(`[DeviceManager] Started provider: ${id}`);
      } catch (err: any) {
        console.error(`[DeviceManager] Failed to start ${id}:`, err);
        descriptor.setStatus("error", err.message);
      }
    }
  }

  /** Merge masked password sentinels back with stored originals */
  private mergePasswordFields(id: string, config: Record<string, unknown>): Record<string, unknown> {
    const descriptor = this.descriptors.get(id);
    if (!descriptor) return config;

    const stored = this.providerStore?.getConfig(id);
    if (!stored) return config;

    const merged = { ...config };
    for (const field of descriptor.getConfigFields()) {
      if (field.type === "password" && merged[field.key] === PASSWORD_MASK) {
        merged[field.key] = stored.config[field.key];
      }
    }
    return merged;
  }

  /** Enable a provider with given config */
  async enableProvider(id: string, config: Record<string, unknown>): Promise<void> {
    const descriptor = this.descriptors.get(id);
    if (!descriptor) throw new Error(`Unknown device provider: ${id}`);

    const merged = this.mergePasswordFields(id, config);

    const errors = descriptor.validateConfig(merged);
    if (errors) throw new Error(`Invalid config: ${errors.join(", ")}`);

    // Persist
    this.providerStore?.setConfig(id, true, merged);

    // Stop existing provider if running
    const existingIdx = this.providers.findIndex((p) => p.name === id);
    if (existingIdx !== -1) {
      await this.providers[existingIdx]!.disconnect();
      this.providers.splice(existingIdx, 1);
    }

    // Create and start
    try {
      const provider = descriptor.createProvider(merged);
      this.registerProvider(provider);
      await provider.connect();
      descriptor.setStatus("connected");
    } catch (err: any) {
      // Roll back
      this.providerStore?.setConfig(id, false, merged);
      descriptor.setStatus("error", err.message);
      throw err;
    }
  }

  /** Disable a provider */
  async disableProvider(id: string): Promise<void> {
    const descriptor = this.descriptors.get(id);
    if (!descriptor) throw new Error(`Unknown device provider: ${id}`);

    // Persist
    const existing = this.providerStore?.getConfig(id);
    this.providerStore?.setConfig(id, false, existing?.config ?? {});

    // Stop if running
    const idx = this.providers.findIndex((p) => p.name === id);
    if (idx !== -1) {
      await this.providers[idx]!.disconnect();
      this.providers.splice(idx, 1);
    }

    descriptor.setStatus("disconnected");
  }

  /** Update config for a provider, restart if enabled */
  async updateProviderConfig(id: string, config: Record<string, unknown>): Promise<void> {
    const descriptor = this.descriptors.get(id);
    if (!descriptor) throw new Error(`Unknown device provider: ${id}`);

    const merged = this.mergePasswordFields(id, config);

    const errors = descriptor.validateConfig(merged);
    if (errors) throw new Error(`Invalid config: ${errors.join(", ")}`);

    const existing = this.providerStore?.getConfig(id);
    const enabled = existing?.enabled ?? false;
    this.providerStore?.setConfig(id, enabled, merged);

    // Restart if enabled
    if (enabled) {
      const idx = this.providers.findIndex((p) => p.name === id);
      if (idx !== -1) {
        await this.providers[idx]!.disconnect();
        this.providers.splice(idx, 1);
      }

      try {
        const provider = descriptor.createProvider(merged);
        this.registerProvider(provider);
        await provider.connect();
        descriptor.setStatus("connected");
      } catch (err: any) {
        descriptor.setStatus("error", err.message);
        throw err;
      }
    }
  }

  /** Get info for all registered descriptors */
  getProviderInfos(): DeviceProviderInfo[] {
    const infos: DeviceProviderInfo[] = [];

    for (const descriptor of this.descriptors.values()) {
      const stored = this.providerStore?.getConfig(descriptor.id);
      const config = stored?.config ?? {};

      // Mask password fields
      const maskedConfig: Record<string, unknown> = {};
      for (const field of descriptor.getConfigFields()) {
        const value = config[field.key];
        if (field.type === "password" && typeof value === "string" && value.length > 0) {
          maskedConfig[field.key] = PASSWORD_MASK;
        } else {
          maskedConfig[field.key] = value;
        }
      }

      // Count devices from active provider
      let deviceCount = 0;
      const activeProvider = this.providers.find((p) => p.name === descriptor.id);
      if (activeProvider) {
        // We can't await here, so use cached count; 0 is fine initially
        activeProvider.getDevices().then((devices) => { deviceCount = devices.length; }).catch(() => {});
      }

      infos.push({
        id: descriptor.id,
        displayName: descriptor.displayName,
        description: descriptor.description,
        enabled: stored?.enabled ?? false,
        status: descriptor.getStatus(),
        statusMessage: descriptor.getStatusMessage(),
        configSchema: descriptor.getConfigFields(),
        config: maskedConfig,
        deviceCount,
        origin: descriptor.origin,
      });
    }

    return infos;
  }

  /** Get info with accurate device counts (async) */
  async getProviderInfosAsync(): Promise<DeviceProviderInfo[]> {
    const infos: DeviceProviderInfo[] = [];

    for (const descriptor of this.descriptors.values()) {
      const stored = this.providerStore?.getConfig(descriptor.id);
      const config = stored?.config ?? {};

      const maskedConfig: Record<string, unknown> = {};
      for (const field of descriptor.getConfigFields()) {
        const value = config[field.key];
        if (field.type === "password" && typeof value === "string" && value.length > 0) {
          maskedConfig[field.key] = PASSWORD_MASK;
        } else {
          maskedConfig[field.key] = value;
        }
      }

      let deviceCount = 0;
      const activeProvider = this.providers.find((p) => p.name === descriptor.id);
      if (activeProvider) {
        try {
          const devices = await activeProvider.getDevices();
          deviceCount = devices.length;
        } catch { /* ignore */ }
      }

      infos.push({
        id: descriptor.id,
        displayName: descriptor.displayName,
        description: descriptor.description,
        enabled: stored?.enabled ?? false,
        status: descriptor.getStatus(),
        statusMessage: descriptor.getStatusMessage(),
        configSchema: descriptor.getConfigFields(),
        config: maskedConfig,
        deviceCount,
        origin: descriptor.origin,
      });
    }

    return infos;
  }

  /** Get a provider instance by name */
  getProviderByName(name: string): DeviceProvider | undefined {
    return this.providers.find((p) => p.name === name);
  }

  registerProvider(provider: DeviceProvider): void {
    this.providers.push(provider);
    provider.onEvent((event) => {
      for (const listener of this.listeners) {
        listener(event);
      }
    });
  }

  async connectAll(): Promise<void> {
    await Promise.all(this.providers.map((p) => p.connect()));
    console.log(
      `[DeviceManager] All providers connected: ${this.providers.map((p) => p.name).join(", ")}`,
    );
  }

  async disconnectAll(): Promise<void> {
    await Promise.all(this.providers.map((p) => p.disconnect()));
  }

  async getAllDevices(): Promise<Device[]> {
    const results = await Promise.all(this.providers.map((p) => p.getDevices()));
    const devices = results.flat();
    for (const d of devices) {
      this.deviceCache.set(d.id, d);
    }
    return devices;
  }

  async getDevice(id: string): Promise<Device | undefined> {
    const all = await this.getAllDevices();
    return all.find((d) => d.id === id);
  }

  getCachedDevice(id: string): Device | undefined {
    return this.deviceCache.get(id);
  }

  async getAreas(): Promise<DeviceArea[]> {
    const results = await Promise.all(this.providers.map((p) => p.getAreas()));
    // Deduplicate by area id
    const seen = new Set<string>();
    const areas: DeviceArea[] = [];
    for (const area of results.flat()) {
      if (!seen.has(area.id)) {
        seen.add(area.id);
        areas.push(area);
      }
    }
    return areas;
  }

  async getDevicesByArea(areaId: string): Promise<Device[]> {
    const all = await this.getAllDevices();
    return all.filter((d) => d.area.id === areaId);
  }

  async getDevicesByDomain(domain: DeviceDomain): Promise<Device[]> {
    const all = await this.getAllDevices();
    return all.filter((d) => d.domain === domain);
  }

  validateCommand(
    device: Device,
    command: string,
    params: Record<string, unknown>,
  ): { valid: boolean; error?: string } {
    const cap = device.capabilities.find((c) => c.name === command);
    if (!cap) {
      return {
        valid: false,
        error: `Device ${device.id} does not support command: ${command}. Available: ${device.capabilities.map((c) => c.name).join(", ")}`,
      };
    }

    // Check required params
    for (const param of cap.params) {
      if (param.required && !(param.name in params)) {
        return {
          valid: false,
          error: `Missing required parameter "${param.name}" for command "${command}"`,
        };
      }
    }

    // Check param types and ranges
    for (const param of cap.params) {
      const value = params[param.name];
      if (value === undefined) continue;

      switch (param.type) {
        case "number": {
          if (typeof value !== "number") {
            return { valid: false, error: `Parameter "${param.name}" must be a number, got ${typeof value}` };
          }
          if (param.min !== undefined && value < param.min) {
            return { valid: false, error: `Parameter "${param.name}" must be >= ${param.min}, got ${value}` };
          }
          if (param.max !== undefined && value > param.max) {
            return { valid: false, error: `Parameter "${param.name}" must be <= ${param.max}, got ${value}` };
          }
          break;
        }
        case "string": {
          if (typeof value !== "string") {
            return { valid: false, error: `Parameter "${param.name}" must be a string, got ${typeof value}` };
          }
          break;
        }
        case "boolean": {
          if (typeof value !== "boolean") {
            return { valid: false, error: `Parameter "${param.name}" must be a boolean, got ${typeof value}` };
          }
          break;
        }
        case "enum": {
          if (param.options && !param.options.includes(String(value))) {
            return { valid: false, error: `Parameter "${param.name}" must be one of [${param.options.join(", ")}], got "${value}"` };
          }
          break;
        }
      }
    }

    return { valid: true };
  }

  onEvent(callback: (event: DeviceEvent) => void): void {
    this.listeners.push(callback);
  }

  onCommandExecuted(callback: (deviceId: string, command: string) => void): void {
    this.commandListeners.push(callback);
  }

  /** Get all entities from a provider (unfiltered). Returns null if provider not found or not running. */
  getAvailableEntities(providerName: string): Array<{
    entity_id: string;
    friendly_name: string;
    domain: string;
    area_name: string | null;
    state: string;
  }> | null {
    const provider = this.providers.find((p) => p.name === providerName);
    if (!provider || !("getAllEntities" in provider)) return null;
    return (provider as any).getAllEntities();
  }

  /** Set the entity filter for a provider. Returns false if provider not found. */
  setEntityFilter(providerName: string, entityIds: string[]): boolean {
    const provider = this.providers.find((p) => p.name === providerName);
    if (!provider || !("getEntityFilter" in provider)) return false;
    (provider as any).getEntityFilter().setAllowed(entityIds);
    return true;
  }

  /** Get entity filter count for a provider. Returns 0 if provider not found. */
  getEntityFilterCount(providerName: string): number {
    const provider = this.providers.find((p) => p.name === providerName);
    if (!provider || !("getEntityFilter" in provider)) return 0;
    return (provider as any).getEntityFilter().count();
  }

  /** Check if a named provider is connected (running). */
  isProviderConnected(providerName: string): boolean {
    return this.providers.some((p) => p.name === providerName);
  }

  validateDataQuery(
    device: Device,
    query: string,
    params: Record<string, unknown>,
  ): { valid: boolean; error?: string } {
    if (!device.dataQueries || device.dataQueries.length === 0) {
      return {
        valid: false,
        error: `Device ${device.id} does not support data queries`,
      };
    }

    const descriptor = device.dataQueries.find((q) => q.name === query);
    if (!descriptor) {
      return {
        valid: false,
        error: `Device ${device.id} does not support query: ${query}. Available: ${device.dataQueries.map((q) => q.name).join(", ")}`,
      };
    }

    // Check required params
    for (const param of descriptor.params) {
      if (param.required && !(param.name in params)) {
        return {
          valid: false,
          error: `Missing required parameter "${param.name}" for query "${query}"`,
        };
      }
    }

    // Check param types
    for (const param of descriptor.params) {
      const value = params[param.name];
      if (value === undefined) continue;

      switch (param.type) {
        case "string":
          if (typeof value !== "string") {
            return { valid: false, error: `Parameter "${param.name}" must be a string, got ${typeof value}` };
          }
          break;
        case "enum":
          if (param.options && !param.options.includes(String(value))) {
            return { valid: false, error: `Parameter "${param.name}" must be one of [${param.options.join(", ")}], got "${value}"` };
          }
          break;
        case "number":
          if (typeof value !== "number") {
            return { valid: false, error: `Parameter "${param.name}" must be a number, got ${typeof value}` };
          }
          break;
        case "boolean":
          if (typeof value !== "boolean") {
            return { valid: false, error: `Parameter "${param.name}" must be a boolean, got ${typeof value}` };
          }
          break;
      }
    }

    return { valid: true };
  }

  async queryData(
    deviceId: string,
    query: string,
    params: Record<string, unknown>,
  ): Promise<DataQueryResult> {
    // Find device and validate
    const device = this.deviceCache.get(deviceId) ?? await this.getDevice(deviceId);
    if (device) {
      const validation = this.validateDataQuery(device, query, params);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }
    }

    for (const provider of this.providers) {
      const devices = await provider.getDevices();
      if (devices.some((d) => d.id === deviceId)) {
        if (!provider.queryData) {
          return { success: false, error: `Provider ${provider.name} does not support data queries` };
        }
        return provider.queryData(deviceId, query, params);
      }
    }

    return { success: false, error: `No provider found for device: ${deviceId}` };
  }

  async executeCommand(
    deviceId: string,
    command: string,
    params: Record<string, unknown>,
  ): Promise<CommandResult> {
    // Find device and validate
    const device = this.deviceCache.get(deviceId) ?? await this.getDevice(deviceId);
    if (device) {
      const validation = this.validateCommand(device, command, params);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }
    }

    for (const provider of this.providers) {
      const devices = await provider.getDevices();
      if (devices.some((d) => d.id === deviceId)) {
        // Register echo BEFORE execution so triage can suppress the resulting event
        for (const listener of this.commandListeners) {
          listener(deviceId, command);
        }
        const result = await provider.executeCommand(deviceId, command, params);
        return result;
      }
    }
    return { success: false, error: `No provider found for device: ${deviceId}` };
  }
}
