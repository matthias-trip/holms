import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import type { TRPCContext } from "../context.js";
import type { AgentActivity } from "@holms/shared";
import { v4 as uuid } from "uuid";
import type { EventBus } from "../../event-bus.js";
import type { ActivityStore } from "../../activity/store.js";
import type { CoordinatorHub } from "../../coordinator/coordinator-hub.js";
import { runTrackedQuery } from "../../coordinator/query-runner.js";

const t = initTRPC.context<TRPCContext>().create();

let suggestionsCache: { key: number; suggestions: string[] } | null = null;

/**
 * Register a single set of event bus listeners that persist agent activities to the DB
 * and re-emit them as typed AgentActivity objects on a dedicated channel.
 * Call this once at server startup, not per-subscriber.
 */
export function initActivityPersistence(
  eventBus: EventBus,
  activityStore: ActivityStore,
  hub: CoordinatorHub,
): void {
  let lastTurnId: string | undefined;
  const getTurnId = () => hub.getCurrentTurnId() ?? lastTurnId;
  const approvalTurnMap = new Map<string, string>(); // approvalId → turnId

  const store = (activity: AgentActivity) => {
    activityStore.addActivity(activity);
    // Re-emit on a dedicated channel so subscribers can pick it up without duplicating storage
    eventBus.emit("activity:stored", activity);
  };

  eventBus.on("agent:turn_start", (data: { turnId: string; trigger: string; summary: string; model?: string; timestamp: number }) => {
    lastTurnId = data.turnId;
    store({
      id: uuid(), type: "turn_start",
      data: { trigger: data.trigger, summary: data.summary, model: data.model },
      timestamp: data.timestamp, agentId: data.trigger === "suggestions" ? "suggestions" : "coordinator", turnId: data.turnId,
    });
  });

  eventBus.on("agent:thinking", (data: { prompt: string; timestamp: number }) => {
    store({
      id: uuid(), type: "thinking",
      data: { prompt: data.prompt },
      timestamp: data.timestamp, agentId: "coordinator", turnId: getTurnId(),
    });
  });

  eventBus.on("agent:tool_use", (data: { tool: string; input: unknown; timestamp: number }) => {
    store({
      id: uuid(), type: "tool_use",
      data: { tool: data.tool, input: data.input },
      timestamp: data.timestamp, agentId: "coordinator", turnId: getTurnId(),
    });
  });

  eventBus.on("agent:result", (data: { result: string; model?: string; costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; durationMs: number; durationApiMs: number; numTurns: number; totalCostUsd: number; timestamp: number }) => {
    store({
      id: uuid(), type: "result",
      data: { result: data.result, model: data.model, costUsd: data.costUsd, inputTokens: data.inputTokens, outputTokens: data.outputTokens, cacheReadTokens: data.cacheReadTokens, cacheCreationTokens: data.cacheCreationTokens, durationMs: data.durationMs, durationApiMs: data.durationApiMs, numTurns: data.numTurns, totalCostUsd: data.totalCostUsd },
      timestamp: data.timestamp, agentId: "coordinator", turnId: getTurnId(),
    });
  });

  eventBus.on("agent:reflection", (data: { insight: string; timestamp: number }) => {
    store({
      id: uuid(), type: "reflection",
      data: { insight: data.insight },
      timestamp: data.timestamp, agentId: "coordinator", turnId: getTurnId(),
    });
  });

  eventBus.on("agent:outcome", (data: { action: string; feedback: string; timestamp: number }) => {
    store({
      id: uuid(), type: "outcome",
      data: { action: data.action, feedback: data.feedback },
      timestamp: data.timestamp, agentId: "coordinator", turnId: getTurnId(),
    });
  });

  eventBus.on("deep_reason:start", (data: { problem: string; model: string; timestamp: number }) => {
    store({
      id: uuid(), type: "deep_reason_start",
      data: { problem: data.problem, model: data.model },
      timestamp: data.timestamp, agentId: "deep_reason", turnId: getTurnId(),
    });
  });

  eventBus.on("deep_reason:result", (data: { problem: string; analysis: string; model: string; costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; durationMs: number; durationApiMs: number; numTurns: number; totalCostUsd: number; timestamp: number }) => {
    store({
      id: uuid(), type: "deep_reason_result",
      data: { problem: data.problem, analysis: data.analysis, model: data.model, costUsd: data.costUsd, inputTokens: data.inputTokens, outputTokens: data.outputTokens, cacheReadTokens: data.cacheReadTokens, cacheCreationTokens: data.cacheCreationTokens, durationMs: data.durationMs, durationApiMs: data.durationApiMs, numTurns: data.numTurns, totalCostUsd: data.totalCostUsd },
      timestamp: data.timestamp, agentId: "deep_reason", turnId: getTurnId(),
    });
  });

  eventBus.on("approval:pending", (data: { id: string; deviceId: string; command: string; reason: string; createdAt: number; status: string; params: Record<string, unknown> }) => {
    const turnId = getTurnId();
    if (turnId) approvalTurnMap.set(data.id, turnId);
    store({
      id: uuid(), type: "approval_pending",
      data: { approvalId: data.id, deviceId: data.deviceId, command: data.command, params: data.params, reason: data.reason },
      timestamp: data.createdAt, agentId: "coordinator", turnId,
    });
  });

  eventBus.on("approval:resolved", (data: { id: string; approved: boolean; reason?: string }) => {
    const turnId = approvalTurnMap.get(data.id);
    approvalTurnMap.delete(data.id);
    store({
      id: uuid(), type: "approval_resolved",
      data: { approvalId: data.id, approved: data.approved, reason: data.reason },
      timestamp: Date.now(), agentId: "coordinator", turnId,
    });
  });

  eventBus.on("agent:triage_batch", (data: { eventCount: number; timestamp: number }) => {
    store({
      id: uuid(), type: "triage",
      data: { eventCount: data.eventCount },
      timestamp: data.timestamp, agentId: "triage",
    });
  });

  eventBus.on("agent:triage_classify", (data: { deviceId: string; eventType: string; lane: string; ruleId: string | null; reason: string; deviceName?: string; room?: string; timestamp: number }) => {
    store({
      id: uuid(), type: "triage_classify",
      data: { deviceId: data.deviceId, eventType: data.eventType, lane: data.lane, ruleId: data.ruleId, reason: data.reason, deviceName: data.deviceName, room: data.room },
      timestamp: data.timestamp, agentId: "triage",
    });
  });

  eventBus.on("reflex:triggered", (data: { rule: { id: string; reason: string }; event: { deviceId: string; type: string }; action: { deviceId: string; command: string } }) => {
    store({
      id: uuid(), type: "reflex_fired",
      data: { ruleId: data.rule.id, reason: data.rule.reason, triggerDevice: data.event.deviceId, triggerEvent: data.event.type, actionDevice: data.action.deviceId, actionCommand: data.action.command },
      timestamp: Date.now(), agentId: "reflex_engine",
    });
  });
}

