import { initTRPC } from "@trpc/server";
import { z } from "zod";
import type { TRPCContext } from "../context.js";

const t = initTRPC.context<TRPCContext>().create();

export const channelsRouter = t.router({
  /** List all conversations across all providers */
  conversations: t.procedure.query(({ ctx }) => {
    return ctx.channelManager.getConversations();
  }),

  /** Update a conversation's topic */
  updateTopic: t.procedure
    .input(z.object({ conversationId: z.string(), topic: z.string() }))
    .mutation(({ ctx, input }) => {
      ctx.channelManager.updateConversationTopic(input.conversationId, input.topic);
      return { success: true };
    }),
});
