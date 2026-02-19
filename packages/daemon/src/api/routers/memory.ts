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

  entityNotes: t.procedure.query(({ ctx }) => {
    const notes = ctx.memoryStore.getEntityNotes();
    return Array.from(notes.entries()).map(([entityId, mem]) => ({
      id: mem.id,
      entityId,
      content: mem.content,
      retrievalCues: mem.retrievalCues,
      tags: mem.tags,
      updatedAt: mem.updatedAt,
    }));
  }),

  searchEntityNotes: t.procedure
    .input(z.object({ query: z.string() }))
    .query(async ({ ctx, input }) => {
      const results = await ctx.memoryStore.queryEntityNotes(input.query, 50);
      return results.map((mem) => ({
        id: mem.id,
        entityId: mem.entityId,
        content: mem.content,
        retrievalCues: mem.retrievalCues,
        tags: mem.tags,
        updatedAt: mem.updatedAt,
        similarity: mem.similarity,
      }));
    }),

  delete: t.procedure
    .input(z.object({ id: z.number() }))
    .mutation(({ ctx, input }) => {
      return ctx.memoryStore.forget(input.id);
    }),
});
