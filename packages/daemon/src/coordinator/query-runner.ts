import { query, type SDKUserMessage, type AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { TurnTrigger } from "@holms/shared";
import type { EventBus } from "../event-bus.js";
import type { DeviceManager } from "../devices/manager.js";
import type { MemoryStore } from "../memory/store.js";
import type { HolmsConfig } from "../config.js";
import type { PluginManager } from "../plugins/manager.js";
import type { PeopleStore } from "../people/store.js";
import type { GoalStore } from "../goals/store.js";
import type { McpServerPool } from "./mcp-pool.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { runWithChannel } from "./query-context.js";

// ── Shared constants ──

export const DISALLOWED_TOOLS = [
  "Bash", "Read", "Write", "Edit", "Glob", "Grep",
  "WebSearch", "WebFetch", "NotebookEdit",
];

export const BEFORE_ACTING_REMINDER = `\n\nREMINDER: Before any device command → memory_query first (device name, room, ID). Obey preference constraints. Use propose_action if required by memory, novel, security-sensitive, or uncertain.`;

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
  peopleStore?: PeopleStore,
  memoryScope?: string,
  opts?: { onboarding?: boolean },
  goalStore?: GoalStore,
): Promise<string> {
  const devices = await deviceManager.getAllDevices();
  const pinnedByEntity = memoryStore.getPinnedByEntity();
  const deviceSummary = devices
    .map((d) => {
      const areaStr = d.area.floor ? `${d.area.name}, ${d.area.floor}` : d.area.name;
      const availStr = d.availability.online ? "online" : "OFFLINE";
      const caps = d.capabilities.map((c) => c.name).join(", ");
      const stateStr = Object.keys(d.state).length > 0
        ? ` | ${JSON.stringify(d.state)}`
        : "";
      let line = `${d.name} (${d.id}) [${d.domain}, ${areaStr}, ${availStr}] | ${caps}${stateStr}`;
      const pinned = pinnedByEntity.get(d.id);
      if (pinned && pinned.length > 0) {
        for (const m of pinned) {
          line += `\n  note: "${m.content}"`;
        }
      }
      return line;
    })
    .join("\n");

  let peopleSummary: string | undefined;
  if (peopleStore) {
    const people = peopleStore.getAll();
    if (people.length > 0) {
      const pinnedByPerson = memoryStore.getPinnedByPerson();
      peopleSummary = people
        .map((p) => {
          const notify = p.primaryChannel ? `notify via: ${p.primaryChannel}` : "no notification channel";
          const parts = [`${p.name} [${p.id}]`, notify];
          const pinned = pinnedByPerson.get(p.id);
          if (pinned && pinned.length > 0) {
            const facts = pinned.map((m) => m.content).join("; ");
            parts.push(facts);
          }
          return parts.join(" | ");
        })
        .join("\n");
    }
  }

  let goalsSummary: string | undefined;
  if (goalStore) {
    const activeGoals = goalStore.list("active");
    if (activeGoals.length > 0) {
      goalsSummary = activeGoals
        .map((g) => {
          const attn = g.needsAttention ? ` [NEEDS ATTENTION: ${g.attentionReason ?? "flagged"}]` : "";
          return `${g.title} (${g.id})${attn}`;
        })
        .join("\n");
    }
  }

  return buildSystemPrompt({
    currentTime: new Date().toLocaleString(),
    deviceSummary,
    peopleSummary,
    goalsSummary,
    memoryScope,
    onboarding: opts?.onboarding,
  });
}

// ── Tool query (full MCP-enabled query used by ChatCoordinator + EphemeralRunner) ──

export interface ToolQueryOptions {
  eventBus: EventBus;
  config: HolmsConfig;
  mcpPool: McpServerPool;
  pluginManager?: PluginManager;
  promptText: string;
  /** Short user-facing prompt (shown in activity view). Falls back to promptText if omitted. */
  userPrompt?: string;
  trigger: TurnTrigger;
  proactiveType?: string;
  messageId: string;
  /** Pass null for ephemeral (fresh session), or a string to resume a stateful session */
  sessionId: string | null;
  channel?: string;
  channelDisplayName?: string;
  coordinatorType?: string;
}

export interface ToolQueryResult {
  result: string;
  reasoning?: string;
  sessionId: string | null;
  metrics: QueryMetrics;
}

