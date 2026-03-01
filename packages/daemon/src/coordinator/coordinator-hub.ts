import type { HabitatEvent } from "../habitat/types.js";
import type { EventBus } from "../event-bus.js";
import type { Habitat } from "../habitat/habitat.js";
import type { MemoryStore } from "../memory/store.js";
import type { HolmsConfig } from "../config.js";
import type { PluginManager } from "../plugins/manager.js";
import type { ChannelManager } from "../channels/manager.js";
import type { PeopleStore } from "../people/store.js";
import type { GoalStore } from "../goals/store.js";
import type { ActivityStore } from "../activity/store.js";
import type { McpServerPool } from "./mcp-pool.js";
import { ChatCoordinator } from "./chat-coordinator.js";
import { EphemeralRunner } from "./ephemeral-runner.js";
import { ContextCache, type FlowContext } from "./query-runner.js";

/**
 * Facade that owns the shared MCP pool, manages per-channel ChatCoordinators
 * (lazy-created), and a single EphemeralRunner for stateless work.
 */
export class CoordinatorHub {
  private chatCoordinators = new Map<string, ChatCoordinator>();
  private ephemeralRunner: EphemeralRunner;
  private contextCache: ContextCache;
  private approvalChannels = new Map<string, string>(); // approvalId → channel
  private ephemeralChannel: string | null = null;
  private channelManager?: ChannelManager;

  constructor(
    private eventBus: EventBus,
    private habitat: Habitat,
    private memoryStore: MemoryStore,
    private config: HolmsConfig,
    private mcpPool: McpServerPool,
    private pluginManager?: PluginManager,
    private peopleStore?: PeopleStore,
    private goalStore?: GoalStore,
    private activityStore?: ActivityStore,
  ) {
    this.contextCache = new ContextCache(eventBus);
    this.ephemeralRunner = new EphemeralRunner(
      eventBus, habitat, memoryStore,
      config, this.mcpPool, this.contextCache, pluginManager, peopleStore, goalStore, activityStore,
    );

    // Track which channel was active when an approval was proposed
    this.eventBus.on("approval:pending", (data: { id: string }) => {
      // Find the chat coordinator that has an active turn
      for (const [channel, coordinator] of this.chatCoordinators) {
        if (coordinator.getCurrentTurnId() !== null) {
          this.approvalChannels.set(data.id, channel);
          return;
        }
      }
      // For ephemeral runs, use the channel passed to the wakeup (e.g. from automation)
      if (this.ephemeralChannel) {
        this.approvalChannels.set(data.id, this.ephemeralChannel);
        return;
      }
      // Default to web:default if no channel context available
      this.approvalChannels.set(data.id, "web:default");
    });
  }

  /** Wire ChannelManager after construction (breaks circular dep) */
  setChannelManager(cm: ChannelManager): void {
    this.channelManager = cm;
  }

  // ── Chat routing ──

  getChat(channel: string): ChatCoordinator {
    let coordinator = this.chatCoordinators.get(channel);
    if (!coordinator) {
      coordinator = new ChatCoordinator(
        channel, this.eventBus, this.habitat,
        this.memoryStore, this.config, this.mcpPool,
        this.contextCache, this.pluginManager, this.peopleStore, this.goalStore,
      );
      this.chatCoordinators.set(channel, coordinator);
    }
    return coordinator;
  }

  async handleUserRequest(message: string, messageId?: string, channel: string = "web:default", channelDisplayName?: string, memoryScope?: string, flowContext?: FlowContext): Promise<string> {
    const chat = this.getChat(channel);
    if (flowContext) chat.setFlowContext(flowContext);
    return chat.handleUserRequest(message, messageId, channelDisplayName, memoryScope);
  }

  async handleApprovalResult(
    id: string,
    approved: boolean,
    action: { deviceId: string; command: string; params: Record<string, unknown>; reason?: string },
    userReason?: string,
    messageId?: string,
    channel?: string,
  ): Promise<string> {
    const resolvedChannel = channel ?? this.getApprovalChannel(id);
    return this.getChat(resolvedChannel).handleApprovalResult(id, approved, action, userReason, messageId);
  }

  // ── Ephemeral routing ──

  enqueueEvent(event: HabitatEvent): void {
    this.ephemeralRunner.enqueueEvent(event);
  }

  async handleProactiveWakeup(wakeupType: string, extraContext?: string, channel?: string, automationId?: string, automationSummary?: string): Promise<string> {
    this.ephemeralChannel = channel ?? null;
    try {
      const result = await this.ephemeralRunner.handleProactiveWakeup(wakeupType, extraContext, channel, automationId, automationSummary);
      // Post the result back to the originating channel if available
      if (channel && result && this.channelManager) {
        this.channelManager.sendDirectMessage(channel, result);
      }
      return result;
    } finally {
      this.ephemeralChannel = null;
    }
  }

  async handleOutcomeFeedback(feedback: string): Promise<string> {
    return this.ephemeralRunner.handleOutcomeFeedback(feedback);
  }

  async handleCycleFeedback(opts: {
    turnId: string;
    cycleType: string;
    cycleResult: string;
    sentiment: "positive" | "negative";
    comment?: string;
  }): Promise<string> {
    return this.ephemeralRunner.handleCycleFeedback(opts);
  }

  async handleMessageFeedback(opts: {
    messageId: string;
    userMessage: string;
    assistantMessage: string;
    sentiment: "positive" | "negative";
    comment?: string;
  }): Promise<string> {
    return this.ephemeralRunner.handleMessageFeedback(opts);
  }

  // ── Onboarding ──

  async runOnboarding(): Promise<string> {
    return this.ephemeralRunner.runOnboarding();
  }

  // ── Shared utilities ──

  /** Get approval channel mapping (which channel originated an approval) */
  getApprovalChannel(approvalId: string): string {
    return this.approvalChannels.get(approvalId) ?? "web:default";
  }

  /** Get the current turn ID across all chat coordinators (for approval channel tracking) */
  getCurrentTurnId(): string | null {
    for (const coordinator of this.chatCoordinators.values()) {
      const turnId = coordinator.getCurrentTurnId();
      if (turnId) return turnId;
    }
    return null;
  }

  /** Proactive scheduler no longer needs to gate on this — ephemeral runs never block */
  isProcessing(): boolean {
    return false;
  }
}
