import { z } from "zod";
import type { ChannelCapabilities } from "@holms/shared";
import { ChannelDescriptorBase } from "../descriptor-base.js";
import type { ChannelProvider } from "../types.js";
import { WhatsAppProvider } from "./whatsapp-provider.js";
import { join, dirname } from "node:path";

export class WhatsAppChannelDescriptor extends ChannelDescriptorBase {
  readonly id = "whatsapp";
  readonly displayName = "WhatsApp";
  readonly description = "Connect via WhatsApp using a dedicated phone number. Family members message the number to chat with the assistant.";
  readonly origin = "builtin" as const;

  readonly capabilities: ChannelCapabilities = {
    multiConversation: true,
    approvalButtons: false,
    richFormatting: false,
    threads: false,
    reactions: false,
    fileUpload: false,
  };

  readonly configSchema = z.object({
    allowedNumbers: z.string().optional().describe("Comma-separated phone numbers (E.164) allowed to chat. Leave empty to allow all."),
  });

  createProvider(config: Record<string, unknown>): ChannelProvider {
    const parsed = this.configSchema.parse(config);

    let allowedNumbers: Set<string> | null = null;
    if (parsed.allowedNumbers) {
      const nums = parsed.allowedNumbers.split(",").map((n) => n.trim()).filter(Boolean);
      if (nums.length > 0) allowedNumbers = new Set(nums);
    }

    const dataDir = dirname(process.env.HOLMS_DB_PATH ?? "./holms.db");
    const authDir = join(dataDir, "whatsapp-auth");

    return new WhatsAppProvider(
      allowedNumbers,
      authDir,
      (status, message) => this.setStatus(status, message),
    );
  }
}
