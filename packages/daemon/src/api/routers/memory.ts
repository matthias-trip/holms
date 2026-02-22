import { initTRPC } from "@trpc/server";
import { z } from "zod";
import type { TRPCContext } from "../context.js";

const t = initTRPC.context<TRPCContext>().create();

export const memoryRouter = t.router({
  list: t.procedure
    .input(
      z
        .object({
          tags: z.array(z.string()).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      if (input?.tags && input.tags.length > 0) {
        const { memories } = await ctx.memoryStore.query({ tags: input.tags });
        return memories;
      }
      return ctx.memoryStore.getAll();
    }),

  search: t.procedure
    .input(z.object({ query: z.string() }))
    .query(async ({ ctx, input }) => {
      const { memories, meta } = await ctx.memoryStore.query({ query: input.query, limit: 50 });
      return { memories, meta };
    }),

  pinnedByEntity: t.procedure.query(({ ctx }) => {
    const map = ctx.memoryStore.getPinnedByEntity();
    const result: { entityId: string; memories: ReturnType<typeof ctx.memoryStore.getAll> }[] = [];
    for (const [entityId, memories] of map) {
      result.push({ entityId, memories });
    }
    return result;
  }),

  pinnedByPerson: t.procedure.query(({ ctx }) => {
    const map = ctx.memoryStore.getPinnedByPerson();
    const result: { personId: string; memories: ReturnType<typeof ctx.memoryStore.getAll> }[] = [];
    for (const [personId, memories] of map) {
      result.push({ personId, memories });
    }
    return result;
  }),

  delete: t.procedure
    .input(z.object({ id: z.number() }))
    .mutation(({ ctx, input }) => {
      return ctx.memoryStore.forget(input.id);
    }),
});
