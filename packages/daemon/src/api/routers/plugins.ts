import { initTRPC } from "@trpc/server";
import { z } from "zod";
import type { TRPCContext } from "../context.js";

const t = initTRPC.context<TRPCContext>().create();

export const pluginsRouter = t.router({
  list: t.procedure.query(({ ctx }) => {
    return ctx.pluginManager.getAll();
  }),

  toggle: t.procedure
    .input(z.object({ name: z.string(), enabled: z.boolean() }))
    .mutation(({ ctx, input }) => {
      return ctx.pluginManager.setEnabled(input.name, input.enabled);
    }),

  install: t.procedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.pluginManager.install(input.name);
    }),

  refresh: t.procedure.mutation(({ ctx }) => {
    return ctx.pluginManager.refresh();
  }),
});
