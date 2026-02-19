import type { ChannelProvider, ChannelConversation, InboundMessage } from "./types.js";
import type { EventBus } from "../event-bus.js";
import type { ChatStore } from "../chat/store.js";
import type { Coordinator } from "../coordinator/coordinator.js";
import type { ChannelConversationInfo } from "@holms/shared";
import { v4 as uuid } from "uuid";

interface PendingResponse {
  providerId: string;
  conversationId: string;
}

export class ChannelManager {
  private providers = new Map<string, ChannelProvider>();
  private pendingResponses = new Map<string, PendingResponse>();
  private conversationTopics = new Map<string, string>();

  constructor(
    private eventBus: EventBus,
    private chatStore: ChatStore,
    private coordinator: Coordinator,
  ) {
    // Route streaming tokens to the correct provider
    this.eventBus.on("chat:token", (data: { token: string; messageId: string; timestamp: number }) => {
      const pending = this.pendingResponses.get(data.messageId);
      if (!pending) return;
      const provider = this.providers.get(pending.providerId);
      provider?.sendToken(pending.conversationId, data.messageId, data.token);
    });

    // Route stream-end to the correct provider
    this.eventBus.on("chat:stream_end", (data: { messageId: string; content: string; reasoning?: string; timestamp: number }) => {
      const pending = this.pendingResponses.get(data.messageId);
      if (!pending) return;
      const provider = this.providers.get(pending.providerId);
      provider?.sendStreamEnd(pending.conversationId, data.messageId, data.content, data.reasoning);
      this.pendingResponses.delete(data.messageId);
    });
  }

  async register(provider: ChannelProvider): Promise<void> {
    this.providers.set(provider.id, provider);
    await provider.start((msg) => this.handleInbound(msg));
    console.log(`[Channels] Registered provider: ${provider.displayName} (${provider.id})`);
  }

  async unregister(id: string): Promise<void> {
    const provider = this.providers.get(id);
    if (provider) {
      await provider.stop();
      this.providers.delete(id);
      console.log(`[Channels] Unregistered provider: ${id}`);
    }
  }

  /** Track a response message so streaming events route to the right provider */
  trackResponse(messageId: string, providerId: string, conversationId: string): void {
    this.pendingResponses.set(messageId, { providerId, conversationId });
  }

  /** Handle an inbound message from any channel provider */
  private async handleInbound(msg: InboundMessage): Promise<void> {
    const conversation = this.getConversation(msg.conversationId);
    if (!conversation) {
      console.warn(`[Channels] Unknown conversation: ${msg.conversationId}`);
      return;
    }

    // Store user message
    const userMsg = {
      id: msg.id,
      role: "user" as const,
      content: msg.content,
      timestamp: msg.timestamp,
      channel: msg.conversationId,
    };
    this.chatStore.add(userMsg);

    // Insert thinking placeholder
    const thinkingId = uuid();
    this.chatStore.add({
      id: thinkingId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      status: "thinking" as const,
      channel: msg.conversationId,
    });

    // Track the response for streaming routing
    this.trackResponse(thinkingId, conversation.providerId, msg.conversationId);

    // Build prompt with conversation context
    let prompt = msg.content;
    const topic = this.conversationTopics.get(msg.conversationId) ?? conversation.topic;
    if (topic) {
      prompt = `[Channel: ${conversation.displayName} | Topic: ${topic}]\n\n${msg.content}`;
    }

    try {
      const result = await this.coordinator.handleUserRequest(prompt, thinkingId);
      this.chatStore.updateMessage(thinkingId, {
        content: result,
        status: null,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error("[Channels] Coordinator error:", err);
      const fallback = "Sorry, I encountered an error processing your message.";
      this.chatStore.updateMessage(thinkingId, { content: fallback, status: null });
      this.eventBus.emit("chat:stream_end", {
        messageId: thinkingId,
        content: fallback,
        timestamp: Date.now(),
      });
    }
  }

  /** Get all conversations across all providers */
  getConversations(): ChannelConversationInfo[] {
    const result: ChannelConversationInfo[] = [];
    for (const provider of this.providers.values()) {
      for (const conv of provider.getConversations()) {
        result.push({
          id: conv.id,
          providerId: conv.providerId,
          displayName: conv.displayName,
          topic: this.conversationTopics.get(conv.id) ?? conv.topic,
        });
      }
    }
    return result;
  }

  /** Get a single conversation by ID */
  getConversation(id: string): ChannelConversation | undefined {
    for (const provider of this.providers.values()) {
      for (const conv of provider.getConversations()) {
        if (conv.id === id) {
          return {
            ...conv,
            topic: this.conversationTopics.get(conv.id) ?? conv.topic,
          };
        }
      }
    }
    return undefined;
  }

  /** Update a conversation's topic */
  updateConversationTopic(conversationId: string, topic: string): void {
    this.conversationTopics.set(conversationId, topic);
  }

  /** Stop all providers */
  async stopAll(): Promise<void> {
    for (const provider of this.providers.values()) {
      await provider.stop();
    }
    this.providers.clear();
  }
}
