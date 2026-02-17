import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { DeviceEvent } from "@holms/shared";
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
import type { ReflexStore } from "../reflex/store.js";

export class Coordinator {
  private eventQueue: DeviceEvent[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private processing = false;
  private sessionId: string | null = null;

  private deviceQueryServer;
  private deviceCommandServer;
  private memoryServer;
  private reflexServer;
  private approvalServer;

  constructor(
    private eventBus: EventBus,
    private deviceManager: DeviceManager,
    private memoryStore: MemoryStore,
    private reflexStore: ReflexStore,
    private approvalQueue: ApprovalQueue,
    private outcomeObserver: OutcomeObserver,
    private config: HolmsConfig,
  ) {
    this.deviceQueryServer = createDeviceQueryServer(deviceManager);
    this.deviceCommandServer = createDeviceCommandServer(deviceManager);
    this.memoryServer = createMemoryToolsServer(memoryStore);
    this.reflexServer = createReflexToolsServer(reflexStore);
    this.approvalServer = createApprovalToolsServer(approvalQueue);
  }

  enqueueEvent(event: DeviceEvent): void {
    this.eventQueue.push(event);

    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = setTimeout(
      () => this.processBatch(),
      this.config.coordinator.batchDelayMs,
    );
  }

  async handleUserRequest(message: string): Promise<string> {
    const context = await this.buildContext();
    const prompt = `${context}\n\nUser message: ${message}`;
    return this.runQuery(prompt);
  }

  async handleProactiveWakeup(wakeupType: string, extraContext: string = ""): Promise<string> {
    const context = await this.buildContext();

    const prompts: Record<string, string> = {
      situational: `${context}\n\nPROACTIVE CHECK: Briefly assess the current home state. Is anything out of the ordinary? Does anything need attention right now? Be concise — only act if needed.`,
      reflection: `${context}\n\n${extraContext}\n\nREFLECTION: Review your recent actions and their outcomes. Did they work as intended? What would you do differently? Store any insights as reflection memories.`,
      goal_review: `${context}\n\nGOAL REVIEW: Check your active goals (recall memories of type "goal"). Are you making progress? Should any goals be updated or retired? Are there new goals worth setting based on what you've observed?`,
      daily_summary: `${context}\n\nDAILY SUMMARY: Summarize today's activity. What patterns did you notice? What did you learn? What will you do differently tomorrow? Store your summary as a reflection memory.`,
    };

    const prompt = prompts[wakeupType] ?? prompts.situational!;
    return this.runQuery(prompt);
  }

  async handleOutcomeFeedback(feedback: string): Promise<string> {
    const context = await this.buildContext();
    const prompt = `${context}\n\nOUTCOME FEEDBACK: ${feedback}\n\nReflect on this feedback. What does it tell you about the user's preferences? Store relevant insights as memories and adjust your future behavior accordingly.`;
    return this.runQuery(prompt);
  }

  async handleApprovalResult(
    id: string,
    approved: boolean,
    reason?: string,
  ): Promise<string> {
    const status = approved ? "approved" : `rejected${reason ? `: ${reason}` : ""}`;
    const context = await this.buildContext();
    const prompt = `${context}\n\nAPPROVAL RESULT: Your proposed action (ID: ${id}) was ${status}. ${reason ? `User's reason: ${reason}` : ""}\n\nIf rejected, reflect on why and store the lesson. If approved, note that this type of action is acceptable.`;
    return this.runQuery(prompt);
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

    const prompt = `${context}\n\nNew device events:\n${eventSummary}\n\nFirst recall any relevant memories, then decide what action (if any) to take. Remember to categorize your actions by confidence/risk.`;

    await this.runQuery(prompt);
  }

  private async buildContext(): Promise<string> {
    const devices = await this.deviceManager.getAllDevices();
    const deviceSummary = devices
      .map((d) => `${d.name} (${d.id}): ${JSON.stringify(d.state)}`)
      .join("\n");

    const recentMemories = this.memoryStore.getAll().slice(0, 10);
    const recentEvents = "See device events below";

    return buildSystemPrompt({
      currentTime: new Date().toLocaleString(),
      deviceSummary,
      recentEvents,
    });
  }

  private async runQuery(promptText: string): Promise<string> {
    this.processing = true;

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
      };

      const allowedTools = [
        "mcp__device-query__*",
        "mcp__device-command__*",
        "mcp__memory__*",
        "mcp__reflex__*",
        "mcp__approval__*",
      ];

      const conversation = query({
        prompt: createPrompt(promptText),
        options: {
          maxTurns: this.config.coordinator.maxTurns,
          mcpServers,
          allowedTools,
          permissionMode: "bypassPermissions",
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

          this.eventBus.emit("agent:result", {
            result,
            cost: (msg.cost_usd as number) ?? 0,
            timestamp: Date.now(),
          });
        }
      }

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
      return errorMsg;
    } finally {
      this.processing = false;
    }
  }
}
