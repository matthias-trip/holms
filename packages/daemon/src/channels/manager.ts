import type { ChannelProvider, ChannelConversation, InboundMessage, ChannelProviderDescriptor } from "./types.js";
import type { EventBus } from "../event-bus.js";
import type { ChatStore } from "../chat/store.js";
import type { CoordinatorHub } from "../coordinator/coordinator-hub.js";
import type { ApprovalQueue } from "../coordinator/approval-queue.js";
import type { PeopleStore } from "../people/store.js";
import type { ChannelStore } from "./store.js";
import type { ChannelConversationInfo, ChannelProviderInfo, DeviceEvent } from "@holms/shared";
import { executeApprovalDecision } from "../coordinator/approval-processor.js";
import { v4 as uuid } from "uuid";

interface PendingResponse {
  providerId: string;
  conversationId: string;
}

/** Sentinel value used to mask password fields in API responses */
export const PASSWORD_MASK = "••••••••";

export class ChannelManager {
  private providers = new Map<string, ChannelProvider>();
  private descriptors = new Map<string, ChannelProviderDescriptor>();
  private pendingResponses = new Map<string, PendingResponse>();
  private conversationTopics = new Map<string, string>();

  constructor(
    private eventBus: EventBus,
    private chatStore: ChatStore,
    private hub: CoordinatorHub,
    private channelStore: ChannelStore,
    private approvalQueue: ApprovalQueue,
    private peopleStore?: PeopleStore,
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

  /** Register a descriptor (doesn't start the provider) */
  registerDescriptor(descriptor: ChannelProviderDescriptor): void {
    this.descriptors.set(descriptor.id, descriptor);
    console.log(`[Channels] Registered descriptor: ${descriptor.displayName} (${descriptor.id})`);
  }

  /** Start providers that are enabled in the store with valid config */
  async startEnabledProviders(): Promise<void> {
    const configs = this.channelStore.getAllConfigs();

    for (const [id, { enabled, config }] of configs) {
      if (!enabled) continue;
      const descriptor = this.descriptors.get(id);
      if (!descriptor) continue;

      // Skip web — it's always registered directly
      if (id === "web") continue;

      try {
        const errors = descriptor.validateConfig(config);
        if (errors) {
          console.warn(`[Channels] Invalid config for ${id}:`, errors);
          descriptor.setStatus("error", `Invalid config: ${errors.join(", ")}`);
          continue;
        }

        const provider = descriptor.createProvider(config);
        await this.register(provider);
        if (descriptor.getStatus() !== "pairing") descriptor.setStatus("connected");
      } catch (err: any) {
        console.error(`[Channels] Failed to start ${id}:`, err);
        descriptor.setStatus("error", err.message);
      }
    }
  }

  /** Enable a provider with given config */
  async enableProvider(id: string, config: Record<string, unknown>): Promise<void> {
    const descriptor = this.descriptors.get(id);
    if (!descriptor) throw new Error(`Unknown channel provider: ${id}`);

    const merged = this.mergePasswordFields(id, config);

    const errors = descriptor.validateConfig(merged);
    if (errors) throw new Error(`Invalid config: ${errors.join(", ")}`);

    // Persist
    this.channelStore.setConfig(id, true, merged);

    // Stop existing provider if running
    if (this.providers.has(id)) {
      await this.unregister(id);
    }

    // Create and start
    try {
      const provider = descriptor.createProvider(merged);
      await this.register(provider);
      if (descriptor.getStatus() !== "pairing") {
        descriptor.setStatus("connected");
      }
      this.eventBus.emit("channel:status_changed", {
        providerId: id,
        status: descriptor.getStatus(),
        timestamp: Date.now(),
      });
    } catch (err: any) {
      // Roll back — don't leave enabled=true with broken credentials
      this.channelStore.setConfig(id, false, merged);
      descriptor.setStatus("error", err.message);
      this.eventBus.emit("channel:status_changed", {
        providerId: id,
        status: "error",
        message: err.message,
        timestamp: Date.now(),
      });
      throw err;
    }
  }

  /** Disable a provider */
  async disableProvider(id: string): Promise<void> {
    const descriptor = this.descriptors.get(id);
    if (!descriptor) throw new Error(`Unknown channel provider: ${id}`);

    // Persist
    const existing = this.channelStore.getConfig(id);
    this.channelStore.setConfig(id, false, existing?.config ?? {});

    // Stop if running
    if (this.providers.has(id)) {
      await this.unregister(id);
    }

    descriptor.setStatus("disconnected");
    this.eventBus.emit("channel:status_changed", {
      providerId: id,
      status: "disconnected",
      timestamp: Date.now(),
    });
  }

  /** Merge masked password sentinels back with stored originals */
  private mergePasswordFields(id: string, config: Record<string, unknown>): Record<string, unknown> {
    const descriptor = this.descriptors.get(id);
    if (!descriptor) return config;

    const stored = this.channelStore.getConfig(id);
    if (!stored) return config;

    const merged = { ...config };
    for (const field of descriptor.getConfigFields()) {
      if (field.type === "password" && merged[field.key] === PASSWORD_MASK) {
        merged[field.key] = stored.config[field.key];
      }
    }
    return merged;
  }

  /** Update config for a provider, restart if enabled */
  async updateProviderConfig(id: string, config: Record<string, unknown>): Promise<void> {
    const descriptor = this.descriptors.get(id);
    if (!descriptor) throw new Error(`Unknown channel provider: ${id}`);

    const merged = this.mergePasswordFields(id, config);

    const errors = descriptor.validateConfig(merged);
    if (errors) throw new Error(`Invalid config: ${errors.join(", ")}`);

    const existing = this.channelStore.getConfig(id);
    const enabled = existing?.enabled ?? false;
    this.channelStore.setConfig(id, enabled, merged);

    // Restart if enabled
    if (enabled && this.providers.has(id)) {
      await this.unregister(id);
      try {
        const provider = descriptor.createProvider(merged);
        await this.register(provider);
        descriptor.setStatus("connected");
      } catch (err: any) {
        descriptor.setStatus("error", err.message);
        throw err;
      }
    }
  }

  /** Get info for all registered descriptors */
  getProviderInfos(): ChannelProviderInfo[] {
    const infos: ChannelProviderInfo[] = [];

    for (const descriptor of this.descriptors.values()) {
      const stored = this.channelStore.getConfig(descriptor.id);
      const config = stored?.config ?? {};

      // Mask password fields
      const maskedConfig: Record<string, unknown> = {};
      for (const field of descriptor.getConfigFields()) {
        const value = config[field.key];
        if (field.type === "password" && typeof value === "string" && value.length > 0) {
          maskedConfig[field.key] = PASSWORD_MASK;
        } else {
          maskedConfig[field.key] = value;
        }
      }

      infos.push({
        id: descriptor.id,
        displayName: descriptor.displayName,
        description: descriptor.description,
        enabled: descriptor.id === "web" ? true : (stored?.enabled ?? false),
        status: descriptor.getStatus(),
        statusMessage: descriptor.getStatusMessage(),
        capabilities: descriptor.capabilities,
        configSchema: descriptor.getConfigFields(),
        config: maskedConfig,
        origin: descriptor.origin,
      });
    }

    return infos;
  }

  /** Route an approval to the originating channel + any explicitly configured routes */
  async routeApproval(
    data: { id: string; deviceId: string; command: string; params: Record<string, unknown>; reason: string; message: string; approveLabel: string; rejectLabel: string },
    originChannel?: string,
  ): Promise<void> {
    // Collect all (providerId, conversationId) pairs to send to, deduplicating
    const targets = new Set<string>();

    const sendTo = async (providerId: string, conversationId: string) => {
      const key = `${providerId}:${conversationId}`;
      if (targets.has(key)) return;
      targets.add(key);

      const provider = this.providers.get(providerId);
      if (!provider) return;

      if (provider.sendApproval) {
        await provider.sendApproval(conversationId, data);
      } else {
        provider.sendStreamEnd(conversationId, data.id, data.message);
      }
    };

    // (1) Always send to the originating channel if it's not web
    if (originChannel && !originChannel.startsWith("web:")) {
      const [pid] = originChannel.split(":");
      if (pid) await sendTo(pid, originChannel);
    }

    // (2) Send to any explicitly configured approval routes
    const routes = this.channelStore.getRoutesForEvent("approval");
    for (const route of routes) {
      const providerId = route.channelId.split(":")[0];
      const provider = this.providers.get(providerId);
      if (!provider) continue;

      const conversations = provider.getConversations();
      if (conversations.length === 0) continue;

      await sendTo(providerId, conversations[0].id);
    }
  }

  /** Route a device event to channels that have opted in */
  async routeDeviceEvent(event: DeviceEvent): Promise<void> {
    const routes = this.channelStore.getRoutesForEvent("device_event");
    const sent = new Set<string>();

    for (const route of routes) {
      const providerId = route.channelId.split(":")[0];
      const provider = this.providers.get(providerId);
      if (!provider) continue;

      const conversations = provider.getConversations();
      if (conversations.length === 0) continue;

      const conversationId = conversations[0].id;
      const key = `${providerId}:${conversationId}`;
      if (sent.has(key)) continue;
      sent.add(key);

      const text = `Device Event: ${event.type} on ${event.deviceId}`;
      provider.sendStreamEnd(conversationId, uuid(), text);
    }
  }

  async register(provider: ChannelProvider): Promise<void> {
    this.providers.set(provider.id, provider);

    // Wire approval action callback if the provider supports interactive approvals
    if (provider.onApprovalAction) {
      provider.onApprovalAction(async (action) => {
        const approved = action.decision === "approve";
        await executeApprovalDecision(
          {
            hub: this.hub,
            chatStore: this.chatStore,
            approvalQueue: this.approvalQueue,
            eventBus: this.eventBus,
            channelManager: this,
          },
          action.approvalId,
          approved,
        );
      });
    }

    await provider.start((msg) => this.handleInbound(msg));

    // Seed stored conversations into the provider, then persist any new ones it discovered
    const stored = this.channelStore.getConversationsByProvider(provider.id);
    if (stored.length > 0) {
      provider.seedConversations?.(stored);
    }
    for (const conv of provider.getConversations()) {
      this.channelStore.upsertConversation(conv);
    }

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

  /** Accept a message for a channel (used by tRPC for web, and internally for external providers) */
  async sendMessage(msg: InboundMessage): Promise<{ userMsgId: string; thinkingMsgId: string }> {
    const conversation = this.getConversation(msg.conversationId);
    if (!conversation) throw new Error(`Unknown conversation: ${msg.conversationId}`);

    // Store user message
    this.chatStore.add({
      id: msg.id,
      role: "user",
      content: msg.content,
      timestamp: msg.timestamp,
      channel: msg.conversationId,
    });

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

    // Track response for streaming routing
    this.pendingResponses.set(thinkingId, { providerId: conversation.providerId, conversationId: msg.conversationId });

    // Resolve person for auto-identification + memory scope
    const person = this.peopleStore
      ? (this.peopleStore.resolveByChannel(msg.conversationId) ?? this.peopleStore.resolveBySenderId(msg.senderId))
      : undefined;

    const memoryScope = person ? `person:${person.id}` : msg.conversationId;

    // Build prompt with topic + speaker context
    let prompt = msg.content;
    const topic = this.conversationTopics.get(msg.conversationId) ?? conversation.topic;
    const speakerTag = person ? ` | Speaker: ${person.name}` : "";
    if (topic || person) {
      prompt = `[Channel: ${conversation.displayName}${topic ? ` | Topic: ${topic}` : ""}${speakerTag}]\n\n${msg.content}`;
    }

    // Run coordinator in background (streaming via events)
    this.runCoordinator(thinkingId, prompt, msg.conversationId, conversation.displayName, memoryScope);

    return { userMsgId: msg.id, thinkingMsgId: thinkingId };
  }

  /** Handle an inbound message from an external channel provider */
  private async handleInbound(msg: InboundMessage): Promise<void> {
    await this.sendMessage(msg);
  }

  private async runCoordinator(thinkingId: string, prompt: string, channel: string, displayName?: string, memoryScope?: string): Promise<void> {
    try {
      const result = await this.hub.handleUserRequest(prompt, thinkingId, channel, displayName, memoryScope);
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
        // Persist to DB — catches conversations discovered mid-session
        this.channelStore.upsertConversation(conv);
        result.push({
          id: conv.id,
          providerId: conv.providerId,
          providerName: provider.displayName,
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

  /** Send a one-way message to a conversation without creating a coordinator turn */
  sendDirectMessage(conversationId: string, content: string): boolean {
    const providerId = conversationId.split(":")[0];
    const provider = this.providers.get(providerId);
    if (!provider) return false;

    const messageId = uuid();

    // Persist so the message shows up in chat history
    this.chatStore.add({
      id: messageId,
      role: "assistant",
      content,
      timestamp: Date.now(),
      channel: conversationId,
    });

    // Deliver via provider (no-op for web, posts to Slack/WhatsApp/etc.)
    provider.sendStreamEnd(conversationId, messageId, content);

    // Emit stream_end so tRPC subscriptions (web frontend) pick it up
    this.eventBus.emit("chat:stream_end", {
      messageId,
      content,
      timestamp: Date.now(),
    });

    return true;
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
