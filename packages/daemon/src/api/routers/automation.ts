import { initTRPC } from "@trpc/server";
import { z } from "zod";
import type { TRPCContext } from "../context.js";

const t = initTRPC.context<TRPCContext>().create();

export const automationRouter = t.router({
  list: t.procedure.query(({ ctx }) => {
    return ctx.automationStore.getAll();
  }),

  runHistory: t.procedure
    .input(
      z.object({
        automationId: z.string().optional(),
        limit: z.number().min(1).max(200).optional(),
      }).optional(),
    )
    .query(({ ctx, input }) => {
      const turns = ctx.activityStore.getAutomationRuns(
        input?.automationId,
        input?.limit ?? 50,
      );

      return turns.map((turn) => {
        const startActivity = turn.activities.find((a) => a.type === "turn_start");
        const resultActivity = turn.activities.find((a) => a.type === "result");
        const toolUses = turn.activities.filter((a) => a.type === "tool_use");
        const startData = (startActivity?.data ?? {}) as Record<string, unknown>;
        const resultData = (resultActivity?.data ?? {}) as Record<string, unknown>;

        return {
          turnId: turn.turnId,
          automationId: (startData.automationId as string) ?? null,
          automationSummary: (startData.automationSummary as string) ?? null,
          timestamp: startActivity?.timestamp ?? turn.activities[0]?.timestamp ?? 0,
          summary: (resultData.summary as string) ?? null,
          result: (resultData.result as string) ?? null,
          costUsd: (resultData.costUsd as number) ?? 0,
          durationMs: (resultData.durationMs as number) ?? 0,
          toolUseCount: toolUses.length,
          status: resultActivity ? "completed" as const : "running" as const,
        };
      });
    }),
});
