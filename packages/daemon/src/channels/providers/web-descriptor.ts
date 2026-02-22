import { z } from "zod";
import type { ChannelCapabilities } from "@holms/shared";
import { ChannelDescriptorBase } from "../descriptor-base.js";
import type { ChannelProvider } from "../types.js";
import { WebProvider } from "./web-provider.js";

export class WebChannelDescriptor extends ChannelDescriptorBase {
  readonly id = "web";
  readonly displayName = "Web UI";
  readonly description = "Built-in web interface. Always active — messages are delivered via the browser.";
  readonly origin = "builtin" as const;

  readonly capabilities: ChannelCapabilities = {
    multiConversation: false,
    approvalButtons: true,
    richFormatting: true,
    threads: false,
    reactions: false,
    fileUpload: false,
  };

  readonly configSchema = z.object({});

  constructor() {
    super();
    this.status = "connected";
  }

  createProvider(): ChannelProvider {
    return new WebProvider();
  }
}
