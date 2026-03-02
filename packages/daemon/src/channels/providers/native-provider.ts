import type {
  ChannelProvider,
  ChannelConversation,
  InboundMessage,
  ApprovalPayload,
  ApprovalAction,
} from "../types.js";
import type { NativeGateway } from "../../api/native/gateway.js";

/**
 * Channel provider for native app clients (iOS, macOS, etc.).
 * Each connected native client registers as a conversation "native:<clientId>".
 * Streaming tokens and responses are delivered through the native WebSocket gateway.
 */
export class NativeProvider implements ChannelProvider {
  readonly id = "native";
  readonly displayName = "Native App";

  private conversations = new Map<string, ChannelConversation>();
  private gateway: NativeGateway;

  constructor(gateway: NativeGateway) {
    this.gateway = gateway;
  }

  async start(_onMessage: (msg: InboundMessage) => void): Promise<void> {
    // Native messages arrive via the WebSocket gateway's chat.send handler,
    // which calls channelManager.sendMessage directly.
  }

  getConversations(): ChannelConversation[] {
    return Array.from(this.conversations.values());
  }

  /** Register a native client as a conversation. Called by the gateway on connect. */
  registerClient(clientId: string, personId?: string): void {
    const conversationId = `native:${clientId}`;
    this.conversations.set(conversationId, {
      id: conversationId,
      providerId: "native",
      externalId: clientId,
      displayName: personId ? `Native (${personId})` : "Native App",
    });
  }

  /** Remove a client conversation when they disconnect. */
  unregisterClient(clientId: string): void {
    this.conversations.delete(`native:${clientId}`);
  }

  sendToken(conversationId: string, messageId: string, token: string): void {
    // Streaming tokens are delivered via the EventBus → native gateway broadcast.
    // The gateway already listens on "chat:token" and forwards to subscribed clients.
  }

  sendStreamEnd(conversationId: string, messageId: string, content: string, _reasoning?: string): void {
    // Stream end is delivered via the EventBus → native gateway broadcast.
  }

  async stop(): Promise<void> {
    this.conversations.clear();
  }

  seedConversations(conversations: ChannelConversation[]): void {
    for (const conv of conversations) {
      this.conversations.set(conv.id, conv);
    }
  }
}
