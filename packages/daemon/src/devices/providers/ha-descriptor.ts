import { z } from "zod";
import { DeviceDescriptorBase } from "../descriptor-base.js";
import type { DeviceProvider } from "../types.js";
import { HomeAssistantProvider } from "./home-assistant.js";

export class HomeAssistantDescriptor extends DeviceDescriptorBase {
  readonly id = "home_assistant";
  readonly displayName = "Home Assistant";
  readonly description = "Connect to a Home Assistant instance for real device control";
  readonly origin = "builtin" as const;

  readonly configSchema = z.object({
    url: z.string().min(1).describe("Home Assistant URL (e.g. http://homeassistant.local:8123)"),
    accessToken: z.string().min(1).describe("Long-lived access token"),
  });

  private dbPath: string;
  private telemetryConfig?: { minIntervalMs?: number; significanceDelta?: number };

  constructor(dbPath: string = "./holms.db", telemetryConfig?: { minIntervalMs?: number; significanceDelta?: number }) {
    super();
    this.dbPath = dbPath;
    this.telemetryConfig = telemetryConfig;
  }

  createProvider(config: Record<string, unknown>): DeviceProvider {
    const parsed = this.configSchema.parse(config);
    return new HomeAssistantProvider(parsed.url, parsed.accessToken, this.dbPath, this.telemetryConfig);
  }
}
