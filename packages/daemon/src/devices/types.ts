import type { Device, DeviceEvent, DeviceArea, CommandResult, ChannelConfigField, DeviceProviderStatus } from "@holms/shared";
import type { z } from "zod";

export interface DeviceProvider {
  readonly name: string;

  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Discovery
  getDevices(): Promise<Device[]>;
  getAreas(): Promise<DeviceArea[]>;

  // Events
  onEvent(callback: (event: DeviceEvent) => void): void;

  // Commands
  executeCommand(
    deviceId: string,
    command: string,
    params: Record<string, unknown>,
  ): Promise<CommandResult>;
}

export interface DeviceProviderDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly origin: "builtin" | "plugin";
  readonly configSchema: z.ZodObject<any>;

  getConfigFields(): ChannelConfigField[];
  validateConfig(config: Record<string, unknown>): string[] | null;
  createProvider(config: Record<string, unknown>): DeviceProvider;
  getStatus(): DeviceProviderStatus;
  getStatusMessage(): string | undefined;
  setStatus(status: DeviceProviderStatus, message?: string): void;
}
