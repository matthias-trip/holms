import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { DeviceEvent, TurnTrigger } from "@holms/shared";
import type { EventBus } from "../event-bus.js";
import type { DeviceManager } from "../devices/manager.js";
import type { MemoryStore } from "../memory/store.js";
import type { ApprovalQueue } from "./approval-queue.js";
import type { OutcomeObserver } from "./outcome-observer.js";
import type { HolmsConfig } from "../config.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { createDeviceQueryServer, createDeviceCommandServer } from "../tools/device-tools.js";
import { createMemoryToolsServer } from "../memory/tools.js";
import { createReflexToolsServer } from "../reflex/tools.js";
import { createApprovalToolsServer } from "./approval-queue.js";
import { createScheduleToolsServer } from "../schedule/tools.js";
import { createTriageToolsServer } from "../triage/tools.js";
import type { ReflexStore } from "../reflex/store.js";
import type { ScheduleStore } from "../schedule/store.js";
import type { TriageStore } from "../triage/store.js";
import type { PluginManager } from "../plugins/manager.js";

const BEFORE_ACTING_REMINDER = `\n\nREMINDER: Before any device command, you MUST follow the Before Acting protocol — use memory_query to search for relevant memories (by device name, room, device ID), check for preference constraints, and obey them. Use propose_action if any memory requires approval, if the action is novel, security-sensitive, or uncertain.`;

