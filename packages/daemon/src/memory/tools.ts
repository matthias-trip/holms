import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { MemoryStore } from "./store.js";

export function createMemoryToolsServer(store: MemoryStore) {
  const remember = tool(
    "remember",
    "Store a memory with a key, content, type, and optional tags. Types: observation, preference, pattern, goal, reflection, plan. Use this to learn from events, store user preferences, record patterns you notice, set goals, reflect on outcomes, or plan future actions.",
    {
      key: z
        .string()
        .describe(
          "Unique key for this memory (e.g., 'user_bedtime_preference', 'morning_routine_pattern')",
        ),
      content: z.string().describe("The memory content to store"),
      type: z
        .enum([
          "observation",
          "preference",
          "pattern",
          "goal",
          "reflection",
          "plan",
        ])
        .describe("Type of memory"),
      tags: z
        .array(z.string())
        .optional()
        .default([])
        .describe("Tags for categorization"),
    },
    async (args) => {
      const memory = store.remember(args.key, args.content, args.type, args.tags);
      return {
        content: [
          {
            type: "text" as const,
            text: `Stored memory "${args.key}" (${args.type}): ${args.content}`,
          },
        ],
      };
    },
  );

  const recall = tool(
    "recall",
    "Search memories by keyword. Returns all memories whose key, content, or tags match the query.",
    {
      query: z.string().describe("Search query to find relevant memories"),
    },
    async (args) => {
      const memories = store.recall(args.query);
      if (memories.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No memories found matching that query.",
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(memories, null, 2),
          },
        ],
      };
    },
  );

  const forget = tool(
    "forget",
    "Remove a memory by its key. Use when a memory is no longer relevant or accurate.",
    {
      key: z.string().describe("The key of the memory to remove"),
    },
    async (args) => {
      const removed = store.forget(args.key);
      return {
        content: [
          {
            type: "text" as const,
            text: removed
              ? `Forgot memory "${args.key}"`
              : `No memory found with key "${args.key}"`,
          },
        ],
      };
    },
  );

  return createSdkMcpServer({
    name: "memory",
    version: "1.0.0",
    tools: [remember, recall, forget],
  });
}
