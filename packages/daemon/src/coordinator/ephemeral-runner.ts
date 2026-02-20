import type { DeviceEvent, TurnTrigger } from "@holms/shared";
import type { EventBus } from "../event-bus.js";
import type { DeviceManager } from "../devices/manager.js";
import type { MemoryStore } from "../memory/store.js";
import type { HolmsConfig } from "../config.js";
import type { PluginManager } from "../plugins/manager.js";
import type { McpServerPool } from "./mcp-pool.js";
import { runToolQuery, buildAgentContext, BEFORE_ACTING_REMINDER } from "./query-runner.js";

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
  ) {}

  enqueueEvent(event: DeviceEvent): void {
    this.eventQueue.push(event);

    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = setTimeout(
      () => this.processBatch(),
      this.config.coordinator.batchDelayMs,
    );
  }

  async handleProactiveWakeup(wakeupType: string, extraContext: string = ""): Promise<string> {
    const context = await buildAgentContext(this.deviceManager, this.memoryStore);

    const prompts: Record<string, string> = {
      situational: `${context}\n\nPROACTIVE CHECK: Briefly assess the current home state. Is anything out of the ordinary? Does anything need attention right now? Be concise — only act if needed. For complex situations requiring deeper analysis, use deep_reason — include all relevant device states, memories, and constraints in the problem description.${BEFORE_ACTING_REMINDER}`,
      reflection: `${context}\n\n${extraContext}\n\nREFLECTION: Review your recent actions and their outcomes. Did they work as intended? What would you do differently? Store any insights as reflection memories.\n\nTRIAGE REVIEW: Also review your event triage configuration. Were you woken up for events you never acted on? Use list_triage_rules to see your current rules, then silence or batch noisy event sources. Were there events you missed because they were batched or silent? Escalate those to immediate.`,
      goal_review: `${context}\n\nGOAL REVIEW: Check your active goals (use memory_query with tags ["goal"]). Are you making progress? Should any goals be updated or retired? Are there new goals worth setting based on what you've observed?`,
      daily_summary: `${context}\n\nDAILY SUMMARY: Summarize today's activity. What patterns did you notice? What did you learn? What will you do differently tomorrow? Use memory_query to recall today's events and actions, then store a single concise summary as a reflection memory.\n\nDo NOT use memory_reflect or perform memory maintenance/cleanup — just write the summary.`,
      schedule: `${context}\n\n${extraContext}\n\nSCHEDULE FIRED: A scheduled task has triggered. Follow the Before Acting protocol, then handle the instruction above. Do NOT create a reflex right now — just handle it. Only promote to a reflex after you've successfully handled this same schedule multiple times and are confident the action never varies.${BEFORE_ACTING_REMINDER}`,
    };

    let prompt = prompts[wakeupType] ?? prompts.situational!;
    if (wakeupType !== "schedule") {
      prompt += `\n\nFinally, end your response with a one-sentence summary of what you did or observed in this format: <!-- summary: your sentence here -->`;
    }
    const trigger: TurnTrigger = wakeupType === "schedule" ? "schedule" : "proactive";
    const summary = wakeupType === "schedule"
      ? `Schedule fired: ${extraContext.slice(0, 80)}`
      : `Proactive: ${wakeupType}`;
    return this.runEphemeral(prompt, trigger, summary);
  }

  async handleOutcomeFeedback(feedback: string): Promise<string> {
    const context = await buildAgentContext(this.deviceManager, this.memoryStore);
    const prompt = `${context}\n\nOUTCOME FEEDBACK: ${feedback}\n\nReflect on this feedback. What does it tell you about the user's preferences? Store relevant insights as memories and adjust your future behavior accordingly.`;
    return this.runEphemeral(prompt, "outcome_feedback", "User reversed an action");
  }

  private async processBatch(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const events = this.eventQueue.splice(0);
    const context = await buildAgentContext(this.deviceManager, this.memoryStore);

    const eventSummary = events
      .map(
        (e) =>
          `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.deviceId}: ${e.type} — ${JSON.stringify(e.data)}`,
      )
      .join("\n");

    const prompt = `${context}\n\nNew device events:\n${eventSummary}\n\nTriage these events. For complex situations requiring deeper analysis, use deep_reason — include all relevant device states, memories, schedules, and constraints in the problem description, as the sub-agent cannot look things up on its own. For straightforward events, handle them directly.\n\nIMPORTANT: If a recalled preference memory describes an automation rule for this event, follow it — reason about conditions yourself and act accordingly. Do NOT create a reflex to handle it.${BEFORE_ACTING_REMINDER}`;

    const summary = events.length === 1
      ? `${events[0]!.deviceId}: ${events[0]!.type}`
      : `${events.length} device events`;

    // Fire and forget — don't block subsequent batches
    this.runEphemeral(prompt, "device_events", summary).catch((err) => {
      console.error("[EphemeralRunner] Batch processing error:", err);
    });
  }

  private async runEphemeral(promptText: string, trigger: TurnTrigger, summary: string): Promise<string> {
    const messageId = crypto.randomUUID();

    try {
      const { result } = await runToolQuery({
        eventBus: this.eventBus,
        config: this.config,
        mcpPool: this.mcpPool,
        pluginManager: this.pluginManager,
        promptText,
        trigger,
        summary,
        messageId,
        sessionId: null, // always fresh
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