export async function runToolQuery(opts: ToolQueryOptions): Promise<ToolQueryResult> {
  return runWithChannel(opts.channel, () => runToolQueryInner(opts));
}

function buildAnalyzeHistoryAgent(config: HolmsConfig): AgentDefinition {
  return {
    description:
      "Spawn a data analyst to explore historical device data. Use for trend analysis, anomaly detection, energy usage patterns, cross-domain correlation, and complex multi-step analysis. Pass a natural language question; the analyst autonomously queries the time-series database and returns findings. Do NOT use for simple lookups — use history_catalog and history_query directly for those.",
    prompt: `You are a data analyst for a home automation system called Holms.

You have access to a DuckDB time-series database that records all device state changes. Your job is to explore the data, answer questions, and find patterns.

## Workflow

1. Start with **history_catalog** to discover relevant entities and schema
2. Write targeted SQL with **history_query** (DuckDB syntax, 10k row limit, 30s timeout) — aggregate aggressively
3. If you need statistics, regression, or anomaly detection, use **history_compute** (JavaScript sandbox with \`stats\` from simple-statistics; assign result to \`result\`)
4. Iterate if needed — follow up with more queries based on what you find
5. Return clear, structured findings

## Visualization

When analysis benefits from a chart, include a Vega-Lite spec in a fenced code block:

\`\`\`vega-lite
{"$schema":"https://vega.github.io/schema/vega-lite/v5.json", "mark":"line", "data":{"values":[...]}, "encoding":{...}}
\`\`\`

Guidelines:
- Embed data inline via \`data.values\` (no external URLs)
- **Keep data small**: Aggregate to ≤200 data points. Use time_bucket or DATE_TRUNC in SQL first. Spec should stay under 50KB.
- Use appropriate marks: line (trends), bar (comparisons), point (scatter), area (cumulative)
- Include axis titles with units and a descriptive chart title
- Always accompany charts with text analysis

## Output Format
Structure your response with: **Analysis** (what you found), **Key Findings** (bullet points), **Data Summary** (relevant numbers).`,
    tools: ["mcp__history__*"],
    model: config.models.analyzeHistory as AgentDefinition["model"],
    maxTurns: 8,
  };
}

