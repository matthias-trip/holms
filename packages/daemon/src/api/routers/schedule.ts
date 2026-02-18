import { initTRPC } from "@trpc/server";
import type { TRPCContext } from "../context.js";

const t = initTRPC.context<TRPCContext>().create();

export const scheduleRouter = t.router({
  list: t.procedure.query(({ ctx }) => {
    return ctx.scheduleStore.getAll();
  }),
});
