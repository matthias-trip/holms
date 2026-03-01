import type { EventBus } from "../event-bus.js";
import type { Habitat } from "../habitat/habitat.js";
import type { MemoryStore } from "../memory/store.js";
import type { HolmsConfig } from "../config.js";
import type { PluginManager } from "../plugins/manager.js";
import type { PeopleStore } from "../people/store.js";
import type { GoalStore } from "../goals/store.js";
import type { McpServerPool } from "./mcp-pool.js";
import { runToolQuery, buildAgentContext, type ContextCache, type ToolScope, type FlowContext } from "./query-runner.js";

/**
 * Per-channel stateful coordinator with SDK session resume.
 * All calls within a channel serialize through an async queue
 * so the SDK gets sequential turns with conversation history.
 */
export class ChatCoordinator {
  private sessionId: string | null = null;
  private currentTurnId: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private flowContext?: FlowContext;

  constructor(
    readonly channel: string,
    private eventBus: EventBus,
    private habitat: Habitat,
    private memoryStore: MemoryStore,
    private config: HolmsConfig,
    private mcpPool: McpServerPool,
    private contextCache: ContextCache,
    private pluginManager?: PluginManager,
    private peopleStore?: PeopleStore,
    private goalStore?: GoalStore,
  ) {}

  getCurrentTurnId(): string | null {
    return this.currentTurnId;
  }

  /** Set flow context (sticky — once set, persists for the lifetime of this coordinator). */
  setFlowContext(fc: FlowContext): void {
    if (!this.flowContext) this.flowContext = fc;
  }

  /** Enqueue a task that runs serially within this channel */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.queue.then(fn, fn);
    this.queue = task.then(() => {}, () => {});
    return task;
  }

  async handleUserRequest(message: string, messageId?: string, channelDisplayName?: string, memoryScope?: string): Promise<string> {
    return this.enqueue(async () => {
      const scope = memoryScope ?? this.channel;
      const isSetupOrTweak = this.flowContext?.kind === "setup" || this.flowContext?.kind === "tweak";
      const agentOpts = isSetupOrTweak ? { flowContext: this.flowContext, pluginManager: this.pluginManager } : undefined;
      const toolScope = isSetupOrTweak ? "setup" as ToolScope : undefined;
      const context = await this.contextCache.getOrBuild(() => buildAgentContext(this.habitat, this.memoryStore, this.peopleStore, scope, agentOpts, this.goalStore));
      const prompt = `${context}\n\nUser message: ${message}`;
      return this.runQuery(prompt, "user_message", `User message: ${message}`, messageId, channelDisplayName, toolScope);
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
      const context = await this.contextCache.getOrBuild(() => buildAgentContext(this.habitat, this.memoryStore, this.peopleStore, this.channel, undefined, this.goalStore));

      // Build human-readable description for the prompt
      const actionDesc = `${action.command} on "${action.deviceId}"`;
      const reasonClause = action.reason ? ` (${action.reason})` : "";

      const userPrompt = approved
        ? `APPROVAL RESULT: The user approved your proposed action — ${actionDesc}${reasonClause}. It has been executed successfully.`
        : `APPROVAL RESULT: The user rejected your proposed action — ${actionDesc}${reasonClause}.${userReason ? ` User's reason: "${userReason}".` : ""}`;
      const prompt = approved
        ? `${context}\n\n${userPrompt} Acknowledge briefly.`
        : `${context}\n\n${userPrompt} Reflect on why and store a brief lesson in memory so you avoid repeating the mistake.`;
      return this.runQuery(prompt, "approval_result", userPrompt, messageId, undefined, "memory_only", this.config.models.lightweight);
    });
  }

  private async runQuery(promptText: string, trigger: "user_message" | "approval_result", userPrompt?: string, externalMessageId?: string, channelDisplayName?: string, toolScope?: ToolScope, model?: string): Promise<string> {
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
        userPrompt,
        trigger,
        messageId,
        sessionId: this.sessionId,
        channel: this.channel,
        channelDisplayName,
        coordinatorType: "chat",
        toolScope,
        model,
        flowContext: this.flowContext,
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
        totalCostUsd: 0, turnId, timestamp: Date.now(),
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
