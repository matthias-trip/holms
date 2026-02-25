import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { MemoryStore } from "./store.js";

export function createMemoryToolsServer(store: MemoryStore) {
  const memoryWrite = tool(
    "memory_write",
    "Store a new memory. Write retrieval_cues that describe the situations where this memory should surface — these cues are what gets searched, not the content itself. Use tags to organize memories. Optionally associate with a device (entity_id) or person (person_id). Pin important facts (pin: true) to make them visible every turn in context.",
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
      entity_id: z
        .string()
        .optional()
        .describe("Associate this memory with a device. Pinned entity memories appear inline in device context every turn. Example: 'binary_sensor.front_door'"),
      person_id: z
        .string()
        .optional()
        .describe("Associate this memory with a person (by person ID). Pinned person memories appear inline in people context every turn."),
      pin: z
        .boolean()
        .optional()
        .default(false)
        .describe("Pin this memory to make it visible every turn in context. Use for stable preferences, device identity, and current state. Pinned entity/person memories show inline with the associated device/person."),
      scope: z
        .string()
        .optional()
        .describe("Conversation scope for this memory. Pass the conversation ID (e.g. 'whatsapp:31612345678@s.whatsapp.net') for personal/per-user memories. Omit for household-level memories visible to everyone."),
    },
    async (args) => {
      const memory = await store.write(args.content, args.retrieval_cues, args.tags, {
        entityId: args.entity_id,
        personId: args.person_id,
        pinned: args.pin,
        scope: args.scope,
      });
      const parts = [`Stored memory #${memory.id}`];
      if (args.tags.length > 0) parts.push(`[${args.tags.join(", ")}]`);
      if (args.pin) parts.push("(pinned)");
      if (args.entity_id) parts.push(`entity=${args.entity_id}`);
      if (args.person_id) parts.push(`person=${args.person_id}`);
      parts.push(`: ${args.content}`);
      return {
        content: [
          {
            type: "text" as const,
            text: parts.join(" "),
          },
        ],
      };
    },
  );

  const memoryQuery = tool(
    "memory_query",
    "Search memories by semantic similarity, tag filter, time range, entity, person, or any combination. Returns ranked results plus meta: totalMatches (how many matched before limit), ageRangeMs (span of matched memories), highSimilarityCluster (groups with >0.85 similarity — consolidation candidates). Omitting query returns memories by recency. Use before any device command to check for preferences.",
    {
      query: z
        .string()
        .optional()
        .describe("Natural language search query — matched against retrieval_cues via semantic similarity"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Filter to memories with any of these tags. Combined as AND with query when both provided. Omit to search all tags."),
      entity_id: z
        .string()
        .optional()
        .describe("Filter to memories associated with this device (entity ID)"),
      person_id: z
        .string()
        .optional()
        .describe("Filter to memories associated with this person (person ID)"),
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
      scope: z
        .string()
        .optional()
        .describe("Filter to memories visible in this conversation scope. Returns global memories + memories scoped to this conversation. Omit to see all memories."),
    },
    async (args) => {
      const { memories, meta } = await store.query({
        query: args.query,
        tags: args.tags,
        timeRange: args.time_range,
        limit: args.limit,
        scope: args.scope,
        entityId: args.entity_id,
        personId: args.person_id,
      });

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
    "Update an existing memory. Use to consolidate similar memories (query similar → rewrite the best one with merged content → forget the rest), update stale content, refine retrieval cues, or toggle pin status. Re-embeds if retrieval_cues change.",
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
      pin: z
        .boolean()
        .optional()
        .describe("Set pin status (omit to keep existing). Pin to make visible every turn; unpin for search-only."),
    },
    async (args) => {
      const memory = await store.rewrite(args.id, {
        content: args.content,
        retrievalCues: args.retrieval_cues,
        tags: args.tags,
        pinned: args.pin,
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
            text: `Updated memory #${memory.id}${memory.pinned ? " (pinned)" : ""}: ${memory.content}`,
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

  const memoryMerge = tool(
    "memory_merge",
    "Merge multiple source memories into a single target memory. Replaces N separate rewrite+forget calls with one atomic operation. Rewrites the target with merged content, deletes all sources, and validates coverage — warns if any source concept may become unretrievable under the new retrieval cues (similarity < 0.7). Review coverage warnings and broaden retrieval_cues if needed.",
    {
      target_id: z.number().describe("ID of the memory to keep (will be rewritten with merged content)"),
      source_ids: z.array(z.number()).describe("IDs of memories to merge into the target (will be deleted after merge)"),
      content: z.string().describe("New merged content for the target memory"),
      retrieval_cues: z
        .string()
        .describe("New retrieval cues covering all merged concepts. Pack with keywords from ALL source memories to maximize coverage."),
      tags: z
        .array(z.string())
        .describe("Tags for the merged memory"),
    },
    async (args) => {
      const result = await store.merge({
        targetId: args.target_id,
        sourceIds: args.source_ids,
        content: args.content,
        retrievalCues: args.retrieval_cues,
        tags: args.tags,
      });

      if (!result) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Merge failed: target memory #${args.target_id} not found`,
            },
          ],
        };
      }

      const parts = [`Merged ${args.source_ids.length} memories into #${result.memory.id}: ${result.memory.content}`];
      if (result.coverageWarnings.length > 0) {
        parts.push("\n\nCoverage warnings:");
        for (const w of result.coverageWarnings) {
          parts.push(`- Source #${w.sourceId} (similarity ${w.similarity}): "${w.sourceContent}" — consider broadening retrieval_cues`);
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: parts.join("\n"),
          },
        ],
      };
    },
  );

  const memoryReflect = tool(
    "memory_reflect",
    "Get memory store statistics for self-maintenance. Returns: totalCount, tagDistribution, ageDistribution (bucketed), similarClusters (groups with >0.85 similarity — merge candidates with IDs and content snippets), staleMemories (unpinned, not updated in 30+ days, sorted by access count — lowest first are strongest prune candidates), neverAccessed (stored but never surfaced in any query, older than 7 days — likely low value), recentGrowthRate (memories/day over last 7 days). Use memory_merge to efficiently consolidate clusters.",
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
    version: "3.0.0",
    tools: [memoryWrite, memoryQuery, memoryRewrite, memoryForget, memoryMerge, memoryReflect],
  });
}
