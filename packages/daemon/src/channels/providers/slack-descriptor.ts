import { z } from "zod";
import type { ChannelCapabilities } from "@holms/shared";
import { ChannelDescriptorBase } from "../descriptor-base.js";
import type { ChannelProvider } from "../types.js";
import { SlackProvider } from "./slack-provider.js";

export class SlackChannelDescriptor extends ChannelDescriptorBase {
  readonly id = "slack";
  readonly displayName = "Slack";
  readonly description = "Connect to a Slack workspace via Bot Token and Socket Mode for real-time messaging and approval buttons.";
  readonly origin = "builtin" as const;

  readonly capabilities: ChannelCapabilities = {
    multiConversation: true,
    approvalButtons: true,
    richFormatting: true,
    threads: true,
    reactions: true,
    fileUpload: false,
  };

  readonly configSchema = z.object({
    botToken: z.string().min(1, "Bot token is required").describe("Slack Bot Token (xoxb-...)"),
    signingSecret: z.string().min(1, "Signing secret is required").describe("Slack App Signing Secret"),
    appToken: z.string().optional().describe("Slack App-Level Token for Socket Mode (xapp-...)"),
  });

  createProvider(config: Record<string, unknown>): ChannelProvider {
    const parsed = this.configSchema.parse(config);
    return new SlackProvider(parsed.botToken, parsed.signingSecret, parsed.appToken);
  }
}
