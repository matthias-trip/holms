import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { TurnTrigger } from "@holms/shared";
import type { EventBus } from "../event-bus.js";
import type { DeviceManager } from "../devices/manager.js";
import type { MemoryStore } from "../memory/store.js";
import type { HolmsConfig } from "../config.js";
import type { PluginManager } from "../plugins/manager.js";
import type { McpServerPool } from "./mcp-pool.js";
import { buildSystemPrompt } from "./system-prompt.js";

// ── Shared constants ──

export const DISALLOWED_TOOLS = [
  "Bash", "Read", "Write", "Edit", "Glob", "Grep",
  "WebSearch", "WebFetch", "NotebookEdit",
];

export const BEFORE_ACTING_REMINDER = `\n\nREMINDER: Before any device command, you MUST follow the Before Acting protocol — use memory_query to search for relevant memories (by device name, room, device ID), check for preference constraints, and obey them. Use propose_action if any memory requires approval, if the action is novel, security-sensitive, or uncertain.`;

// ── Prompt helper ──

export function createSDKPrompt(text: string): () => AsyncGenerator<SDKUserMessage> {
  return async function* () {
    yield {
      type: "user" as const,
      message: { role: "user" as const, content: text },
      session_id: "",
      parent_tool_use_id: null,
    };
  };
}

// ── Metric extraction ──

export interface QueryMetrics {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
}

export function extractResultMetrics(event: Record<string, unknown>): QueryMetrics {
  const usage = event.usage as { input_tokens?: number; output_tokens?: number } | undefined;

  const modelUsage = event.modelUsage as Record<string, {
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  }> | undefined;

  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  if (modelUsage) {
    for (const mu of Object.values(modelUsage)) {
      cacheReadTokens += mu.cacheReadInputTokens ?? 0;
      cacheCreationTokens += mu.cacheCreationInputTokens ?? 0;
    }
  }

  return {
    costUsd: (event.cost_usd as number) ?? 0,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens,
    cacheCreationTokens,
    durationMs: (event.duration_ms as number) ?? 0,
    durationApiMs: (event.duration_api_ms as number) ?? 0,
    numTurns: (event.num_turns as number) ?? 0,
  };
}

// ── Context builder ──

export async function buildAgentContext(
  deviceManager: DeviceManager,
  memoryStore: MemoryStore,
): Promise<string> {
  const devices = await deviceManager.getAllDevices();
  const entityNotes = memoryStore.getEntityNotes();
  const deviceSummary = devices
    .map((d) => {
      const line = `${d.name} (${d.id}): ${JSON.stringify(d.state)}`;
      const note = entityNotes.get(d.id);
      return note ? `${line}\n  note: "${note.content}"` : line;
    })
    .join("\n");

  return buildSystemPrompt({
    currentTime: new Date().toLocaleString(),
    deviceSummary,
    recentEvents: "See device events below",
  });
}

// ── Tool query (full MCP-enabled query used by ChatCoordinator + EphemeralRunner) ──

export interface ToolQueryOptions {
  eventBus: EventBus;
  config: HolmsConfig;
  mcpPool: McpServerPool;
  pluginManager?: PluginManager;
  promptText: string;
  trigger: TurnTrigger;
  summary: string;
  messageId: string;
  /** Pass null for ephemeral (fresh session), or a string to resume a stateful session */
  sessionId: string | null;
}

export interface ToolQueryResult {
  result: string;
  reasoning?: string;
  sessionId: string | null;
  metrics: QueryMetrics;
}

