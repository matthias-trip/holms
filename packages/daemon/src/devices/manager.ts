import type { Device, DeviceEvent } from "@holms/shared";
import type { DeviceProvider } from "./types.js";

export class DeviceManager {
  private providers: DeviceProvider[] = [];
  private listeners: Array<(event: DeviceEvent) => void> = [];
  private commandListeners: Array<(deviceId: string, command: string) => void> = [];
  private deviceCache = new Map<string, Device>();

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

  onEvent(callback: (event: DeviceEvent) => void): void {
    this.listeners.push(callback);
  }

  onCommandExecuted(callback: (deviceId: string, command: string) => void): void {
    this.commandListeners.push(callback);
  }

  async executeCommand(
    deviceId: string,
    command: string,
    params: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string }> {
    for (const provider of this.providers) {
      const devices = await provider.getDevices();
      if (devices.some((d) => d.id === deviceId)) {
        const result = await provider.executeCommand(deviceId, command, params);
        if (result.success) {
          for (const listener of this.commandListeners) {
            listener(deviceId, command);
          }
        }
        return result;
      }
    }
    return { success: false, error: `No provider found for device: ${deviceId}` };
  }
}
