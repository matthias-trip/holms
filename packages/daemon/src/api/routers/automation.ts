import { initTRPC } from "@trpc/server";
import type { TRPCContext } from "../context.js";

const t = initTRPC.context<TRPCContext>().create();

export const automationRouter = t.router({
  list: t.procedure.query(({ ctx }) => {
    return ctx.automationStore.getAll();
  }),
});
