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

  /** List all registered provider descriptors with status and config */
  providers: t.procedure.query(({ ctx }) => {
    return ctx.channelManager.getProviderInfos();
  }),

  /** Enable a provider with config */
  enableProvider: t.procedure
    .input(z.object({ id: z.string(), config: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.channelManager.enableProvider(input.id, input.config);
      return { success: true };
    }),

  /** Disable a provider */
  disableProvider: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.channelManager.disableProvider(input.id);
      return { success: true };
    }),

  /** Update provider config */
  updateConfig: t.procedure
    .input(z.object({ id: z.string(), config: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.channelManager.updateProviderConfig(input.id, input.config);
      return { success: true };
    }),

  /** List all routing rules */
  routes: t.procedure.query(({ ctx }) => {
    return ctx.channelStore.getRoutes();
  }),

  /** Add a routing rule */
  addRoute: t.procedure
    .input(z.object({ eventType: z.string(), channelId: z.string() }))
    .mutation(({ ctx, input }) => {
      return ctx.channelStore.addRoute(input.eventType, input.channelId);
    }),

  /** Remove a routing rule */
  removeRoute: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      ctx.channelStore.removeRoute(input.id);
      return { success: true };
    }),

  /** Toggle a routing rule */
  toggleRoute: t.procedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(({ ctx, input }) => {
      ctx.channelStore.toggleRoute(input.id, input.enabled);
      return { success: true };
    }),
});