export const chatRouter = t.router({
  history: t.procedure
    .input(
      z.object({
        limit: z.number().optional(),
        before: z.number().optional(),
        channel: z.string().optional(),
      }),
    )
    .query(({ ctx, input }) => {
      return ctx.chatStore.getHistory(input.limit, input.before, input.channel);
    }),

  send: t.procedure
    .input(z.object({ message: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userMsg = {
        id: uuid(),
        role: "user" as const,
        content: input.message,
        timestamp: Date.now(),
        channel: "web:default",
      };
      ctx.chatStore.add(userMsg);

      // Insert a thinking placeholder so it persists across remounts
      const thinkingMsg = {
        id: uuid(),
        role: "assistant" as const,
        content: "",
        timestamp: Date.now(),
        status: "thinking" as const,
        channel: "web:default",
      };
      ctx.chatStore.add(thinkingMsg);

      // Track the response for channel routing
      ctx.channelManager.trackResponse(thinkingMsg.id, "web", "web:default");

      const result = await ctx.hub.handleUserRequest(input.message, thinkingMsg.id, "web:default");

      // Update the thinking row in-place with the actual response
      const now = Date.now();
      ctx.chatStore.updateMessage(thinkingMsg.id, {
        content: result,
        status: null,
        timestamp: now,
      });

      const assistantMsg = {
        id: thinkingMsg.id,
        role: "assistant" as const,
        content: result,
        timestamp: now,
      };

      return { userMsg, assistantMsg };
    }),

  activityHistory: t.procedure
    .input(z.object({ limit: z.number().min(1).max(500).default(100) }).optional())
    .query(({ ctx, input }) => {
      const limit = input?.limit ?? 100;
      return ctx.activityStore.getActivities(limit);
    }),

  onChatStream: t.procedure.subscription(({ ctx }) => {
    return observable<
      | { type: "token"; token: string; messageId: string }
      | { type: "end"; messageId: string; content: string; reasoning?: string }
    >((emit) => {
      const tokenHandler = (data: { token: string; messageId: string; timestamp: number }) => {
        emit.next({ type: "token", token: data.token, messageId: data.messageId });
      };
      const endHandler = (data: { messageId: string; content: string; reasoning?: string; timestamp: number }) => {
        emit.next({ type: "end", messageId: data.messageId, content: data.content, reasoning: data.reasoning });
      };
      ctx.eventBus.on("chat:token", tokenHandler);
      ctx.eventBus.on("chat:stream_end", endHandler);
      return () => {
        ctx.eventBus.off("chat:token", tokenHandler);
        ctx.eventBus.off("chat:stream_end", endHandler);
      };
    });
  }),

  suggestions: t.procedure
    .input(z.object({ limit: z.number().min(1).max(20).default(6) }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 6;
      try {
        const history = ctx.chatStore.getHistory(20);
        const relevant = history.filter(
          (m) => (m.role === "user" || m.role === "assistant") && m.status !== "thinking" && m.status !== "approval_pending" && m.status !== "approval_resolved" && m.content,
        );
        if (relevant.length === 0) return { suggestions: [] };

        const cacheKey = relevant.at(-1)!.timestamp;
        if (suggestionsCache?.key === cacheKey) {
          return { suggestions: suggestionsCache.suggestions };
        }

        const transcript = relevant
          .slice(-10)
          .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 300)}`)
          .join("\n");

        const { result: resultText } = await runTrackedQuery({
          eventBus: ctx.eventBus,
          model: ctx.config.models.suggestions,
          trigger: "suggestions",
          summary: `Suggestions from: ${transcript.slice(0, 80)}`,
          promptText: transcript,
          systemPrompt: `You generate chat message suggestions for a home automation assistant. Given the conversation, return a JSON array of exactly ${limit} short messages the user might send next (max 6 words each). These should read naturally as things a person would type — casual commands, requests, or questions. Examples: "dim the living room lights", "what's the bedroom temperature?", "turn everything off". Return ONLY the JSON array, no other text.`,
          maxTurns: 1,
          claudeConfigDir: ctx.config.claudeConfigDir,
        });

        const match = resultText.match(/\[[\s\S]*\]/);
        if (!match) return { suggestions: [] };
        const parsed = JSON.parse(match[0]);
        if (!Array.isArray(parsed)) return { suggestions: [] };
        const suggestions = parsed.filter((s: unknown) => typeof s === "string").slice(0, limit);
        suggestionsCache = { key: cacheKey, suggestions };
        return { suggestions };
      } catch (err) {
        console.error("[Suggestions] Failed to generate:", err);
        return { suggestions: [] };
      }
    }),

  // Subscription only forwards already-stored activities — no DB writes here
  onActivity: t.procedure.subscription(({ ctx }) => {
    return observable<AgentActivity>((emit) => {
      const handler = (activity: AgentActivity) => {
        emit.next(activity);
      };
      ctx.eventBus.on("activity:stored", handler);
      return () => ctx.eventBus.off("activity:stored", handler);
    });
  }),
});
