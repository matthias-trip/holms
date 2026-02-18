import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  SpecialistDomain,
  SpecialistProposal,
  ConflictFlag,
  SpecialistResult,
  Device,
} from "@holms/shared";
import type { DeviceManager } from "../devices/manager.js";
import type { MemoryStore } from "../memory/store.js";
import type { EventBus } from "../event-bus.js";
import type { HolmsConfig } from "../config.js";
import { createDeviceQueryServer } from "../tools/device-tools.js";
import { createScopedMemoryToolsServer } from "../memory/tools.js";
import { createSpecialistToolsServer } from "./tools.js";
import { loadSkill, buildSpecialistPrompt } from "./prompt-loader.js";

export class SpecialistRunner {
  constructor(
    private deviceManager: DeviceManager,
    private memoryStore: MemoryStore,
    private eventBus: EventBus,
    private config: HolmsConfig,
  ) {}

  async run(
    domain: SpecialistDomain,
    context: string,
    relevantDeviceIds: string[],
  ): Promise<SpecialistResult> {
    this.eventBus.emit("specialist:dispatched", {
      specialist: domain,
      context,
      deviceIds: relevantDeviceIds,
      model: this.config.models.specialist,
      timestamp: Date.now(),
    });

    // Gather relevant devices
    const allDevices = await this.deviceManager.getAllDevices();
    const devices: Device[] = relevantDeviceIds.length > 0
      ? allDevices.filter((d) => relevantDeviceIds.includes(d.id))
      : allDevices;

    // Get scoped + shared memories
    const memories = this.memoryStore.getAllScoped([domain]);

    // Load skill and build prompt
    const skillContent = loadSkill(domain);
    const promptText = buildSpecialistPrompt(skillContent, {
      domain,
      devices,
      memories: memories.slice(0, 20),
      currentTime: new Date().toLocaleString(),
      eventContext: context,
    });

    // Create MCP servers for the specialist
    const deviceQueryServer = createDeviceQueryServer(this.deviceManager);
    const memoryServer = createScopedMemoryToolsServer(this.memoryStore, domain);
    const specialistServer = createSpecialistToolsServer(domain);

    const mcpServers = {
      "device-query": deviceQueryServer,
      [`memory-${domain}`]: memoryServer,
      [`specialist-${domain}`]: specialistServer,
    };

    const allowedTools = [
      "mcp__device-query__*",
      `mcp__memory-${domain}__*`,
      `mcp__specialist-${domain}__*`,
    ];

    // Run the specialist query
    const proposals: SpecialistProposal[] = [];
    const conflicts: ConflictFlag[] = [];
    let reasoning = "";
    let costUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let durationMs = 0;
    let numTurns = 0;

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

      const conversation = query({
        prompt: createPrompt(promptText),
        options: {
          model: this.config.models.specialist,
          maxTurns: 5,
          mcpServers,
          allowedTools,
          permissionMode: "bypassPermissions",
          ...(this.config.claudeConfigDir
            ? { env: { ...process.env, CLAUDE_CONFIG_DIR: this.config.claudeConfigDir } }
            : {}),
        },
      });

      for await (const message of conversation) {
        const msg = message as Record<string, unknown>;

        // Collect tool results containing proposals/conflicts
        if (msg.type === "assistant") {
          const content = msg.message as { content?: unknown[] } | undefined;
          if (content?.content) {
            for (const block of content.content) {
              const b = block as Record<string, unknown>;
              if (b.type === "tool_use") {
                this.eventBus.emit("agent:tool_use", {
                  tool: `specialist:${domain}:${b.name as string}`,
                  input: b.input,
                  timestamp: Date.now(),
                  agentId: domain,
                } as Record<string, unknown> & { tool: string; input: unknown; timestamp: number });
              }
            }
          }
        }

        // Parse tool results for proposals and conflicts
        if (msg.type === "tool_result") {
          const content = msg.content as unknown[] | undefined;
          if (content) {
            for (const block of content) {
              const b = block as Record<string, unknown>;
              if (b.type === "text" && typeof b.text === "string") {
                try {
                  const parsed = JSON.parse(b.text) as Record<string, unknown>;
                  if (parsed._type === "proposal") {
                    proposals.push(parsed as unknown as SpecialistProposal);
                  } else if (parsed._type === "conflict") {
                    conflicts.push(parsed as unknown as ConflictFlag);
                  }
                } catch {
                  // Not JSON, ignore
                }
              }
            }
          }
        }

        if (msg.type === "result") {
          if (msg.subtype === "success") {
            reasoning = (msg.result as string) ?? "";
          }
          costUsd = (msg.cost_usd as number) ?? 0;
          const usage = msg.usage as { input_tokens?: number; output_tokens?: number } | undefined;
          inputTokens = usage?.input_tokens ?? 0;
          outputTokens = usage?.output_tokens ?? 0;
          durationMs = (msg.duration_ms as number) ?? 0;
          numTurns = (msg.num_turns as number) ?? 0;
        }
      }
    } catch (error) {
      reasoning = `Specialist ${domain} error: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[SpecialistRunner] ${reasoning}`);
    }

    const result: SpecialistResult = {
      specialist: domain,
      proposals,
      reasoning,
      conflicts,
    };

    this.eventBus.emit("specialist:result", {
      specialist: domain,
      proposals,
      reasoning,
      model: this.config.models.specialist,
      costUsd,
      inputTokens,
      outputTokens,
      durationMs,
      numTurns,
      timestamp: Date.now(),
    });

    return result;
  }
}
