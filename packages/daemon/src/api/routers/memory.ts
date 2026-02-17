import { initTRPC } from "@trpc/server";
import { z } from "zod";
import type { TRPCContext } from "../context.js";

const t = initTRPC.context<TRPCContext>().create();

export const memoryRouter = t.router({
  list: t.procedure
    .input(
      z
        .object({
          type: z
            .enum([
              "observation",
              "preference",
              "pattern",
              "goal",
              "reflection",
              "plan",
            ])
            .optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      if (input?.type) {
        return ctx.memoryStore.getByType(input.type);
      }
      return ctx.memoryStore.getAll();
    }),

  search: t.procedure
    .input(z.object({ query: z.string() }))
    .query(({ ctx, input }) => {
      return ctx.memoryStore.recall(input.query);
    }),

  delete: t.procedure
    .input(z.object({ key: z.string() }))
    .mutation(({ ctx, input }) => {
      return ctx.memoryStore.forget(input.key);
    }),
});
