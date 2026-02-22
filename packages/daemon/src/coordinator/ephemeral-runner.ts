import type { DeviceEvent, TurnTrigger } from "@holms/shared";
import type { EventBus } from "../event-bus.js";
import type { DeviceManager } from "../devices/manager.js";
import type { MemoryStore } from "../memory/store.js";
import type { HolmsConfig } from "../config.js";
import type { PluginManager } from "../plugins/manager.js";
import type { PeopleStore } from "../people/store.js";
import type { GoalStore } from "../goals/store.js";
import type { McpServerPool } from "./mcp-pool.js";
import { runToolQuery, buildAgentContext, BEFORE_ACTING_REMINDER } from "./query-runner.js";

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
  private eventQueue: DeviceEvent[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private eventBus: EventBus,
    private deviceManager: DeviceManager,
    private memoryStore: MemoryStore,
    private config: HolmsConfig,
    private mcpPool: McpServerPool,
    private pluginManager?: PluginManager,
    private peopleStore?: PeopleStore,
    private goalStore?: GoalStore,
  ) {}

  enqueueEvent(event: DeviceEvent): void {
    this.eventQueue.push(event);

    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = setTimeout(
      () => this.processBatch(),
      this.config.coordinator.batchDelayMs,
    );
  }

  async handleProactiveWakeup(wakeupType: string, extraContext: string = "", channel?: string): Promise<string> {
    const context = await buildAgentContext(this.deviceManager, this.memoryStore, this.peopleStore, undefined, undefined, this.goalStore);

    const userPrompts: Record<string, string> = {
      situational: "PROACTIVE CHECK: Assess the current home state.",
      reflection: `REFLECTION: Review recent actions and triage configuration.${extraContext ? `\n${extraContext}` : ""}`,
      goal_review: "GOAL REVIEW: Check active goals and progress.",
      daily_summary: "DAILY SUMMARY: Summarize today's activity and patterns.",
      automation: `AUTOMATION FIRED: ${extraContext || "An automation has triggered."}`,
    };

    let goalReviewPrompt = "";
    if (wakeupType === "goal_review" && this.goalStore) {
      goalReviewPrompt = await this.buildGoalReviewContext();
    }

    const summaryInstruction = `\n\nAlways begin your response with a single-line summary: **Summary:** <one sentence describing what you found or did>`;

    const prompts: Record<string, string> = {
      situational: `${context}\n\nPROACTIVE CHECK: Briefly assess the current home state. Is anything out of the ordinary? Does anything need attention right now? Be concise — only act if needed. For complex situations requiring deeper analysis, use deep_reason — include all relevant device states, memories, and constraints in the problem description. Check person properties for presence and schedule context.${BEFORE_ACTING_REMINDER}${summaryInstruction}`,
      reflection: `${context}\n\n${extraContext}\n\nREFLECTION: Use memory_query with recent time range and tags like ["action", "outcome"] to recall your recent actions. Did they work as intended? What would you do differently? Store any insights as reflection memories.\n\nTRIAGE REVIEW: Also review your event triage configuration. Were you woken up for events you never acted on? Use list_triage_rules to see your current rules, then silence or batch noisy event sources. Were there events you missed because they were batched or silent? Escalate those to immediate.${summaryInstruction}`,
      goal_review: `${context}\n\n${goalReviewPrompt}\n\nGOAL REVIEW: All active goals with their recent timelines are shown above.\n\nFor each goal, review its timeline, assess progress, and log an observation via goal_log. If a goal is blocked, uncertain, or has reached a milestone, flag it for attention via goal_update. If a goal is achieved, mark it completed. If no longer relevant, mark it abandoned.\n\nAfter reviewing all goals, consider whether new goals should be created based on recent patterns observed across the home.${summaryInstruction}`,
      daily_summary: `${context}\n\nDAILY SUMMARY: Summarize today's activity. What patterns did you notice? What did you learn? What will you do differently tomorrow? Use memory_query to recall today's events and actions, then store a single concise summary as a reflection memory.\n\nFocus on writing the summary. Save maintenance and cleanup for reflection cycles.${summaryInstruction}`,
      automation: `${context}\n\n${extraContext}\n\nAUTOMATION FIRED: An automation has triggered. Follow the Before Acting protocol, then handle the instruction above. Do NOT create a reflex right now — just handle it. Only promote to a reflex after you've successfully handled this same automation multiple times and are confident the action never varies.${BEFORE_ACTING_REMINDER}`,
    };

    const prompt = prompts[wakeupType] ?? prompts.situational!;
    const userPrompt = userPrompts[wakeupType] ?? userPrompts.situational!;
    const trigger: TurnTrigger = wakeupType === "automation" ? "automation" : "proactive";
    const proactiveType = wakeupType !== "automation" ? wakeupType : undefined;
    return this.runEphemeral(prompt, trigger, userPrompt, proactiveType, channel);
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
    const context = await buildAgentContext(this.deviceManager, this.memoryStore, this.peopleStore, undefined, { onboarding: true }, this.goalStore);

    const prompt = `${context}\n\nONBOARDING: You are setting up a new home for the first time. The entity filter is empty — no devices are visible yet. Follow the Onboarding instructions in your system prompt to discover and configure this home. Start by calling list_available_entities.`;

    return this.runEphemeral(prompt, "onboarding", "ONBOARDING: Discovering your home...", undefined, "web:default");
  }

  async handleCycleFeedback(opts: {
    turnId: string;
    cycleType: string;
    cycleResult: string;
    sentiment: "positive" | "negative";
    comment?: string;
  }): Promise<string> {
    const context = await buildAgentContext(this.deviceManager, this.memoryStore, this.peopleStore, undefined, undefined, this.goalStore);

    const sentimentLabel = opts.sentiment === "positive" ? "POSITIVE (thumbs up)" : "NEGATIVE (thumbs down)";
    const commentSection = opts.comment ? `\nUser comment: "${opts.comment}"` : "";

    const prompt = `${context}\n\nCYCLE FEEDBACK: The user rated a ${opts.cycleType} cycle as ${sentimentLabel}.${commentSection}\n\nOriginal cycle output:\n${opts.cycleResult}\n\nReflect on this feedback. What does it tell you about what the user finds helpful or unhelpful? Store relevant insights as memories so you can adjust future ${opts.cycleType} cycles accordingly. For negative feedback, consider what to do differently next time — perhaps be more concise, skip certain checks, or focus on different aspects.`;

    return this.runEphemeral(prompt, "outcome_feedback", `CYCLE FEEDBACK: ${opts.cycleType} rated ${opts.sentiment}`);
  }

  async handleMessageFeedback(opts: {
    messageId: string;
    userMessage: string;
    assistantMessage: string;
    sentiment: "positive" | "negative";
    comment?: string;
  }): Promise<string> {
    const context = await buildAgentContext(this.deviceManager, this.memoryStore, this.peopleStore, undefined, undefined, this.goalStore);

    const sentimentLabel = opts.sentiment === "positive" ? "POSITIVE (thumbs up)" : "NEGATIVE (thumbs down)";
    const commentSection = opts.comment ? `\nUser comment: "${opts.comment}"` : "";

    const prompt = `${context}\n\nMESSAGE FEEDBACK: The user rated your response as ${sentimentLabel}.${commentSection}\n\nExchange:\nUser: ${opts.userMessage}\nYou: ${opts.assistantMessage}\n\nReflect briefly on this feedback. What should you do differently? Store relevant insights as memories so you can adjust future responses accordingly.`;

    return this.runEphemeral(prompt, "outcome_feedback", `MESSAGE FEEDBACK: rated ${opts.sentiment}`);
  }

  async handleOutcomeFeedback(feedback: string): Promise<string> {
    const context = await buildAgentContext(this.deviceManager, this.memoryStore, this.peopleStore, undefined, undefined, this.goalStore);
    const prompt = `${context}\n\nOUTCOME FEEDBACK: ${feedback}\n\nReflect on this feedback. What does it tell you about the user's preferences? Store relevant insights as memories and adjust your future behavior accordingly.`;
    return this.runEphemeral(prompt, "outcome_feedback", `OUTCOME FEEDBACK: ${feedback}`);
  }

  private async processBatch(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const events = this.eventQueue.splice(0);
    const context = await buildAgentContext(this.deviceManager, this.memoryStore, this.peopleStore, undefined, undefined, this.goalStore);

    const eventSummary = events
      .map(
        (e) =>
          `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.deviceId}: ${e.type} — ${JSON.stringify(e.data)}`,
      )
      .join("\n");

    const prompt = `${context}\n\nNew device events:\n${eventSummary}\n\nTriage these events. For complex situations requiring deeper analysis, use deep_reason — include all relevant device states, memories, automations, and constraints in the problem description, as the sub-agent cannot look things up on its own. For straightforward events, handle them directly.\n\nIMPORTANT: If a recalled preference memory describes an automation rule for this event, follow it — reason about conditions yourself and act accordingly. Do NOT create a reflex to handle it.${BEFORE_ACTING_REMINDER}\n\nConsider person properties (presence, schedule) in your context when deciding how to respond.`;

    const userPrompt = `Device events:\n${eventSummary}`;

    // Fire and forget — don't block subsequent batches
    this.runEphemeral(prompt, "device_events", userPrompt).catch((err) => {
      console.error("[EphemeralRunner] Batch processing error:", err);
    });
  }

  private async runEphemeral(promptText: string, trigger: TurnTrigger, userPrompt?: string, proactiveType?: string, channel?: string): Promise<string> {
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
        messageId,
        sessionId: null, // always fresh
        channel,
        coordinatorType: "ephemeral",
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
