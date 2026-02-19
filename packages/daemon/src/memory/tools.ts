import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { MemoryStore } from "./store.js";

export function createMemoryToolsServer(store: MemoryStore) {
  const memoryWrite = tool(
    "memory_write",
    "Store a new memory. Write retrieval_cues that describe the situations where this memory should surface — these cues are what gets searched, not the content itself. Use tags to organize memories however you see fit.",
    {
      content: z.string().describe("The memory content to store"),
      retrieval_cues: z
        .string()
        .describe(
          "Search-optimized cues describing when this memory should surface (e.g., 'kitchen light brightness preference evening bedtime')",
        ),
      tags: z
        .array(z.string())
        .optional()
        .default([])
        .describe("Free-form tags for categorization (e.g., 'preference', 'observation', 'pattern')"),
    },
    async (args) => {
      const memory = await store.write(args.content, args.retrieval_cues, args.tags);
      return {
        content: [
          {
            type: "text" as const,
            text: `Stored memory #${memory.id} [${args.tags.join(", ")}]: ${args.content}`,
          },
        ],
      };
    },
  );

  const memoryQuery = tool(
    "memory_query",
    "Search memories using semantic similarity. Returns ranked results with metadata about the result set. Use this before any device command to check for relevant preferences and context.",
    {
      query: z
        .string()
        .optional()
        .describe("Natural language search query — matched against retrieval_cues via semantic similarity"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Filter to memories with any of these tags"),
      time_range: z
        .object({
          start: z.number().optional().describe("Start timestamp (ms)"),
          end: z.number().optional().describe("End timestamp (ms)"),
        })
        .optional()
        .describe("Filter by creation time range"),
      limit: z
        .number()
        .optional()
        .default(20)
        .describe("Max results to return (default 20)"),
    },
    async (args) => {
      const { memories, meta } = await store.query({
        query: args.query,
        tags: args.tags,
        timeRange: args.time_range,
        limit: args.limit,
      });

      if (memories.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ memories: [], meta }, null, 2),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ memories, meta }, null, 2),
          },
        ],
      };
    },
  );

  const memoryRewrite = tool(
    "memory_rewrite",
    "Update an existing memory. Use this to consolidate similar memories, update stale content, or refine retrieval cues. If retrieval_cues are changed, the embedding is recomputed.",
    {
      id: z.number().describe("ID of the memory to update"),
      content: z.string().optional().describe("New content (omit to keep existing)"),
      retrieval_cues: z
        .string()
        .optional()
        .describe("New retrieval cues (omit to keep existing; triggers re-embedding if changed)"),
      tags: z
        .array(z.string())
        .optional()
        .describe("New tags (omit to keep existing)"),
    },
    async (args) => {
      const memory = await store.rewrite(args.id, {
        content: args.content,
        retrievalCues: args.retrieval_cues,
        tags: args.tags,
      });

      if (!memory) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No memory found with id ${args.id}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Updated memory #${memory.id}: ${memory.content}`,
          },
        ],
      };
    },
  );

  const memoryForget = tool(
    "memory_forget",
    "Delete a memory by ID. Use when a memory is no longer relevant or accurate.",
    {
      id: z.number().describe("ID of the memory to delete"),
    },
    async (args) => {
      const removed = store.forget(args.id);
      return {
        content: [
          {
            type: "text" as const,
            text: removed
              ? `Forgot memory #${args.id}`
              : `No memory found with id ${args.id}`,
          },
        ],
      };
    },
  );

  const memoryReflect = tool(
    "memory_reflect",
    "Get statistics about your memory store for self-maintenance. Returns total count, tag distribution, age distribution, similarity clusters (consolidation opportunities), and growth rate.",
    {},
    async () => {
      const stats = await store.reflect();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(stats, null, 2),
          },
        ],
      };
    },
  );

  return createSdkMcpServer({
    name: "memory",
    version: "2.0.0",
    tools: [memoryWrite, memoryQuery, memoryRewrite, memoryForget, memoryReflect],
  });
}
