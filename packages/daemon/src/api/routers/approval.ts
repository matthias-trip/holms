import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import type { TRPCContext } from "../context.js";
import type { PendingApproval } from "@holms/shared";
import { executeApprovalDecision } from "../../coordinator/approval-processor.js";

const t = initTRPC.context<TRPCContext>().create();

export const approvalRouter = t.router({
  pending: t.procedure.query(({ ctx }) => {
    return ctx.approvalQueue.getPending();
  }),

  approve: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return executeApprovalDecision(ctx, input.id, true);
    }),

  reject: t.procedure
    .input(z.object({ id: z.string(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      return executeApprovalDecision(ctx, input.id, false, input.reason);
    }),

  history: t.procedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }).optional())
    .query(({ ctx, input }) => {
      const limit = input?.limit ?? 50;
      return ctx.activityStore.getApprovalHistory(limit);
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
