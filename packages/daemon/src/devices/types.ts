import type { Device, DeviceEvent } from "@holms/shared";

export interface DeviceProvider {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getDevices(): Promise<Device[]>;
  onEvent(callback: (event: DeviceEvent) => void): void;
  executeCommand(
    deviceId: string,
    command: string,
    params: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string }>;
}
