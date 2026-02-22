import { initTRPC } from "@trpc/server";
import { z } from "zod";
import type { TRPCContext } from "../context.js";

const t = initTRPC.context<TRPCContext>().create();

export const goalsRouter = t.router({
  list: t.procedure
    .input(
      z
        .object({
          status: z.enum(["active", "paused", "completed", "abandoned"]).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      return ctx.goalStore.list(input?.status);
    }),

  get: t.procedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => {
      const goal = ctx.goalStore.get(input.id);
      if (!goal) return null;
      const events = ctx.goalStore.getEvents(input.id, 50);
      return { ...goal, events };
    }),

  addNote: t.procedure
    .input(z.object({ id: z.string(), content: z.string() }))
    .mutation(({ ctx, input }) => {
      return ctx.goalStore.addEvent(input.id, "user_note", input.content);
    }),

  updateStatus: t.procedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(["active", "paused", "completed", "abandoned"]),
      }),
    )
    .mutation(({ ctx, input }) => {
      return ctx.goalStore.update(input.id, { status: input.status });
    }),

  dismissAttention: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      return ctx.goalStore.update(input.id, { needsAttention: false, attentionReason: undefined });
    }),

  delete: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      return ctx.goalStore.delete(input.id);
    }),
});
