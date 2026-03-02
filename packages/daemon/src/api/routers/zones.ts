import { initTRPC } from "@trpc/server";
import { z } from "zod";
import type { TRPCContext } from "../context.js";

const t = initTRPC.context<TRPCContext>().create();

export const zonesRouter = t.router({
  list: t.procedure.query(({ ctx }) => {
    return ctx.peopleStore.getZones();
  }),

  create: t.procedure
    .input(z.object({
      name: z.string(),
      latitude: z.number(),
      longitude: z.number(),
      radiusMeters: z.number().optional(),
    }))
    .mutation(({ ctx, input }) => {
      const zone = ctx.peopleStore.createZone(input.name, input.latitude, input.longitude, input.radiusMeters);
      ctx.eventBus.emit("location:zones_changed", { zones: ctx.peopleStore.getZones() });
      return zone;
    }),

  update: t.procedure
    .input(z.object({
      id: z.string(),
      name: z.string().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      radiusMeters: z.number().optional(),
    }))
    .mutation(({ ctx, input }) => {
      const zone = ctx.peopleStore.updateZone(input.id, {
        name: input.name,
        latitude: input.latitude,
        longitude: input.longitude,
        radiusMeters: input.radiusMeters,
      });
      if (!zone) throw new Error(`Zone ${input.id} not found`);
      ctx.eventBus.emit("location:zones_changed", { zones: ctx.peopleStore.getZones() });
      return zone;
    }),

  remove: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      const removed = ctx.peopleStore.removeZone(input.id);
      if (!removed) throw new Error(`Zone ${input.id} not found`);
      ctx.eventBus.emit("location:zones_changed", { zones: ctx.peopleStore.getZones() });
      return { success: true };
    }),

  personLocations: t.procedure.query(({ ctx }) => {
    const people = ctx.peopleStore.getAll();
    return people.map((person) => ({
      person,
      location: ctx.peopleStore.getCurrentLocation(person.id) ?? null,
    }));
  }),
});
