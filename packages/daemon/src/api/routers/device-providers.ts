import { initTRPC } from "@trpc/server";
import { z } from "zod";
import type { TRPCContext } from "../context.js";
import type { HomeAssistantProvider } from "../../devices/providers/home-assistant.js";

const t = initTRPC.context<TRPCContext>().create();

export const deviceProvidersRouter = t.router({
  /** List all registered device provider descriptors with status */
  list: t.procedure.query(async ({ ctx }) => {
    return ctx.deviceManager.getProviderInfosAsync();
  }),

  /** Enable a provider with config */
  enable: t.procedure
    .input(z.object({ id: z.string(), config: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.deviceManager.enableProvider(input.id, input.config);
      return { success: true };
    }),

  /** Disable a provider */
  disable: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.deviceManager.disableProvider(input.id);
      return { success: true };
    }),

  /** Update provider config (validate + restart) */
  updateConfig: t.procedure
    .input(z.object({ id: z.string(), config: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.deviceManager.updateProviderConfig(input.id, input.config);
      return { success: true };
    }),

  // ── HA-specific entity picker ──

  /** All HA entities (unfiltered) for the entity picker */
  haAllEntities: t.procedure.query(({ ctx }) => {
    const provider = ctx.deviceManager.getProviderByName("home_assistant") as HomeAssistantProvider | undefined;
    if (!provider) return [];
    return provider.getAllEntities();
  }),

  /** Currently selected HA entity IDs */
  haSelectedEntities: t.procedure.query(({ ctx }) => {
    const provider = ctx.deviceManager.getProviderByName("home_assistant") as HomeAssistantProvider | undefined;
    if (!provider) return [];
    return Array.from(provider.getEntityFilter().getAllowed());
  }),

  /** Onboarding status — used by frontend to show appropriate banners */
  onboardingStatus: t.procedure.query(async ({ ctx }) => {
    const infos = await ctx.deviceManager.getProviderInfosAsync();
    const haInfo = infos.find((p) => p.id === "home_assistant");
    const haConnected = haInfo?.status === "connected";
    const haEnabled = haInfo?.enabled ?? false;
    const entityCount = ctx.deviceManager.getEntityFilterCount("home_assistant");

    let needsOnboarding = false;
    if (haConnected && entityCount === 0) {
      const { memories } = await ctx.memoryStore.query({ tags: ["system:onboarding_complete"] });
      needsOnboarding = memories.length === 0;
    }

    return {
      hasProvider: haEnabled,
      providerConnected: haConnected,
      entityCount,
      needsOnboarding,
    };
  }),

  /** Update HA entity selection */
  haSetSelectedEntities: t.procedure
    .input(z.object({ entityIds: z.array(z.string()) }))
    .mutation(({ ctx, input }) => {
      const provider = ctx.deviceManager.getProviderByName("home_assistant") as HomeAssistantProvider | undefined;
      if (!provider) throw new Error("Home Assistant provider not connected");
      provider.getEntityFilter().setAllowed(input.entityIds);
      return { count: input.entityIds.length };
    }),
});
