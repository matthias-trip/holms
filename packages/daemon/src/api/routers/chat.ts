import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import type { TRPCContext } from "../context.js";
import type { AgentActivity } from "@holms/shared";
import { v4 as uuid } from "uuid";
import type { EventBus } from "../../event-bus.js";
import type { ActivityStore } from "../../activity/store.js";
import { runTrackedQuery } from "../../coordinator/query-runner.js";
import type { InboundMessage } from "../../channels/types.js";

const t = initTRPC.context<TRPCContext>().create();

let suggestionsCache: { key: string; suggestions: string[] } | null = null;

/**
 * Register a single set of event bus listeners that persist agent activities to the DB
 * and re-emit them as typed AgentActivity objects on a dedicated channel.
 * Call this once at server startup, not per-subscriber.
 */
export function initActivityPersistence(
  eventBus: EventBus,
  activityStore: ActivityStore,
): void {
  const approvalTurnMap = new Map<string, string>(); // approvalId → turnId

  const store = (activity: AgentActivity) => {
    activityStore.addActivity(activity);
    // Re-emit on a dedicated channel so subscribers can pick it up without duplicating storage
    eventBus.emit("activity:stored", activity);
  };

  eventBus.on("agent:turn_start", (data: { turnId: string; trigger: string; proactiveType?: string; model?: string; channel?: string; channelDisplayName?: string; coordinatorType?: string; automationId?: string; automationSummary?: string; timestamp: number }) => {
    store({
      id: uuid(), type: "turn_start",
      data: { trigger: data.trigger, proactiveType: data.proactiveType, model: data.model, channel: data.channel, channelDisplayName: data.channelDisplayName, automationId: data.automationId, automationSummary: data.automationSummary },
      timestamp: data.timestamp, agentId: data.trigger === "suggestions" ? "suggestions" : "coordinator", turnId: data.turnId,
    });
  });

  eventBus.on("agent:thinking", (data: { prompt: string; turnId?: string; timestamp: number }) => {
    store({
      id: uuid(), type: "thinking",
      data: { prompt: data.prompt },
      timestamp: data.timestamp, agentId: "coordinator", turnId: data.turnId,
    });
  });

  eventBus.on("agent:tool_use", (data: { tool: string; input: unknown; turnId?: string; timestamp: number }) => {
    store({
      id: uuid(), type: "tool_use",
      data: { tool: data.tool, input: data.input },
      timestamp: data.timestamp, agentId: "coordinator", turnId: data.turnId,
    });
  });

  eventBus.on("agent:result", (data: { result: string; summary?: string; model?: string; costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; durationMs: number; durationApiMs: number; numTurns: number; totalCostUsd: number; turnId?: string; timestamp: number }) => {
    store({
      id: uuid(), type: "result",
      data: { result: data.result, summary: data.summary, model: data.model, costUsd: data.costUsd, inputTokens: data.inputTokens, outputTokens: data.outputTokens, cacheReadTokens: data.cacheReadTokens, cacheCreationTokens: data.cacheCreationTokens, durationMs: data.durationMs, durationApiMs: data.durationApiMs, numTurns: data.numTurns, totalCostUsd: data.totalCostUsd },
      timestamp: data.timestamp, agentId: "coordinator", turnId: data.turnId,
    });
  });

  eventBus.on("agent:reflection", (data: { insight: string; turnId?: string; timestamp: number }) => {
    store({
      id: uuid(), type: "reflection",
      data: { insight: data.insight },
      timestamp: data.timestamp, agentId: "coordinator", turnId: data.turnId,
    });
  });

  eventBus.on("agent:outcome", (data: { action: string; feedback: string; turnId?: string; timestamp: number }) => {
    store({
      id: uuid(), type: "outcome",
      data: { action: data.action, feedback: data.feedback },
      timestamp: data.timestamp, agentId: "coordinator", turnId: data.turnId,
    });
  });

  eventBus.on("deep_reason:start", (data: { problem: string; model: string; turnId?: string; timestamp: number }) => {
    store({
      id: uuid(), type: "deep_reason_start",
      data: { problem: data.problem, model: data.model },
      timestamp: data.timestamp, agentId: "deep_reason", turnId: data.turnId,
    });
  });

  eventBus.on("deep_reason:result", (data: { problem: string; analysis: string; model: string; costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; durationMs: number; durationApiMs: number; numTurns: number; totalCostUsd: number; turnId?: string; timestamp: number }) => {
    store({
      id: uuid(), type: "deep_reason_result",
      data: { problem: data.problem, analysis: data.analysis, model: data.model, costUsd: data.costUsd, inputTokens: data.inputTokens, outputTokens: data.outputTokens, cacheReadTokens: data.cacheReadTokens, cacheCreationTokens: data.cacheCreationTokens, durationMs: data.durationMs, durationApiMs: data.durationApiMs, numTurns: data.numTurns, totalCostUsd: data.totalCostUsd },
      timestamp: data.timestamp, agentId: "deep_reason", turnId: data.turnId,
    });
  });

  eventBus.on("approval:pending", (data: { id: string; deviceId: string; command: string; reason: string; createdAt: number; status: string; params: Record<string, unknown>; turnId?: string }) => {
    const turnId = data.turnId;
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

  eventBus.on("agent:triage_batch", (data: { eventCount: number; devices: Array<{ deviceId: string; deviceName?: string; eventCount: number; latestValue?: number; unit?: string; avgDelta?: number; maxDelta?: number }>; timestamp: number }) => {
    store({
      id: uuid(), type: "triage",
      data: { eventCount: data.eventCount, devices: data.devices },
      timestamp: data.timestamp, agentId: "triage",
    });
  });

  eventBus.on("agent:triage_classify", (data: { deviceId: string; eventType: string; lane: string; ruleId: string | null; reason: string; deviceName?: string; area?: string; delta?: number; timestamp: number }) => {
    store({
      id: uuid(), type: "triage_classify",
      data: { deviceId: data.deviceId, eventType: data.eventType, lane: data.lane, ruleId: data.ruleId, reason: data.reason, deviceName: data.deviceName, area: data.area, delta: data.delta },
      timestamp: data.timestamp, agentId: "triage",
    });
  });

  eventBus.on("history:flush", (data: { rowCount: number; entityCount: number; bufferSize: number; timestamp: number }) => {
    store({
      id: uuid(), type: "history_flush",
      data: { rowCount: data.rowCount, entityCount: data.entityCount, bufferSize: data.bufferSize },
      timestamp: data.timestamp, agentId: "history",
    });
  });

  eventBus.on("history:entity_discovered", (data: { entityId: string; friendlyName: string; domain: string; area: string; valueType: string; timestamp: number }) => {
    store({
      id: uuid(), type: "history_entity_discovered",
      data: { entityId: data.entityId, friendlyName: data.friendlyName, domain: data.domain, area: data.area, valueType: data.valueType },
      timestamp: data.timestamp, agentId: "history",
    });
  });

  eventBus.on("history:import_progress", (data: { deviceId: string; phase: string; processed: number; total: number; message?: string }) => {
    if (data.phase === "done" || data.phase === "error") {
      store({
        id: uuid(), type: "history_import",
        data: { deviceId: data.deviceId, phase: data.phase, rowCount: data.processed, message: data.message },
        timestamp: Date.now(), agentId: "history",
      });
    }
  });

  eventBus.on("analyze_history:start", (data: { question: string; model: string; turnId?: string; timestamp: number }) => {
    store({
      id: uuid(), type: "analyze_history_start",
      data: { question: data.question, model: data.model },
      timestamp: data.timestamp, agentId: "analyze_history", turnId: data.turnId,
    });
  });

  eventBus.on("analyze_history:result", (data: { question: string; analysis: string; model: string; durationMs: number; turnId?: string; timestamp: number }) => {
    store({
      id: uuid(), type: "analyze_history_result",
      data: { question: data.question, analysis: data.analysis, model: data.model, durationMs: data.durationMs },
      timestamp: data.timestamp, agentId: "analyze_history", turnId: data.turnId,
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
      const now = Date.now();
      const msg: InboundMessage = {
        id: uuid(),
        conversationId: "web:default",
        senderId: "web-user",
        content: input.message,
        timestamp: now,
      };

      const { userMsgId, thinkingMsgId } = await ctx.channelManager.sendMessage(msg);

      return {
        userMsg: { id: userMsgId, role: "user" as const, content: input.message, timestamp: now },
        assistantMsg: { id: thinkingMsgId, role: "assistant" as const, content: "", timestamp: Date.now() },
      };
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
      | { type: "status"; messageId: string; status: string }
    >((emit) => {
      const tokenHandler = (data: { token: string; messageId: string; timestamp: number }) => {
        emit.next({ type: "token", token: data.token, messageId: data.messageId });
      };
      const endHandler = (data: { messageId: string; content: string; reasoning?: string; timestamp: number }) => {
        emit.next({ type: "end", messageId: data.messageId, content: data.content, reasoning: data.reasoning });
      };
      const statusHandler = (data: { messageId: string; status: string; timestamp: number }) => {
        emit.next({ type: "status", messageId: data.messageId, status: data.status });
      };
      ctx.eventBus.on("chat:token", tokenHandler);
      ctx.eventBus.on("chat:stream_end", endHandler);
      ctx.eventBus.on("chat:status", statusHandler);
      return () => {
        ctx.eventBus.off("chat:token", tokenHandler);
        ctx.eventBus.off("chat:stream_end", endHandler);
        ctx.eventBus.off("chat:status", statusHandler);
      };
    });
  }),

  suggestions: t.procedure
    .input(z.object({ limit: z.number().min(1).max(20).default(6), channel: z.string().default("web:default") }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 6;
      const channel = input?.channel ?? "web:default";
      try {
        const history = ctx.chatStore.getHistory(20, undefined, channel);
        const relevant = history.filter(
          (m) => (m.role === "user" || m.role === "assistant") && m.status !== "thinking" && m.status !== "approval_pending" && m.status !== "approval_resolved" && m.content,
        );
        if (relevant.length === 0) return { suggestions: [] };

        const cacheKey = `${channel}:${relevant.at(-1)!.timestamp}`;
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
          promptText: `<conversation_transcript>\n${transcript}\n</conversation_transcript>\n\nBased on the transcript above, generate a JSON array of exactly ${limit} short follow-up messages the user might send next. Return ONLY the JSON array.`,
          systemPrompt: `You generate chat message suggestions for a home automation assistant. You will be given a conversation transcript wrapped in <conversation_transcript> tags. Based on that conversation, return a JSON array of short messages (max 6 words each) the user might send next. These should read naturally as things a person would type — casual commands, requests, or questions about their home. Examples: "dim the living room lights", "what's the bedroom temperature?", "turn everything off". Return ONLY the JSON array, no other text. Do NOT respond to the conversation — only generate suggestions.`,
          maxTurns: 1,
          claudeConfigDir: ctx.config.claudeConfigDir,
          claudeExecutablePath: ctx.config.claudeExecutablePath,
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

  messageFeedback: t.procedure
    .input(z.object({
      messageId: z.string(),
      sentiment: z.enum(["positive", "negative"]),
      comment: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const msg = ctx.chatStore.getById(input.messageId);
      if (!msg) throw new Error("Message not found");
      if (msg.role !== "assistant") throw new Error("Can only rate assistant messages");
      if (msg.feedback) throw new Error("Feedback already submitted for this message");

      // Persist feedback immediately
      ctx.chatStore.setFeedback(input.messageId, input.sentiment, input.comment);

      // Emit so UI updates the thumbs state
      ctx.eventBus.emit("chat:message_feedback", {
        messageId: input.messageId,
        sentiment: input.sentiment,
        comment: input.comment,
        timestamp: Date.now(),
      });

      // Find preceding user message for context
      const history = ctx.chatStore.getHistory(50, undefined, msg.channel);
      const msgIdx = history.findIndex((m) => m.id === input.messageId);
      let userMessage = "";
      if (msgIdx > 0) {
        for (let i = msgIdx - 1; i >= 0; i--) {
          if (history[i]!.role === "user") {
            userMessage = history[i]!.content;
            break;
          }
        }
      }

      // Fire-and-forget: agent reflects on the feedback
      ctx.hub.handleMessageFeedback({
        messageId: input.messageId,
        userMessage,
        assistantMessage: msg.content,
        sentiment: input.sentiment,
        comment: input.comment,
      }).then((response) => {
        ctx.chatStore.setFeedbackResponse(input.messageId, response);
        ctx.eventBus.emit("chat:message_feedback_response", {
          messageId: input.messageId,
          response,
          timestamp: Date.now(),
        });
      }).catch((err) => {
        console.error("[API] Message feedback processing error:", err);
      });

      return { ok: true };
    }),

  onMessageFeedbackResponse: t.procedure.subscription(({ ctx }) => {
    return observable<{ messageId: string; response: string }>((emit) => {
      const handler = (data: { messageId: string; response: string; timestamp: number }) => {
        emit.next({ messageId: data.messageId, response: data.response });
      };
      ctx.eventBus.on("chat:message_feedback_response", handler);
      return () => ctx.eventBus.off("chat:message_feedback_response", handler);
    });
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