export class Coordinator {
  private eventQueue: DeviceEvent[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private processing = false;
  private sessionId: string | null = null;
  private currentTurnId: string | null = null;

  private deviceQueryServer;
  private deviceCommandServer;
  private memoryServer;
  private reflexServer;
  private approvalServer;
  private scheduleServer;
  private triageServer;

  constructor(
    private eventBus: EventBus,
    private deviceManager: DeviceManager,
    private memoryStore: MemoryStore,
    private reflexStore: ReflexStore,
    private approvalQueue: ApprovalQueue,
    private outcomeObserver: OutcomeObserver,
    private config: HolmsConfig,
    private scheduleStore: ScheduleStore,
    private triageStore: TriageStore,
    private pluginManager?: PluginManager,
  ) {
    this.deviceQueryServer = createDeviceQueryServer(deviceManager);
    this.deviceCommandServer = createDeviceCommandServer(deviceManager);
    this.memoryServer = createMemoryToolsServer(memoryStore);
    this.reflexServer = createReflexToolsServer(reflexStore);
    this.approvalServer = createApprovalToolsServer(approvalQueue);
    this.scheduleServer = createScheduleToolsServer(scheduleStore);
    this.triageServer = createTriageToolsServer(triageStore);
  }

  enqueueEvent(event: DeviceEvent): void {
    this.eventQueue.push(event);

    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = setTimeout(
      () => this.processBatch(),
      this.config.coordinator.batchDelayMs,
    );
  }

  getCurrentTurnId(): string | null {
    return this.currentTurnId;
  }

  async handleUserRequest(message: string, messageId?: string): Promise<string> {
    const context = await this.buildContext();
    const prompt = `${context}\n\nUser message: ${message}${BEFORE_ACTING_REMINDER}`;
    return this.runQuery(prompt, "user_message", `User: ${message.slice(0, 80)}`, messageId);
  }

  async handleProactiveWakeup(wakeupType: string, extraContext: string = ""): Promise<string> {
    const context = await this.buildContext();

    const prompts: Record<string, string> = {
      situational: `${context}\n\nPROACTIVE CHECK: Briefly assess the current home state. Is anything out of the ordinary? Does anything need attention right now? Be concise — only act if needed. For complex situations requiring deeper analysis, use deep_reason — include all relevant device states, memories, and constraints in the problem description.${BEFORE_ACTING_REMINDER}`,
      reflection: `${context}\n\n${extraContext}\n\nREFLECTION: Review your recent actions and their outcomes. Did they work as intended? What would you do differently? Store any insights as reflection memories.\n\nTRIAGE REVIEW: Also review your event triage configuration. Were you woken up for events you never acted on? Use list_triage_rules to see your current rules, then silence or batch noisy event sources. Were there events you missed because they were batched or silent? Escalate those to immediate.`,
      goal_review: `${context}\n\nGOAL REVIEW: Check your active goals (use memory_query with tags ["goal"]). Are you making progress? Should any goals be updated or retired? Are there new goals worth setting based on what you've observed?`,
      daily_summary: `${context}\n\nDAILY SUMMARY: Summarize today's activity. What patterns did you notice? What did you learn? What will you do differently tomorrow? Store your summary as a reflection memory.`,
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
    return this.runQuery(prompt, trigger, summary);
  }

  async handleOutcomeFeedback(feedback: string): Promise<string> {
    const context = await this.buildContext();
    const prompt = `${context}\n\nOUTCOME FEEDBACK: ${feedback}\n\nReflect on this feedback. What does it tell you about the user's preferences? Store relevant insights as memories and adjust your future behavior accordingly.`;
    return this.runQuery(prompt, "outcome_feedback", "User reversed an action");
  }

  async handleApprovalResult(
    id: string,
    approved: boolean,
    action: { deviceId: string; command: string; params: Record<string, unknown>; reason?: string },
    userReason?: string,
    messageId?: string,
  ): Promise<string> {
    const status = approved ? "approved" : "rejected";
    const actionDesc = `${action.command} on ${action.deviceId} (${JSON.stringify(action.params)})`;
    const context = await this.buildContext();
    const prompt = `${context}\n\nAPPROVAL RESULT: The user ${status} your proposed action: ${actionDesc}.${action.reason ? ` Your reason for proposing: ${action.reason}.` : ""}${userReason ? ` User's reason for rejecting: ${userReason}.` : ""}\n\n${approved ? "The action has already been executed. No further action needed — just acknowledge briefly." : "Reflect on why and store a brief lesson in memory so you avoid repeating the mistake."}`;
    return this.runQuery(prompt, "approval_result", `Approval ${approved ? "granted" : "denied"}`, messageId);
  }

  isProcessing(): boolean {
    return this.processing;
  }

  private async processBatch(): Promise<void> {
    if (this.processing || this.eventQueue.length === 0) return;

    const events = this.eventQueue.splice(0);
    const context = await this.buildContext();

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
    await this.runQuery(prompt, "device_events", summary);
  }

  private async buildContext(): Promise<string> {
    const devices = await this.deviceManager.getAllDevices();
    const deviceSummary = devices
      .map((d) => `${d.name} (${d.id}): ${JSON.stringify(d.state)}`)
      .join("\n");

    return buildSystemPrompt({
      currentTime: new Date().toLocaleString(),
      deviceSummary,
      recentEvents: "See device events below",
    });
  }

  private async runQuery(promptText: string, trigger: TurnTrigger, summary: string, externalMessageId?: string): Promise<string> {
    this.processing = true;
    const messageId = externalMessageId ?? crypto.randomUUID();
    const turnId = crypto.randomUUID();
    this.currentTurnId = turnId;

    this.eventBus.emit("agent:turn_start", {
      turnId,
      trigger,
      summary,
      model: this.config.models.coordinator,
      timestamp: Date.now(),
    });

    this.eventBus.emit("agent:thinking", {
      prompt: promptText.slice(0, 200) + "...",
      timestamp: Date.now(),
    });

    try {
      async function* createPrompt(text: string): AsyncGenerator<SDKUserMessage> {
        yield {
          type: "user" as const,
          message: {
            role: "user" as const,
            content: text,
          },
          session_id: "",
          parent_tool_use_id: null,
        };
      }

      let result = "";
      let streamedText = "";
      let deepReasonToolUseId: string | null = null;
      const deepReasonStartTime = { value: 0 };

      const mcpServers = {
        "device-query": this.deviceQueryServer,
        "device-command": this.deviceCommandServer,
        memory: this.memoryServer,
        reflex: this.reflexServer,
        approval: this.approvalServer,
        schedule: this.scheduleServer,
        triage: this.triageServer,
      };

      const allowedTools = [
        "mcp__device-query__*",
        "mcp__device-command__*",
        "mcp__memory__*",
        "mcp__reflex__*",
        "mcp__approval__*",
        "mcp__schedule__*",
        "mcp__triage__*",
      ];

      const plugins = this.pluginManager?.getEnabledSdkPlugins() ?? [];
      const pluginToolPatterns = this.pluginManager?.getEnabledToolPatterns() ?? [];

      const conversation = query({
        prompt: createPrompt(promptText),
        options: {
          model: this.config.models.coordinator,
          maxTurns: this.config.coordinator.maxTurns,
          mcpServers,
          disallowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch", "NotebookEdit"],
          allowedTools: [...allowedTools, ...pluginToolPatterns],
          ...(plugins.length > 0 ? { plugins } : {}),
          permissionMode: "bypassPermissions",
          includePartialMessages: true,
          ...(this.sessionId ? { resume: this.sessionId } : {}),
          ...(this.config.claudeConfigDir
            ? { env: { ...process.env, CLAUDE_CONFIG_DIR: this.config.claudeConfigDir } }
            : {}),
        },
      });

      for await (const message of conversation) {
        const msg = message as Record<string, unknown>;

        if (msg.type === "system" && msg.subtype === "init") {
          this.sessionId = (msg.session_id as string) ?? this.sessionId;
        }

        if (msg.type === "stream_event" && msg.parent_tool_use_id == null) {
          const event = msg.event as Record<string, unknown> | undefined;
          if (event?.type === "content_block_delta") {
            const delta = event.delta as Record<string, unknown> | undefined;
            if (delta?.type === "text_delta" && typeof delta.text === "string") {
              streamedText += delta.text;
              this.eventBus.emit("chat:token", {
                token: delta.text,
                messageId,
                timestamp: Date.now(),
              });
            }
          }
        }

        if (msg.type === "assistant") {
          const content = msg.message as { content?: unknown[] } | undefined;
          if (content?.content) {
            for (const block of content.content) {
              const b = block as Record<string, unknown>;
              if (b.type === "tool_use") {
                const toolName = b.name as string;
                this.eventBus.emit("agent:tool_use", {
                  tool: toolName,
                  input: b.input,
                  timestamp: Date.now(),
                });

                // Track deep_reason invocations for activity events
                if (toolName === "deep_reason") {
                  deepReasonToolUseId = b.id as string;
                  deepReasonStartTime.value = Date.now();
                  const input = b.input as { problem?: string } | undefined;
                  this.eventBus.emit("deep_reason:start", {
                    problem: input?.problem ?? "",
                    model: this.config.models.deepReason,
                    timestamp: Date.now(),
                  });
                }
              }
            }
          }
        }

        // Emit deep_reason:result when the sub-agent returns
        if (deepReasonToolUseId && msg.type === "user" && msg.parent_tool_use_id === deepReasonToolUseId) {
          const toolResult = msg.tool_use_result as { content?: Array<{ text?: string }> } | string | undefined;
          const analysis = typeof toolResult === "string"
            ? toolResult
            : (toolResult?.content?.[0]?.text ?? "");
          this.eventBus.emit("deep_reason:result", {
            problem: "",
            analysis,
            model: this.config.models.deepReason,
            costUsd: 0,
            inputTokens: 0,
            outputTokens: 0,
            durationMs: Date.now() - deepReasonStartTime.value,
            numTurns: 0,
            timestamp: Date.now(),
          });
          deepReasonToolUseId = null;
        }

        if (msg.type === "result") {
          if (msg.subtype === "success") {
            result = (msg.result as string) ?? "";
          } else {
            result = `Error: ${(msg.error as string) ?? "Unknown error"}`;
          }

          // Extract summary from proactive cycle responses
          const summaryMatch = result.match(/<!--\s*summary:\s*(.+?)\s*-->/);
          const cycleSummary = summaryMatch?.[1] ?? null;
          if (summaryMatch) {
            result = result.replace(summaryMatch[0], "").trimEnd();
          }

          const usage = msg.usage as { input_tokens?: number; output_tokens?: number } | undefined;
          this.eventBus.emit("agent:result", {
            result,
            summary: cycleSummary,
            model: this.config.models.coordinator,
            costUsd: (msg.cost_usd as number) ?? 0,
            inputTokens: usage?.input_tokens ?? 0,
            outputTokens: usage?.output_tokens ?? 0,
            durationMs: (msg.duration_ms as number) ?? 0,
            numTurns: (msg.num_turns as number) ?? 0,
            timestamp: Date.now(),
          });
        }
      }

      // Include intermediate reasoning if it differs from the final result
      const reasoning = streamedText.trim() && streamedText.trim() !== result.trim()
        ? streamedText.trim()
        : undefined;

      this.eventBus.emit("chat:stream_end", {
        messageId,
        content: result,
        reasoning,
        timestamp: Date.now(),
      });

      if (result) {
        this.eventBus.emit("chat:response", {
          message: result,
          timestamp: Date.now(),
        });
      }

      return result;
    } catch (error) {
      const errorMsg = `Coordinator error: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[Coordinator] ${errorMsg}`);

      this.eventBus.emit("agent:result", {
        result: errorMsg,
        model: this.config.models.coordinator,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
        numTurns: 0,
        timestamp: Date.now(),
      });

      this.eventBus.emit("chat:stream_end", {
        messageId,
        content: errorMsg,
        timestamp: Date.now(),
      });

      return errorMsg;
    } finally {
      this.processing = false;
      this.currentTurnId = null;
    }
  }
}
