import type { TurnTrigger } from "@holms/shared";
import type { HabitatEvent } from "../habitat/types.js";
import type { EventBus } from "../event-bus.js";
import type { Habitat } from "../habitat/habitat.js";
import type { MemoryStore } from "../memory/store.js";
import type { HolmsConfig } from "../config.js";
import type { PluginManager } from "../plugins/manager.js";
import type { PeopleStore } from "../people/store.js";
import type { GoalStore } from "../goals/store.js";
import type { ActivityStore } from "../activity/store.js";
import type { McpServerPool } from "./mcp-pool.js";
import { runToolQuery, buildAgentContext, type ContextCache, type ToolScope } from "./query-runner.js";

function relativeTimeShort(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Stateless fire-and-forget runner. No session resume — fresh SDK session every time.
 * Multiple runs can execute concurrently (no processing gate).
 */
export class EphemeralRunner {
  private eventQueue: HabitatEvent[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private eventBus: EventBus,
    private habitat: Habitat,
    private memoryStore: MemoryStore,
    private config: HolmsConfig,
    private mcpPool: McpServerPool,
    private contextCache: ContextCache,
    private pluginManager?: PluginManager,
    private peopleStore?: PeopleStore,
    private goalStore?: GoalStore,
    private activityStore?: ActivityStore,
  ) {}

  enqueueEvent(event: HabitatEvent): void {
    this.eventQueue.push(event);

    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = setTimeout(
      () => this.processBatch(),
      this.config.coordinator.batchDelayMs,
    );
  }

  async handleProactiveWakeup(wakeupType: string, extraContext: string = "", channel?: string, automationId?: string, automationSummary?: string): Promise<string> {
    const context = await this.contextCache.getOrBuild(() => buildAgentContext(this.habitat, this.memoryStore, this.peopleStore, undefined, undefined, this.goalStore));

    const userPrompts: Record<string, string> = {
      situational: "PROACTIVE CHECK: Assess the current home state.",
      reflection: `REFLECTION: Review recent actions and triage configuration.${extraContext ? `\n${extraContext}` : ""}`,
      goal_review: "GOAL REVIEW: Check active goals and progress.",
      daily_summary: "DAILY SUMMARY: Summarize today's activity and patterns.",
      automation: `AUTOMATION FIRED: ${extraContext || "An automation has triggered."}`,
      memory_maintenance: "MEMORY MAINTENANCE: Compact and prune memory store.",
    };

    let goalReviewPrompt = "";
    if (wakeupType === "goal_review" && this.goalStore) {
      goalReviewPrompt = await this.buildGoalReviewContext();
    }

    const prompts: Record<string, string> = {
      situational: `${context}\n\nPROACTIVE CHECK: Assess the current home state. Act only if needed.`,
      reflection: `${context}\n\n${extraContext}\n\nREFLECTION: Review recent actions and triage configuration.`,
      goal_review: `${context}\n\n${goalReviewPrompt}\n\nGOAL REVIEW: All active goals with their recent timelines are shown above. Review each goal per the Goal Review Cycle instructions.`,
      daily_summary: `${context}\n\nDAILY SUMMARY: Summarize today's activity and patterns.`,
      automation: `${context}\n\n${extraContext}\n\nAUTOMATION FIRED: An automation has triggered. Follow the Before Acting protocol, then handle the instruction above.`,
      memory_maintenance: `${context}\n\nMEMORY MAINTENANCE: The memory store needs compaction. Follow the Memory Maintenance Checklist:\n1. Call memory_reflect to assess the current state\n2. Merge each similarity cluster via memory_merge — review coverage warnings, broaden cues if needed\n3. Prune neverAccessed memories (stored but never surfaced in queries — likely low value)\n4. Review staleMemories (sorted by accessCount) — prune low-access stale memories, rewrite outdated ones\n5. Check growth rate, note if > 5/day\n6. If you started with 100+ memories, call memory_reflect again to verify reduction`,
    };

    const proactiveScopes: Record<string, ToolScope> = {
      situational: "device_action",
      reflection: "reflection",
      goal_review: "goal_review",
      daily_summary: "memory_only",
      automation: "device_action",
      memory_maintenance: "memory_only",
    };

    const prompt = prompts[wakeupType] ?? prompts.situational!;
    const userPrompt = userPrompts[wakeupType] ?? userPrompts.situational!;
    const trigger: TurnTrigger = wakeupType === "automation" ? "automation" : "proactive";
    const proactiveType = wakeupType !== "automation" ? wakeupType : undefined;
    const toolScope = proactiveScopes[wakeupType] ?? "device_action";

    const lightweightTypes = new Set(["reflection", "goal_review", "daily_summary", "memory_maintenance"]);
    const model = lightweightTypes.has(wakeupType) ? this.config.models.lightweight : undefined;

    return this.runEphemeral(prompt, trigger, userPrompt, proactiveType, channel, toolScope, model, automationId, automationSummary);
  }

  private async buildGoalReviewContext(): Promise<string> {
    if (!this.goalStore) return "";
    const goals = this.goalStore.list("active");
    if (goals.length === 0) return "## Active Goals\n\nNo active goals.";

    const lines = ["## Active Goals\n"];
    for (const goal of goals) {
      const events = this.goalStore.getEvents(goal.id, 10);
      const createdAgo = relativeTimeShort(goal.createdAt);
      const attn = goal.needsAttention ? ` | NEEDS ATTENTION: ${goal.attentionReason ?? "flagged"}` : "";
      lines.push(`### Goal: "${goal.title}" (id: ${goal.id})`);
      lines.push(`Status: ${goal.status} | Created: ${createdAgo}${attn}`);
      lines.push(`Description: ${goal.description}`);
      if (goal.nextSteps) {
        lines.push(`Current next steps:\n${goal.nextSteps}`);
      }
      if (events.length > 0) {
        lines.push("Recent timeline:");
        for (const e of events) {
          const ago = relativeTimeShort(e.timestamp);
          lines.push(`- [${e.type}] ${ago}: ${e.content}`);
        }
      } else {
        lines.push("No timeline events yet.");
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  async runOnboarding(): Promise<string> {
    console.log("[EphemeralRunner] Starting onboarding — discovering home...");
    const context = await buildAgentContext(this.habitat, this.memoryStore, this.peopleStore, undefined, { onboarding: true }, this.goalStore) /* skip cache — onboarding is one-time */;

    const prompt = `${context}\n\nONBOARDING: You are setting up a new home for the first time. No adapters are configured yet. Follow the Onboarding instructions in your system prompt to discover and configure this home. Start by calling adapters_discover to find available adapters, then adapters_configure to connect them, and spaces_assign to organize sources into spaces.`;

    return this.runEphemeral(prompt, "onboarding", "ONBOARDING: Discovering your home...", undefined, "web:default", "onboarding");
  }

  async handleCycleFeedback(opts: {
    turnId: string;
    cycleType: string;
    cycleResult: string;
    sentiment: "positive" | "negative";
    comment?: string;
  }): Promise<string> {
    const context = await this.contextCache.getOrBuild(() => buildAgentContext(this.habitat, this.memoryStore, this.peopleStore, undefined, undefined, this.goalStore));

    const sentimentLabel = opts.sentiment === "positive" ? "POSITIVE (thumbs up)" : "NEGATIVE (thumbs down)";
    const commentSection = opts.comment ? `\nUser comment: "${opts.comment}"` : "";

    const prompt = `${context}\n\nCYCLE FEEDBACK: The user rated a ${opts.cycleType} cycle as ${sentimentLabel}.${commentSection}\n\nOriginal cycle output:\n${opts.cycleResult}\n\nReflect on this feedback. What does it tell you about what the user finds helpful or unhelpful? Store relevant insights as memories so you can adjust future ${opts.cycleType} cycles accordingly. For negative feedback, consider what to do differently next time — perhaps be more concise, skip certain checks, or focus on different aspects.`;

    return this.runEphemeral(prompt, "outcome_feedback", `CYCLE FEEDBACK: ${opts.cycleType} rated ${opts.sentiment}`, undefined, undefined, "memory_only", this.config.models.lightweight);
  }

  async handleMessageFeedback(opts: {
    messageId: string;
    userMessage: string;
    assistantMessage: string;
    sentiment: "positive" | "negative";
    comment?: string;
  }): Promise<string> {
    const context = await this.contextCache.getOrBuild(() => buildAgentContext(this.habitat, this.memoryStore, this.peopleStore, undefined, undefined, this.goalStore));

    const sentimentLabel = opts.sentiment === "positive" ? "POSITIVE (thumbs up)" : "NEGATIVE (thumbs down)";
    const commentSection = opts.comment ? `\nUser comment: "${opts.comment}"` : "";

    const prompt = `${context}\n\nMESSAGE FEEDBACK: The user rated your response as ${sentimentLabel}.${commentSection}\n\nExchange:\nUser: ${opts.userMessage}\nYou: ${opts.assistantMessage}\n\nReflect briefly on this feedback. What should you do differently? Store relevant insights as memories so you can adjust future responses accordingly.`;

    return this.runEphemeral(prompt, "outcome_feedback", `MESSAGE FEEDBACK: rated ${opts.sentiment}`, undefined, undefined, "memory_only", this.config.models.lightweight);
  }

  async handleOutcomeFeedback(feedback: string): Promise<string> {
    const context = await this.contextCache.getOrBuild(() => buildAgentContext(this.habitat, this.memoryStore, this.peopleStore, undefined, undefined, this.goalStore));
    const prompt = `${context}\n\nOUTCOME FEEDBACK: ${feedback}\n\nReflect on this feedback. What does it tell you about the user's preferences? Store relevant insights as memories and adjust your future behavior accordingly.`;
    return this.runEphemeral(prompt, "outcome_feedback", `OUTCOME FEEDBACK: ${feedback}`, undefined, undefined, "memory_only", this.config.models.lightweight);
  }

  private async processBatch(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const events = this.eventQueue.splice(0);
    const context = await this.contextCache.getOrBuild(() => buildAgentContext(this.habitat, this.memoryStore, this.peopleStore, undefined, undefined, this.goalStore));

    const eventSummary = events
      .map(
        (e) =>
          `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.space}/${e.property} (${e.source}): ${JSON.stringify(e.state)}`,
      )
      .join("\n");

    const prompt = `${context}\n\nHABITAT EVENTS:\n${eventSummary}\n\nProcess these events following the Before Acting protocol.`;

    const userPrompt = `Habitat events:\n${eventSummary}`;

    // Fire and forget — don't block subsequent batches
    this.runEphemeral(prompt, "device_events", userPrompt, undefined, undefined, "device_action").catch((err) => {
      console.error("[EphemeralRunner] Batch processing error:", err);
    });
  }

  private async runEphemeral(promptText: string, trigger: TurnTrigger, userPrompt?: string, proactiveType?: string, channel?: string, toolScope?: ToolScope, model?: string, automationId?: string, automationSummary?: string): Promise<string> {
    const messageId = crypto.randomUUID();

    try {
      const { result } = await runToolQuery({
        eventBus: this.eventBus,
        config: this.config,
        mcpPool: this.mcpPool,
        pluginManager: this.pluginManager,
        promptText,
        userPrompt,
        trigger,
        proactiveType,
        automationId,
        automationSummary,
        messageId,
        sessionId: null, // always fresh
        channel,
        coordinatorType: "ephemeral",
        toolScope,
        model,
      });
      return result;
    } catch (error) {
      const errorMsg = `EphemeralRunner error: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[EphemeralRunner] ${errorMsg}`);

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
    }
  }
}
