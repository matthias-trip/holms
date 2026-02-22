import type { ChannelProvider, ChannelConversation, InboundMessage } from "../types.js";

/**
 * Built-in web provider. The actual message delivery is handled by tRPC
 * subscriptions, so sendToken/sendStreamEnd are no-ops here.
 */
export class WebProvider implements ChannelProvider {
  readonly id = "web";
  readonly displayName = "Web UI";

  async start(_onMessage: (msg: InboundMessage) => void): Promise<void> {
    // Web messages arrive via tRPC chat.send, not through start()
  }

  getConversations(): ChannelConversation[] {
    return [
      {
        id: "web:default",
        providerId: "web",
        externalId: "default",
        displayName: "Web UI",
      },
    ];
  }

  sendToken(): void {
    // no-op — tRPC subscription handles streaming to web clients
  }

  sendStreamEnd(): void {
    // no-op — tRPC subscription handles streaming to web clients
  }

  async stop(): Promise<void> {
    // nothing to clean up
  }
}
