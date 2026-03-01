import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import type { TRPCContext } from "../context.js";
import type { PluginInfo } from "@holms/shared";

const t = initTRPC.context<TRPCContext>().create();

export const pluginsRouter = t.router({
  /** List all plugins, enriched with adapter instances for plugins that have the adapter capability. */
  list: t.procedure.query(({ ctx }) => {
    const plugins = ctx.pluginManager.getAll();
    const adapterConfigs = ctx.habitat.configStore.listAdapters();
    const healthList = ctx.habitat.supervisor.getHealth();
    const allSources = ctx.habitat.configStore.listSources();

    return plugins.map((plugin): PluginInfo => {
      if (!plugin.capabilities.includes("adapter")) return plugin;

      // Find adapter instances that match this plugin's adapter type
      const adapterModules = ctx.pluginManager.getAdapterModules();
      const adapterModule = adapterModules.find((m) => m.modulePath.startsWith(plugin.path));
      if (!adapterModule) return plugin;

      const instances = adapterConfigs
        .filter((cfg) => cfg.type === adapterModule.type)
        .map((cfg) => {
          const health = healthList.find((h) => h.id === cfg.id);
          const configuredEntityCount = allSources.filter(s => s.adapterId === cfg.id).length;
          return { ...cfg, health: health ?? null, configuredEntityCount };
        });

      return { ...plugin, adapterInstances: instances, multiInstance: adapterModule.multiInstance };
    });
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

  /** Create or update an adapter config and (re)start it */
  adapterConfigure: t.procedure
    .input(
      z.object({
        id: z.string(),
        type: z.string(),
        displayName: z.string().optional(),
        config: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = ctx.habitat.configStore.getAdapter(input.id);
      if (existing) {
        ctx.habitat.configStore.updateAdapter(input.id, {
          type: input.type,
          displayName: input.displayName,
          config: input.config,
        });
      } else {
        ctx.habitat.configStore.createAdapter({
          id: input.id,
          type: input.type,
          displayName: input.displayName,
          config: input.config,
        });
      }
      await ctx.habitat.supervisor.startAdapter({
        id: input.id,
        type: input.type,
        config: input.config,
      });
      ctx.habitat.reload();
      return { success: true };
    }),

  /** Stop and remove an adapter */
  adapterRemove: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.habitat.supervisor.stopAdapter(input.id);
      ctx.habitat.configStore.deleteAdapter(input.id);
      ctx.habitat.reload();
      return { success: true };
    }),

  /** Get health status for a single adapter */
  adapterStatus: t.procedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const health = ctx.habitat.supervisor.getAdapterHealth(input.id);
      return health ?? null;
    }),

  /** Restart a running adapter instance */
  adapterRestart: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.habitat.supervisor.restartAdapter(input.id);
      return { success: true };
    }),

  /** Get buffered logs for an adapter instance */
  adapterLogs: t.procedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => {
      return ctx.habitat.supervisor.getAdapterLogs(input.id);
    }),

  /** Subscribe to real-time adapter log entries */
  onAdapterLog: t.procedure
    .input(z.object({ id: z.string().optional() }).optional())
    .subscription(({ ctx, input }) => {
      return observable<{ adapterId: string; level: string; message: string; timestamp: number }>((emit) => {
        const handler = (data: { adapterId: string; level: string; message: string; timestamp: number }) => {
          if (!input?.id || data.adapterId === input.id) {
            emit.next(data);
          }
        };
        ctx.eventBus.on("adapter:log", handler);
        return () => ctx.eventBus.off("adapter:log", handler);
      });
    }),
});