export async function runToolQuery(opts: ToolQueryOptions): Promise<ToolQueryResult> {
  const turnId = crypto.randomUUID();

  opts.eventBus.emit("agent:turn_start", {
    turnId,
    trigger: opts.trigger,
    summary: opts.summary,
    model: opts.config.models.coordinator,
    timestamp: Date.now(),
  });

  opts.eventBus.emit("agent:thinking", {
    prompt: opts.promptText.slice(0, 200) + "...",
    timestamp: Date.now(),
  });

  let result = "";
  let streamedText = "";
  let deepReasonToolUseId: string | null = null;
  let deepReasonStartTime = 0;
  let newSessionId: string | null = opts.sessionId;

  const plugins = opts.pluginManager?.getEnabledSdkPlugins() ?? [];
  const pluginToolPatterns = opts.pluginManager?.getEnabledToolPatterns() ?? [];

  const conversation = query({
    prompt: createSDKPrompt(opts.promptText)(),
    options: {
      model: opts.config.models.coordinator,
      maxTurns: opts.config.coordinator.maxTurns,
      mcpServers: opts.mcpPool.servers,
      disallowedTools: DISALLOWED_TOOLS,
      allowedTools: [...opts.mcpPool.allowedTools, ...pluginToolPatterns],
      ...(plugins.length > 0 ? { plugins } : {}),
      permissionMode: "bypassPermissions",
      includePartialMessages: true,
      ...(opts.sessionId ? { resume: opts.sessionId } : {}),
      ...(opts.config.claudeConfigDir
        ? { env: { ...process.env, CLAUDE_CONFIG_DIR: opts.config.claudeConfigDir } }
        : {}),
    },
  });

  for await (const message of conversation) {
    const msg = message as Record<string, unknown>;

    if (msg.type === "system" && msg.subtype === "init") {
      newSessionId = (msg.session_id as string) ?? newSessionId;
    }

    if (msg.type === "stream_event" && msg.parent_tool_use_id == null) {
      const event = msg.event as Record<string, unknown> | undefined;
      if (event?.type === "content_block_delta") {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          streamedText += delta.text;
          opts.eventBus.emit("chat:token", {
            token: delta.text,
            messageId: opts.messageId,
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
            opts.eventBus.emit("agent:tool_use", {
              tool: toolName,
              input: b.input,
              timestamp: Date.now(),
            });

            if (toolName === "deep_reason") {
              deepReasonToolUseId = b.id as string;
              deepReasonStartTime = Date.now();
              const input = b.input as { problem?: string } | undefined;
              opts.eventBus.emit("deep_reason:start", {
                problem: input?.problem ?? "",
                model: opts.config.models.deepReason,
                timestamp: Date.now(),
              });
            }
          }
        }
      }
    }

    if (deepReasonToolUseId && msg.type === "user" && msg.parent_tool_use_id === deepReasonToolUseId) {
      const toolResult = msg.tool_use_result as { content?: Array<{ text?: string }> } | string | undefined;
      const analysis = typeof toolResult === "string"
        ? toolResult
        : (toolResult?.content?.[0]?.text ?? "");
      opts.eventBus.emit("deep_reason:result", {
        problem: "",
        analysis,
        model: opts.config.models.deepReason,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        durationMs: Date.now() - deepReasonStartTime,
        durationApiMs: 0,
        numTurns: 0,
        totalCostUsd: 0,
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

      const summaryMatch = result.match(/<!--\s*summary:\s*(.+?)\s*-->/);
      const cycleSummary = summaryMatch?.[1] ?? null;
      if (summaryMatch) {
        result = result.replace(summaryMatch[0], "").trimEnd();
      }

      const metrics = extractResultMetrics(msg);

      opts.eventBus.emit("agent:result", {
        result,
        summary: cycleSummary,
        model: opts.config.models.coordinator,
        ...metrics,
        totalCostUsd: metrics.costUsd,
        timestamp: Date.now(),
      });
    }
  }

  const reasoning = streamedText.trim() && streamedText.trim() !== result.trim()
    ? streamedText.trim()
    : undefined;

  opts.eventBus.emit("chat:stream_end", {
    messageId: opts.messageId,
    content: result,
    reasoning,
    timestamp: Date.now(),
  });

  if (result) {
    opts.eventBus.emit("chat:response", {
      message: result,
      timestamp: Date.now(),
    });
  }

  const finalMetrics: QueryMetrics = {
    costUsd: 0, inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheCreationTokens: 0,
    durationMs: 0, durationApiMs: 0, numTurns: 0,
  };

  return { result, reasoning, sessionId: newSessionId, metrics: finalMetrics };
}

// ── Simple tracked query (no MCP tools, used for suggestions etc.) ──

export interface TrackedQueryOptions {
  eventBus: EventBus;
  model: string;
  trigger: TurnTrigger;
  summary: string;
  promptText: string;
  systemPrompt: string;
  maxTurns?: number;
  claudeConfigDir?: string;
}

export async function runTrackedQuery(opts: TrackedQueryOptions): Promise<{ result: string; metrics: QueryMetrics }> {
  const turnId = crypto.randomUUID();
  const startTime = Date.now();

  opts.eventBus.emit("agent:turn_start", {
    turnId,
    trigger: opts.trigger,
    summary: opts.summary,
    model: opts.model,
    timestamp: startTime,
  });

  let resultText = "";
  let resultEvent: Record<string, unknown> | null = null;

  for await (const event of query({
    prompt: createSDKPrompt(opts.promptText)(),
    options: {
      model: opts.model,
      maxTurns: opts.maxTurns ?? 1,
      systemPrompt: opts.systemPrompt,
      permissionMode: "bypassPermissions",
      disallowedTools: DISALLOWED_TOOLS,
      ...(opts.claudeConfigDir
        ? { env: { ...process.env, CLAUDE_CONFIG_DIR: opts.claudeConfigDir } }
        : {}),
    },
  })) {
    const msg = event as Record<string, unknown>;
    if (msg.type === "result") {
      resultText = (msg.subtype === "success" ? msg.result as string : `Error: ${msg.error as string}`) ?? "";
      resultEvent = msg;
    }
  }

  const metrics = resultEvent ? extractResultMetrics(resultEvent) : {
    costUsd: 0, inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheCreationTokens: 0,
    durationMs: Date.now() - startTime, durationApiMs: 0, numTurns: 0,
  };

  opts.eventBus.emit("agent:result", {
    result: resultText,
    model: opts.model,
    ...metrics,
    totalCostUsd: metrics.costUsd,
    timestamp: Date.now(),
  });

  return { result: resultText, metrics };
}
