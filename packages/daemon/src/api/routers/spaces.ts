import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import type { TRPCContext } from "../context.js";
import type { HabitatEvent } from "../../habitat/types.js";

const t = initTRPC.context<TRPCContext>().create();

export const spacesRouter = t.router({
  /** List all spaces with cached state (no adapter calls) */
  list: t.procedure.query(({ ctx }) => {
    return ctx.habitat.engine.observeCached();
  }),

  /** Get a single space with cached state */
  get: t.procedure
    .input(z.object({ spaceId: z.string() }))
    .query(({ ctx, input }) => {
      const result = ctx.habitat.engine.observeCached(input.spaceId);
      const space = result.spaces[0];
      if (!space) return null;
      return space;
    }),

  /** Influence a space (send commands to sources) */
  influence: t.procedure
    .input(
      z.object({
        space: z.string(),
        target: z.object({
          property: z.string().optional(),
          source: z.string().optional(),
        }),
        params: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.habitat.engine.influence(
        input.space,
        input.target as { property?: any; source?: string },
        input.params,
      );
    }),

  /** Get space capabilities (displayName, floor, features) */
  capabilities: t.procedure.query(({ ctx }) => {
    return ctx.habitat.engine.capabilities();
  }),

  /** Subscribe to habitat events */
  onEvent: t.procedure.subscription(({ ctx }) => {
    return observable<HabitatEvent>((emit) => {
      const handler = (event: HabitatEvent) => {
        emit.next(event);
      };
      ctx.eventBus.on("habitat:event", handler);
      return () => ctx.eventBus.off("habitat:event", handler);
    });
  }),
});
