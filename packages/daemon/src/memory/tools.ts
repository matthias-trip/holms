import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { MemoryStore } from "./store.js";

export function createMemoryToolsServer(store: MemoryStore) {
  const memoryWrite = tool(
    "memory_write",
    "Store a new memory. Write retrieval_cues that describe the situations where this memory should surface — these cues are what gets searched, not the content itself. Use tags to organize memories (searchable via memory_query tag filter).",
    {
      content: z.string().describe("The memory content to store"),
      retrieval_cues: z
        .string()
        .describe(
          "10–30 word search-optimized cues describing when this memory should surface. Pack with keywords and context — don't repeat the content verbatim. Example: 'kitchen light brightness preference evening bedtime routine dimming'",
        ),
      tags: z
        .array(z.string())
        .optional()
        .default([])
        .describe("Free-form tags for categorization (e.g., 'preference', 'observation', 'pattern'). Used by memory_query tag filter to narrow searches."),
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
    "Search memories by semantic similarity, tag filter, time range, or any combination. Returns ranked results plus meta: totalMatches (how many matched before limit), ageRangeMs (span of matched memories), highSimilarityCluster (groups with >0.85 similarity — consolidation candidates). Omitting query returns memories by recency. Use before any device command to check for preferences.",
    {
      query: z
        .string()
        .optional()
        .describe("Natural language search query — matched against retrieval_cues via semantic similarity"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Filter to memories with any of these tags. Combined as AND with query when both provided. Omit to search all tags."),
      time_range: z
        .object({
          start: z.number().optional().describe("Start timestamp in Unix epoch milliseconds (e.g., Date.now() - 86400000 for last 24h)"),
          end: z.number().optional().describe("End timestamp in Unix epoch milliseconds (e.g., Date.now() for now)"),
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
    "Update an existing memory. Use to consolidate similar memories (query similar → rewrite the best one with merged content → forget the rest), update stale content, or refine retrieval cues. Re-embeds if retrieval_cues change.",
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
    "Get memory store statistics for self-maintenance. Returns: totalCount, tagDistribution, ageDistribution (bucketed), similarClusters (groups with >0.85 similarity — merge candidates), recentGrowthRate (memories/day over last 7 days).",
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
