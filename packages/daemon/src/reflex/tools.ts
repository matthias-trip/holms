import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ReflexStore } from "./store.js";

export function createReflexToolsServer(store: ReflexStore) {
  const createReflex = tool(
    "create_reflex",
    "Create a local reflex rule for instant event-to-action mapping. Reflexes fire immediately without AI reasoning, providing sub-second response times. Only create reflexes for patterns you have already handled successfully multiple times. NEVER create a reflex on first request — store the automation as a preference memory and handle events yourself first. NEVER create reflexes for automations with conditions (time-of-day, occupancy, etc.) as these will be silently dropped.",
    {
      trigger: z
        .object({
          deviceId: z.string().optional().describe("Device ID to match"),
          eventType: z.string().optional().describe("Event type to match"),
          condition: z
            .record(z.string(), z.unknown())
            .optional()
            .describe("Additional conditions on event data"),
          scheduleId: z
            .string()
            .optional()
            .describe("Schedule ID to match — use for time-based reflexes that fire when a schedule triggers"),
        })
        .describe("When to trigger this reflex"),
      action: z
        .object({
          deviceId: z.string().describe("Device to act on"),
          command: z.string().describe("Command to execute"),
          params: z
            .record(z.string(), z.unknown())
            .optional()
            .default({})
            .describe("Command parameters"),
        })
        .describe("What to do when triggered"),
      reason: z.string().describe("Why this reflex exists"),
    },
    async (args) => {
      const rule = store.create({
        trigger: args.trigger,
        action: args.action,
        reason: args.reason,
        createdBy: "coordinator",
        enabled: true,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Created reflex rule "${rule.id}": ${args.reason}`,
          },
        ],
      };
    },
  );

  const listReflexes = tool(
    "list_reflexes",
    "List all reflex rules, showing their triggers, actions, and status",
    {},
    async () => {
      const rules = store.getAll();
      return {
        content: [
          {
            type: "text" as const,
            text:
              rules.length === 0
                ? "No reflex rules configured."
                : JSON.stringify(rules, null, 2),
          },
        ],
      };
    },
  );

  const removeReflex = tool(
    "remove_reflex",
    "Remove a reflex rule by its ID",
    {
      id: z.string().describe("The reflex rule ID to remove"),
    },
    async (args) => {
      const removed = store.remove(args.id);
      return {
        content: [
          {
            type: "text" as const,
            text: removed
              ? `Removed reflex "${args.id}"`
              : `No reflex found with ID "${args.id}"`,
          },
        ],
      };
    },
  );

  const toggleReflex = tool(
    "toggle_reflex",
    "Enable or disable a reflex rule",
    {
      id: z.string().describe("The reflex rule ID to toggle"),
      enabled: z.boolean().describe("Whether to enable (true) or disable (false)"),
    },
    async (args) => {
      const rule = store.toggle(args.id, args.enabled);
      return {
        content: [
          {
            type: "text" as const,
            text: rule
              ? `Reflex "${args.id}" is now ${args.enabled ? "enabled" : "disabled"}`
              : `No reflex found with ID "${args.id}"`,
          },
        ],
      };
    },
  );

  return createSdkMcpServer({
    name: "reflex",
    version: "1.0.0",
    tools: [createReflex, listReflexes, removeReflex, toggleReflex],
  });
}