async function runToolQueryInner(opts: ToolQueryOptions): Promise<ToolQueryResult> {
  const turnId = crypto.randomUUID();

  opts.eventBus.emit("agent:turn_start", {
    turnId,
    trigger: opts.trigger,
    proactiveType: opts.proactiveType,
    model: opts.config.models.coordinator,
    channel: opts.channel,
    channelDisplayName: opts.channelDisplayName,
    coordinatorType: opts.coordinatorType,
    timestamp: Date.now(),
  });

  opts.eventBus.emit("agent:thinking", {
    prompt: opts.userPrompt ?? opts.promptText,
    turnId,
    timestamp: Date.now(),
  });

  let result = "";
  let streamedText = "";
  let deepReasonToolUseId: string | null = null;
  let deepReasonStartTime = 0;
  let analyzeHistoryToolUseId: string | null = null;
  let analyzeHistoryStartTime = 0;
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
      allowedTools: [...opts.mcpPool.allowedTools, ...pluginToolPatterns, "Task"],
      agents: {
        analyze_history: buildAnalyzeHistoryAgent(opts.config),
      },
      ...(plugins.length > 0 ? { plugins } : {}),
      permissionMode: "bypassPermissions",
      includePartialMessages: true,
      ...(opts.sessionId ? { resume: opts.sessionId } : {}),
      ...(opts.config.claudeConfigDir
        ? { env: { ...process.env, CLAUDE_CONFIG_DIR: opts.config.claudeConfigDir } }
        : {}),
      onStderr: (data: string) => { if (data.includes("ERROR") || data.includes("Error")) console.error("[SDK stderr]", data.trim()); },
    },
  });

  for await (const message of conversation) {
    const msg = message as Record<string, unknown>;

    if (msg.type === "system" && msg.subtype === "init") {
      newSessionId = (msg.session_id as string) ?? newSessionId;
    }

    if (msg.type === "stream_event") {
      const isParent = msg.parent_tool_use_id == null;
      const event = msg.event as Record<string, unknown> | undefined;

      if (event?.type === "content_block_delta") {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          if (isParent) streamedText += delta.text;
          // Forward both parent and sub-agent text to the chat — sub-agent
          // text provides live feedback while it runs; chat:stream_end
          // replaces the content with the coordinator's final response.
          opts.eventBus.emit("chat:token", {
            token: delta.text,
            messageId: opts.messageId,
            timestamp: Date.now(),
          });
        }
      }

      // Detect sub-agent tool calls from stream events (the SDK doesn't
      // yield full assistant messages for sub-agents, only stream events).
      if (!isParent && event?.type === "content_block_start") {
        const block = event.content_block as Record<string, unknown> | undefined;
        if (block?.type === "tool_use" && typeof block.name === "string") {
          opts.eventBus.emit("agent:tool_use", {
            tool: block.name,
            input: block.input ?? {},
            turnId,
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
              turnId,
              timestamp: Date.now(),
            });

            if (toolName === "deep_reason") {
              deepReasonToolUseId = b.id as string;
              deepReasonStartTime = Date.now();
              const input = b.input as { problem?: string } | undefined;
              opts.eventBus.emit("deep_reason:start", {
                problem: input?.problem ?? "",
                model: opts.config.models.deepReason,
                turnId,
                timestamp: Date.now(),
              });
              opts.eventBus.emit("chat:status", {
                messageId: opts.messageId,
                status: "Reasoning deeply...",
                timestamp: Date.now(),
              });
            }

            if (toolName === "Task") {
              const input = b.input as { subagent_type?: string; prompt?: string } | undefined;
              if (input?.subagent_type === "analyze_history") {
                analyzeHistoryToolUseId = b.id as string;
                analyzeHistoryStartTime = Date.now();
                opts.eventBus.emit("analyze_history:start", {
                  question: input.prompt ?? "",
                  model: opts.config.models.analyzeHistory,
                  turnId,
                  timestamp: Date.now(),
                });
                opts.eventBus.emit("chat:status", {
                  messageId: opts.messageId,
                  status: "Analyzing history...",
                  timestamp: Date.now(),
                });
              }
            }
          }
        }
      }
    }

    // Match sub-agent completion via the "result" message type (not "user").
    // "user" messages with parent_tool_use_id include intermediate sub-agent
    // turns (prompts, tool results) — matching those fires tracking prematurely.
    if (deepReasonToolUseId && msg.type === "result" && msg.parent_tool_use_id === deepReasonToolUseId) {
      const analysis = msg.subtype === "success" ? (msg.result as string ?? "") : "";
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
        turnId,
        timestamp: Date.now(),
      });
      deepReasonToolUseId = null;
    }

    if (analyzeHistoryToolUseId && msg.type === "result" && msg.parent_tool_use_id === analyzeHistoryToolUseId) {
      const analysis = msg.subtype === "success" ? (msg.result as string ?? "") : "";
      opts.eventBus.emit("analyze_history:result", {
        question: "",
        analysis,
        model: opts.config.models.analyzeHistory,
        durationMs: Date.now() - analyzeHistoryStartTime,
        turnId,
        timestamp: Date.now(),
      });
      analyzeHistoryToolUseId = null;
    }

    if (msg.type === "result") {
      if (msg.subtype === "success") {
        result = (msg.result as string) ?? "";
      } else {
        result = `Error: ${(msg.error as string) ?? "Unknown error"}`;
      }

      // Extract **Summary:** line if present
      let summary: string | undefined;
      const summaryMatch = result.match(/^\*\*Summary:\*\*\s*(.+)/m);
      if (summaryMatch) {
        summary = summaryMatch[1].trim();
      }

      const metrics = extractResultMetrics(msg);

      opts.eventBus.emit("agent:result", {
        result,
        summary,
        model: opts.config.models.coordinator,
        ...metrics,
        totalCostUsd: metrics.costUsd,
        turnId,
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
    model: opts.model,
    timestamp: startTime,
  });

  opts.eventBus.emit("agent:thinking", {
    prompt: opts.promptText,
    turnId,
    timestamp: Date.now(),
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
      onStderr: (data: string) => { if (data.includes("ERROR") || data.includes("Error")) console.error("[SDK stderr]", data.trim()); },
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
