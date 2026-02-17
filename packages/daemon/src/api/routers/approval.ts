import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import type { TRPCContext } from "../context.js";
import type { PendingApproval } from "@holms/shared";

const t = initTRPC.context<TRPCContext>().create();

export const approvalRouter = t.router({
  pending: t.procedure.query(({ ctx }) => {
    return ctx.approvalQueue.getPending();
  }),

  approve: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.approvalQueue.approve(input.id);
      // Feed result back to coordinator
      ctx.coordinator.handleApprovalResult(input.id, true).catch(console.error);
      return { success: true };
    }),

  reject: t.procedure
    .input(z.object({ id: z.string(), reason: z.string().optional() }))
    .mutation(({ ctx, input }) => {
      ctx.approvalQueue.reject(input.id, input.reason);
      // Feed result back to coordinator
      ctx.coordinator
        .handleApprovalResult(input.id, false, input.reason)
        .catch(console.error);
      return { success: true };
    }),

  onProposal: t.procedure.subscription(({ ctx }) => {
    return observable<PendingApproval>((emit) => {
      const handler = (data: PendingApproval) => {
        emit.next(data);
      };
      ctx.eventBus.on("approval:pending", handler);
      return () => ctx.eventBus.off("approval:pending", handler);
    });
  }),
});
