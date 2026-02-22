import { initTRPC } from "@trpc/server";
import { z } from "zod";
import type { TRPCContext } from "../context.js";

const t = initTRPC.context<TRPCContext>().create();

export const triageRouter = t.router({
  list: t.procedure.query(({ ctx }) => {
    return ctx.triageStore.getAll();
  }),

  toggle: t.procedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(({ ctx, input }) => {
      return ctx.triageStore.toggle(input.id, input.enabled);
    }),

  delete: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      return ctx.triageStore.remove(input.id);
    }),
});
