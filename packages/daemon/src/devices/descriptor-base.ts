import type { ChannelConfigField, DeviceProviderStatus } from "@holms/shared";
import type { z } from "zod";
import type { DeviceProvider, DeviceProviderDescriptor } from "./types.js";

export abstract class DeviceDescriptorBase implements DeviceProviderDescriptor {
  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract readonly description: string;
  abstract readonly origin: "builtin" | "plugin";
  abstract readonly configSchema: z.ZodObject<any>;

  protected status: DeviceProviderStatus = "unconfigured";
  protected statusMessage: string | undefined;

  getConfigFields(): ChannelConfigField[] {
    const shape = this.configSchema.shape as Record<string, z.ZodType>;
    const fields: ChannelConfigField[] = [];

    for (const [key, schema] of Object.entries(shape)) {
      const desc = schema.description;
      const isOptional = schema.isOptional?.() ?? false;

      let fieldType: ChannelConfigField["type"] = "string";
      const innerType = this.unwrapZod(schema);
      if (innerType?._def?.typeName === "ZodBoolean") {
        fieldType = "boolean";
      } else if (innerType?._def?.typeName === "ZodNumber") {
        fieldType = "number";
      } else if (key.toLowerCase().includes("secret") || key.toLowerCase().includes("token") || key.toLowerCase().includes("password")) {
        fieldType = "password";
      }

      fields.push({
        key,
        label: this.keyToLabel(key),
        type: fieldType,
        required: !isOptional,
        description: desc,
      });
    }

    return fields;
  }

  validateConfig(config: Record<string, unknown>): string[] | null {
    const result = this.configSchema.safeParse(config);
    if (result.success) return null;
    return result.error.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`);
  }

  abstract createProvider(config: Record<string, unknown>): DeviceProvider;

  getStatus(): DeviceProviderStatus {
    return this.status;
  }

  getStatusMessage(): string | undefined {
    return this.statusMessage;
  }

  setStatus(status: DeviceProviderStatus, message?: string): void {
    this.status = status;
    this.statusMessage = message;
  }

  private unwrapZod(schema: any): any {
    if (schema?._def?.innerType) return this.unwrapZod(schema._def.innerType);
    return schema;
  }

  private keyToLabel(key: string): string {
    return key
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (s) => s.toUpperCase())
      .trim();
  }
}
