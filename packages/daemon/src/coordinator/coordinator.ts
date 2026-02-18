import { query, tool, createSdkMcpServer, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { DeviceEvent, SpecialistResult, TurnTrigger } from "@holms/shared";
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
import type { SpecialistRunner } from "../specialists/runner.js";
import type { SpecialistRegistry } from "../specialists/registry.js";
import { detectConflicts } from "../specialists/conflict-resolver.js";

const BEFORE_ACTING_REMINDER = `\n\nREMINDER: Before any device command, you MUST follow the Before Acting protocol — recall memories (search by device name, room, AND device ID), check for preference constraints, and obey them. Use propose_action if any memory requires approval, if the action is novel, security-sensitive, or uncertain.`;

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
  private dispatchServer;
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
    private specialistRunner: SpecialistRunner,
    private specialistRegistry: SpecialistRegistry,
    private scheduleStore: ScheduleStore,
    private triageStore: TriageStore,
  ) {
    this.deviceQueryServer = createDeviceQueryServer(deviceManager);
    this.deviceCommandServer = createDeviceCommandServer(deviceManager);
    this.memoryServer = createMemoryToolsServer(memoryStore);
    this.reflexServer = createReflexToolsServer(reflexStore);
    this.approvalServer = createApprovalToolsServer(approvalQueue);
    this.dispatchServer = this.createDispatchServer();
    this.scheduleServer = createScheduleToolsServer(scheduleStore);
    this.triageServer = createTriageToolsServer(triageStore);
  }

  private createDispatchServer() {
    const runner = this.specialistRunner;
    const eventBus = this.eventBus;
    const domains = this.specialistRegistry.getDomains();

    const dispatchToSpecialist = tool(
      "dispatch_to_specialist",
      "Dispatch a task to a domain specialist for analysis. The specialist will reason about the situation and propose actions — it will NOT execute them. You decide which specialist(s) to consult and which devices are relevant. Multiple specialists can reason about the same device.",
      {
        specialist: z
          .enum(domains as [string, ...string[]])
          .describe("Which specialist to consult"),
        context: z
          .string()
          .describe("Description of the situation for the specialist to analyze"),
        relevantDeviceIds: z
          .array(z.string())
          .describe("Device IDs the specialist should focus on"),
      },
      async (args) => {
        eventBus.emit("agent:tool_use", {
          tool: `specialist:${args.specialist}`,
          input: args,
          timestamp: Date.now(),
        });

        const result: SpecialistResult = await runner.run(
          args.specialist as typeof domains[number],
          args.context,
          args.relevantDeviceIds,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      },
    );

    return createSdkMcpServer({
      name: "dispatch",
      version: "1.0.0",
      tools: [dispatchToSpecialist],
    });
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

  async handleUserRequest(message: string): Promise<string> {
    const context = await this.buildContext();
    const prompt = `${context}\n\nUser message: ${message}${BEFORE_ACTING_REMINDER}`;
    return this.runQuery(prompt, "user_message", `User: ${message.slice(0, 80)}`);
  }

  async handleProactiveWakeup(wakeupType: string, extraContext: string = ""): Promise<string> {
    const context = await this.buildContext();

    const prompts: Record<string, string> = {
      situational: `${context}\n\nPROACTIVE CHECK: Briefly assess the current home state. Is anything out of the ordinary? Does anything need attention right now? Be concise — only act if needed. Dispatch to specialists if domain-specific analysis is needed.${BEFORE_ACTING_REMINDER}`,
      reflection: `${context}\n\n${extraContext}\n\nREFLECTION: Review your recent actions and their outcomes. Did they work as intended? What would you do differently? Store any insights as reflection memories.\n\nTRIAGE REVIEW: Also review your event triage configuration. Were you woken up for events you never acted on? Use list_triage_rules to see your current rules, then silence or batch noisy event sources. Were there events you missed because they were batched or silent? Escalate those to immediate.`,
      goal_review: `${context}\n\nGOAL REVIEW: Check your active goals (recall memories of type "goal"). Are you making progress? Should any goals be updated or retired? Are there new goals worth setting based on what you've observed?`,
      daily_summary: `${context}\n\nDAILY SUMMARY: Summarize today's activity. What patterns did you notice? What did you learn? What will you do differently tomorrow? Store your summary as a reflection memory.`,
      schedule: `${context}\n\n${extraContext}\n\nSCHEDULE FIRED: A scheduled task has triggered. Follow the Before Acting protocol, then handle the instruction above. Do NOT create a reflex right now — just handle it. Only promote to a reflex after you've successfully handled this same schedule multiple times and are confident the action never varies.${BEFORE_ACTING_REMINDER}`,
    };

    const prompt = prompts[wakeupType] ?? prompts.situational!;
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
    reason?: string,
  ): Promise<string> {
    const status = approved ? "approved" : `rejected${reason ? `: ${reason}` : ""}`;
    const context = await this.buildContext();
    const prompt = `${context}\n\nAPPROVAL RESULT: Your proposed action (ID: ${id}) was ${status}. ${reason ? `User's reason: ${reason}` : ""}\n\nIf rejected, reflect on why and store the lesson. If approved, note that this type of action is acceptable.`;
    return this.runQuery(prompt, "approval_result", `Approval ${approved ? "granted" : "denied"}`);
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

    const prompt = `${context}\n\nNew device events:\n${eventSummary}\n\nTriage these events. For domain-specific matters, dispatch to the appropriate specialist(s) with the relevant device IDs. For cross-domain coordination, collect specialist proposals and then arbitrate.\n\nIMPORTANT: If a recalled preference memory describes an automation rule for this event, follow it — reason about conditions yourself and act accordingly. Do NOT create a reflex to handle it.${BEFORE_ACTING_REMINDER}`;

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

    const specialists = this.specialistRegistry.toPromptDescription();

    return buildSystemPrompt({
      currentTime: new Date().toLocaleString(),
      deviceSummary,
      recentEvents: "See device events below",
      specialists,
    });
  }

  private async runQuery(promptText: string, trigger: TurnTrigger, summary: string): Promise<string> {
    this.processing = true;
    const messageId = crypto.randomUUID();
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

      const mcpServers = {
        "device-query": this.deviceQueryServer,
        "device-command": this.deviceCommandServer,
        memory: this.memoryServer,
        reflex: this.reflexServer,
        approval: this.approvalServer,
        dispatch: this.dispatchServer,
        schedule: this.scheduleServer,
        triage: this.triageServer,
      };

      const allowedTools = [
        "mcp__device-query__*",
        "mcp__device-command__*",
        "mcp__memory__*",
        "mcp__reflex__*",
        "mcp__approval__*",
        "mcp__dispatch__*",
        "mcp__schedule__*",
        "mcp__triage__*",
      ];

      const conversation = query({
        prompt: createPrompt(promptText),
        options: {
          model: this.config.models.coordinator,
          maxTurns: this.config.coordinator.maxTurns,
          mcpServers,
          allowedTools,
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
                this.eventBus.emit("agent:tool_use", {
                  tool: b.name as string,
                  input: b.input,
                  timestamp: Date.now(),
                });
              }
            }
          }
        }

        if (msg.type === "result") {
          if (msg.subtype === "success") {
            result = (msg.result as string) ?? "";
          } else {
            result = `Error: ${(msg.error as string) ?? "Unknown error"}`;
          }

          const usage = msg.usage as { input_tokens?: number; output_tokens?: number } | undefined;
          this.eventBus.emit("agent:result", {
            result,
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

      this.eventBus.emit("chat:stream_end", {
        messageId,
        content: result,
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
