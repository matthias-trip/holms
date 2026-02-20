import type { DeviceEvent } from "@holms/shared";
import type { EventBus } from "../event-bus.js";
import type { DeviceManager } from "../devices/manager.js";
import type { MemoryStore } from "../memory/store.js";
import type { ReflexStore } from "../reflex/store.js";
import type { ApprovalQueue } from "./approval-queue.js";
import type { HolmsConfig } from "../config.js";
import type { ScheduleStore } from "../schedule/store.js";
import type { TriageStore } from "../triage/store.js";
import type { PluginManager } from "../plugins/manager.js";
import { createMcpServerPool, type McpServerPool } from "./mcp-pool.js";
import { ChatCoordinator } from "./chat-coordinator.js";
import { EphemeralRunner } from "./ephemeral-runner.js";

/**
 * Facade that owns the shared MCP pool, manages per-channel ChatCoordinators
 * (lazy-created), and a single EphemeralRunner for stateless work.
 */
export class CoordinatorHub {
  private mcpPool: McpServerPool;
  private chatCoordinators = new Map<string, ChatCoordinator>();
  private ephemeralRunner: EphemeralRunner;
  private approvalChannels = new Map<string, string>(); // approvalId → channel

  constructor(
    private eventBus: EventBus,
    private deviceManager: DeviceManager,
    private memoryStore: MemoryStore,
    reflexStore: ReflexStore,
    approvalQueue: ApprovalQueue,
    private config: HolmsConfig,
    scheduleStore: ScheduleStore,
    triageStore: TriageStore,
    private pluginManager?: PluginManager,
  ) {
    this.mcpPool = createMcpServerPool(
      deviceManager, memoryStore, reflexStore,
      approvalQueue, scheduleStore, triageStore,
    );

    this.ephemeralRunner = new EphemeralRunner(
      eventBus, deviceManager, memoryStore,
      config, this.mcpPool, pluginManager,
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
      // Default to web:default if no active chat turn (e.g. from ephemeral runner)
      this.approvalChannels.set(data.id, "web:default");
    });
  }

  // ── Chat routing ──

  getChat(channel: string): ChatCoordinator {
    let coordinator = this.chatCoordinators.get(channel);
    if (!coordinator) {
      coordinator = new ChatCoordinator(
        channel, this.eventBus, this.deviceManager,
        this.memoryStore, this.config, this.mcpPool,
        this.pluginManager,
      );
      this.chatCoordinators.set(channel, coordinator);
    }
    return coordinator;
  }

  async handleUserRequest(message: string, messageId?: string, channel: string = "web:default"): Promise<string> {
    return this.getChat(channel).handleUserRequest(message, messageId);
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

  enqueueEvent(event: DeviceEvent): void {
    this.ephemeralRunner.enqueueEvent(event);
  }

  async handleProactiveWakeup(wakeupType: string, extraContext?: string): Promise<string> {
    return this.ephemeralRunner.handleProactiveWakeup(wakeupType, extraContext);
  }

  async handleOutcomeFeedback(feedback: string): Promise<string> {
    return this.ephemeralRunner.handleOutcomeFeedback(feedback);
  }

  // ── Shared utilities ──

  /** Get approval channel mapping (which channel originated an approval) */
  getApprovalChannel(approvalId: string): string {
    return this.approvalChannels.get(approvalId) ?? "web:default";
  }

  /** Get the current turn ID across all chat coordinators (for activity persistence) */
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
