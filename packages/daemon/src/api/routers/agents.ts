import { initTRPC } from "@trpc/server";
import { z } from "zod";
import type { TRPCContext } from "../context.js";
import type { AgentStatus } from "@holms/shared";

const t = initTRPC.context<TRPCContext>().create();

export const agentsRouter = t.router({
  status: t.procedure.query(({ ctx }): AgentStatus[] => {
    const specialists = ctx.specialistRegistry.getAll();

    const statuses: AgentStatus[] = [
      {
        agentId: "coordinator",
        name: "Coordinator",
        role: "coordinator",
        description: "Orchestrates all home automation decisions",
        processing: ctx.coordinator.isProcessing(),
      },
      ...specialists.map((s) => ({
        agentId: s.name,
        name: s.name.charAt(0).toUpperCase() + s.name.slice(1),
        role: "specialist" as const,
        description: s.description,
        processing: false,
      })),
    ];

    return statuses;
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

  triggerCycle: t.procedure
    .input(z.object({
      type: z.enum(["situational", "reflection", "goal_review", "daily_summary"]),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.coordinator.isProcessing()) {
        return { triggered: false, reason: "Coordinator is already processing" };
      }
      // Fire and forget — don't block the mutation on the full cycle
      ctx.scheduler.triggerWakeup(input.type).catch((err) => {
        console.error(`[API] Manual ${input.type} cycle error:`, err);
      });
      return { triggered: true };
    }),
});
