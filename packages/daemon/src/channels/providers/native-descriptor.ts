import { z } from "zod";
import type { ChannelCapabilities } from "@holms/shared";
import { ChannelDescriptorBase } from "../descriptor-base.js";
import type { ChannelProvider } from "../types.js";
import { NativeProvider } from "./native-provider.js";
import type { NativeGateway } from "../../api/native/gateway.js";

export class NativeChannelDescriptor extends ChannelDescriptorBase {
  readonly id = "native";
  readonly displayName = "Native App";
  readonly description = "Native app clients (iOS, macOS). Connects via the WebSocket gateway at /ws/native.";
  readonly origin = "builtin" as const;

  readonly capabilities: ChannelCapabilities = {
    multiConversation: true,
    approvalButtons: true,
    richFormatting: false,
    threads: false,
    reactions: false,
    fileUpload: false,
    interactiveQuestions: false,
  };

  readonly configSchema = z.object({});

  private gateway: NativeGateway;

  constructor(gateway: NativeGateway) {
    super();
    this.gateway = gateway;
    this.status = "connected";
  }

  createProvider(): ChannelProvider {
    return new NativeProvider(this.gateway);
  }
}
