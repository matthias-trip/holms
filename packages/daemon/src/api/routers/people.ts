import { initTRPC } from "@trpc/server";
import { z } from "zod";
import type { TRPCContext } from "../context.js";

const t = initTRPC.context<TRPCContext>().create();

export const peopleRouter = t.router({
  list: t.procedure.query(({ ctx }) => {
    return ctx.peopleStore.getAll();
  }),

  get: t.procedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => {
      return ctx.peopleStore.get(input.id) ?? null;
    }),

  create: t.procedure
    .input(z.object({
      name: z.string(),
      primaryChannel: z.string().optional(),
    }))
    .mutation(({ ctx, input }) => {
      return ctx.peopleStore.create(input.name, input.primaryChannel);
    }),

  update: t.procedure
    .input(z.object({
      id: z.string(),
      name: z.string().optional(),
      primaryChannel: z.string().nullish(),
    }))
    .mutation(({ ctx, input }) => {
      const person = ctx.peopleStore.update(input.id, {
        name: input.name,
        primaryChannel: input.primaryChannel,
      });
      if (!person) throw new Error(`Person ${input.id} not found`);
      return person;
    }),

  remove: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      const removed = ctx.peopleStore.remove(input.id);
      if (!removed) throw new Error(`Person ${input.id} not found`);
      return { success: true };
    }),

  linkChannel: t.procedure
    .input(z.object({
      personId: z.string(),
      channelId: z.string(),
      senderId: z.string().optional(),
    }))
    .mutation(({ ctx, input }) => {
      ctx.peopleStore.linkChannel(input.personId, input.channelId, input.senderId);
      return { success: true };
    }),

  unlinkChannel: t.procedure
    .input(z.object({
      personId: z.string(),
      channelId: z.string(),
    }))
    .mutation(({ ctx, input }) => {
      ctx.peopleStore.unlinkChannel(input.personId, input.channelId);
      return { success: true };
    }),
});
