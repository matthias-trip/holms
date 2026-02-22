import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import type { TRPCContext } from "../context.js";
import type { AgentStatus } from "@holms/shared";

const t = initTRPC.context<TRPCContext>().create();

export const agentsRouter = t.router({
  status: t.procedure.query(({ ctx }): AgentStatus[] => {
    return [
      {
        agentId: "coordinator",
        name: "Coordinator",
        role: "coordinator",
        description: "Orchestrates all home automation decisions",
        processing: ctx.hub.isProcessing(),
      },
    ];
  }),

  turns: t.procedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }).optional())
    .query(({ ctx, input }) => {
      const limit = input?.limit ?? 50;
      return ctx.activityStore.getRecentTurns(limit);
    }),

  proactiveCycles: t.procedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }).optional())
    .query(({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      return ctx.activityStore.getProactiveTurns(limit);
    }),

  orphanActivities: t.procedure
    .input(z.object({ limit: z.number().min(1).max(500).default(100) }).optional())
    .query(({ ctx, input }) => {
      const limit = input?.limit ?? 100;
      return ctx.activityStore.getOrphanActivities(limit);
    }),

  triggerCycle: t.procedure
    .input(z.object({
      type: z.enum(["situational", "reflection", "goal_review", "daily_summary"]),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.hub.isProcessing()) {
        return { triggered: false, reason: "Coordinator is already processing" };
      }
      // Fire and forget — don't block the mutation on the full cycle
      ctx.scheduler.triggerWakeup(input.type).catch((err) => {
        console.error(`[API] Manual ${input.type} cycle error:`, err);
      });
      return { triggered: true };
    }),

  cycleFeedback: t.procedure
    .input(z.object({
      turnId: z.string(),
      sentiment: z.enum(["positive", "negative"]),
      comment: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Get turn activities to find the cycle result
      const activities = ctx.activityStore.getActivitiesByTurn(input.turnId);
      if (activities.length === 0) {
        throw new Error("Turn not found");
      }

      // Reject duplicate feedback
      if (activities.some((a) => a.type === "cycle_feedback")) {
        throw new Error("Feedback already submitted for this cycle");
      }

      // Find the cycle type and result
      const turnStart = activities.find((a) => a.type === "turn_start");
      const resultActivity = activities.find((a) => a.type === "result");
      const cycleType = String((turnStart?.data as Record<string, unknown>)?.proactiveType ?? "unknown");
      const cycleResult = String((resultActivity?.data as Record<string, unknown>)?.result ?? "");

      // Persist the feedback activity on the same turn
      const feedbackActivity = {
        id: uuid(),
        type: "cycle_feedback" as const,
        data: { sentiment: input.sentiment, comment: input.comment },
        timestamp: Date.now(),
        agentId: "user",
        turnId: input.turnId,
      };
      ctx.activityStore.addActivity(feedbackActivity);
      ctx.eventBus.emit("activity:stored", feedbackActivity);

      // Fire-and-forget: LLM processes the feedback, then persist the response
      ctx.hub.handleCycleFeedback({
        turnId: input.turnId,
        cycleType,
        cycleResult,
        sentiment: input.sentiment,
        comment: input.comment,
      }).then((response) => {
        const responseActivity = {
          id: uuid(),
          type: "cycle_feedback_response" as const,
          data: { response },
          timestamp: Date.now(),
          agentId: "coordinator",
          turnId: input.turnId,
        };
        ctx.activityStore.addActivity(responseActivity);
        ctx.eventBus.emit("activity:stored", responseActivity);
      }).catch((err) => {
        console.error("[API] Cycle feedback processing error:", err);
      });

      return { ok: true };
    }),
});
