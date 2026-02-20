import type { EventBus } from "../event-bus.js";
import type { DeviceManager } from "../devices/manager.js";
import type { MemoryStore } from "../memory/store.js";
import type { HolmsConfig } from "../config.js";
import type { PluginManager } from "../plugins/manager.js";
import type { McpServerPool } from "./mcp-pool.js";
import { runToolQuery, buildAgentContext, BEFORE_ACTING_REMINDER } from "./query-runner.js";

/**
 * Per-channel stateful coordinator with SDK session resume.
 * All calls within a channel serialize through an async queue
 * so the SDK gets sequential turns with conversation history.
 */
export class ChatCoordinator {
  private sessionId: string | null = null;
  private currentTurnId: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly channel: string,
    private eventBus: EventBus,
    private deviceManager: DeviceManager,
    private memoryStore: MemoryStore,
    private config: HolmsConfig,
    private mcpPool: McpServerPool,
    private pluginManager?: PluginManager,
  ) {}

  getCurrentTurnId(): string | null {
    return this.currentTurnId;
  }

  /** Enqueue a task that runs serially within this channel */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.queue.then(fn, fn);
    this.queue = task.then(() => {}, () => {});
    return task;
  }

  async handleUserRequest(message: string, messageId?: string): Promise<string> {
    return this.enqueue(async () => {
      const context = await buildAgentContext(this.deviceManager, this.memoryStore);
      const prompt = `${context}\n\nUser message: ${message}${BEFORE_ACTING_REMINDER}`;
      return this.runQuery(prompt, "user_message", `User: ${message.slice(0, 80)}`, messageId);
    });
  }

  async handleApprovalResult(
    id: string,
    approved: boolean,
    action: { deviceId: string; command: string; params: Record<string, unknown>; reason?: string },
    userReason?: string,
    messageId?: string,
  ): Promise<string> {
    return this.enqueue(async () => {
      const status = approved ? "approved" : "rejected";
      const actionDesc = `${action.command} on ${action.deviceId} (${JSON.stringify(action.params)})`;
      const context = await buildAgentContext(this.deviceManager, this.memoryStore);
      const prompt = `${context}\n\nAPPROVAL RESULT: The user ${status} your proposed action: ${actionDesc}.${action.reason ? ` Your reason for proposing: ${action.reason}.` : ""}${userReason ? ` User's reason for rejecting: ${userReason}.` : ""}\n\n${approved ? "The action has already been executed. No further action needed — just acknowledge briefly." : "Reflect on why and store a brief lesson in memory so you avoid repeating the mistake."}`;
      return this.runQuery(prompt, "approval_result", `Approval ${approved ? "granted" : "denied"}`, messageId);
    });
  }

  private async runQuery(promptText: string, trigger: "user_message" | "approval_result", summary: string, externalMessageId?: string): Promise<string> {
    const messageId = externalMessageId ?? crypto.randomUUID();
    const turnId = crypto.randomUUID();
    this.currentTurnId = turnId;

    try {
      const { result, sessionId } = await runToolQuery({
        eventBus: this.eventBus,
        config: this.config,
        mcpPool: this.mcpPool,
        pluginManager: this.pluginManager,
        promptText,
        trigger,
        summary,
        messageId,
        sessionId: this.sessionId,
      });
      this.sessionId = sessionId;
      return result;
    } catch (error) {
      const errorMsg = `Coordinator error: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[ChatCoordinator:${this.channel}] ${errorMsg}`);

      this.eventBus.emit("agent:result", {
        result: errorMsg,
        model: this.config.models.coordinator,
        costUsd: 0, inputTokens: 0, outputTokens: 0,
        cacheReadTokens: 0, cacheCreationTokens: 0,
        durationMs: 0, durationApiMs: 0, numTurns: 0,
        totalCostUsd: 0, timestamp: Date.now(),
      });

      this.eventBus.emit("chat:stream_end", {
        messageId,
        content: errorMsg,
        timestamp: Date.now(),
      });

      return errorMsg;
    } finally {
      this.currentTurnId = null;
    }
  }
}
