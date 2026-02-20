import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import type { TRPCContext } from "../context.js";
import type { PendingApproval } from "@holms/shared";

const t = initTRPC.context<TRPCContext>().create();

/**
 * Run the coordinator on approval result and stream its response into the
 * thinking placeholder message. On completion (or error) finalises the DB row
 * and emits `chat:stream_end` so the frontend clears the streaming state.
 */
async function processApprovalResult(
  ctx: TRPCContext,
  approvalId: string,
  approved: boolean,
  action: { deviceId: string; command: string; params: Record<string, unknown>; reason: string },
  thinkingMessageId: string,
  userReason?: string,
): Promise<void> {
  try {
    const channel = ctx.hub.getApprovalChannel(approvalId);
    const result = await ctx.hub.handleApprovalResult(
      approvalId, approved, action, userReason, thinkingMessageId, channel,
    );
    // Finalise the thinking row: clear status, set final content
    ctx.chatStore.updateMessage(thinkingMessageId, {
      content: result,
      status: null,
    });
  } catch (err) {
    console.error("[approval] coordinator error:", err);
    const fallback = "Sorry, I encountered an error processing this approval.";
    ctx.chatStore.updateMessage(thinkingMessageId, {
      content: fallback,
      status: null,
    });
    ctx.eventBus.emit("chat:stream_end", {
      messageId: thinkingMessageId,
      content: fallback,
      timestamp: Date.now(),
    });
  }
}

export const approvalRouter = t.router({
  pending: t.procedure.query(({ ctx }) => {
    return ctx.approvalQueue.getPending();
  }),

  approve: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const entry = await ctx.approvalQueue.approve(input.id);
      if (!entry) return { success: false, thinkingMessageId: null };

      // (a) Update the approval card in chat
      const cardMsg = ctx.chatStore.findByApprovalId(input.id);
      if (cardMsg) {
        try {
          const parsed = JSON.parse(cardMsg.content);
          parsed.resolved = { approved: true };
          ctx.chatStore.updateMessage(cardMsg.id, {
            content: JSON.stringify(parsed),
            status: "approval_resolved",
          });
        } catch { /* content wasn't valid JSON */ }
      }

      // (b) Insert thinking placeholder
      const approveChannel = ctx.hub.getApprovalChannel(input.id);
      const [approvePid, approveConv] = approveChannel.split(":");
      const thinkingId = uuid();
      ctx.chatStore.add({
        id: thinkingId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        status: "thinking",
        channel: approveChannel,
      });

      // Track the response for channel routing
      ctx.channelManager.trackResponse(thinkingId, approvePid ?? "web", approveConv ? approveChannel : "web:default");

      // (c) Background: run coordinator, streaming into the thinking message
      processApprovalResult(ctx, input.id, true, {
        deviceId: entry.deviceId,
        command: entry.command,
        params: entry.params,
        reason: entry.reason,
      }, thinkingId).catch(console.error);

      return { success: true, thinkingMessageId: thinkingId };
    }),

  reject: t.procedure
    .input(z.object({ id: z.string(), reason: z.string().optional() }))
    .mutation(({ ctx, input }) => {
      const entry = ctx.approvalQueue.reject(input.id, input.reason);
      if (!entry) return { success: false, thinkingMessageId: null };

      // (a) Update the approval card in chat
      const cardMsg = ctx.chatStore.findByApprovalId(input.id);
      if (cardMsg) {
        try {
          const parsed = JSON.parse(cardMsg.content);
          parsed.resolved = { approved: false };
          ctx.chatStore.updateMessage(cardMsg.id, {
            content: JSON.stringify(parsed),
            status: "approval_resolved",
          });
        } catch { /* content wasn't valid JSON */ }
      }

      // (b) Insert thinking placeholder
      const rejectChannel = ctx.hub.getApprovalChannel(input.id);
      const [rejectPid, rejectConv] = rejectChannel.split(":");
      const thinkingId = uuid();
      ctx.chatStore.add({
        id: thinkingId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        status: "thinking",
        channel: rejectChannel,
      });

      // Track the response for channel routing
      ctx.channelManager.trackResponse(thinkingId, rejectPid ?? "web", rejectConv ? rejectChannel : "web:default");

      // (c) Background: run coordinator, streaming into the thinking message
      processApprovalResult(ctx, input.id, false, {
        deviceId: entry.deviceId,
        command: entry.command,
        params: entry.params,
        reason: entry.reason,
      }, thinkingId, input.reason).catch(console.error);

      return { success: true, thinkingMessageId: thinkingId };
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
