import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { TriageStore } from "./store.js";

export function createTriageToolsServer(store: TriageStore) {
  const setTriageRule = tool(
    "set_triage_rule",
    "Create a triage rule to control how device events reach you. Events are classified into three lanes:\n- **immediate**: Wakes you right away. Use for events requiring instant reasoning — binary sensor changes, security events, significant state changes.\n- **batched**: Accumulated and delivered every ~2 minutes. Use for gradual changes that don't need instant response — temperature drift, energy updates.\n- **silent**: Updates device state but never wakes you. Use for pure telemetry noise — unchanged values, periodic heartbeats, command confirmations.\n\nRules are matched by specificity: deviceId > deviceType > room > wildcard. First match wins.",
    {
      condition: z
        .object({
          deviceId: z.string().optional().describe("Specific device ID to match"),
          deviceType: z
            .enum(["light", "thermostat", "motion_sensor", "door_lock", "switch", "contact_sensor"])
            .optional()
            .describe("Match all devices of this type"),
          eventType: z.string().optional().describe("Event type to match (e.g. state_changed, motion_detected)"),
          room: z.string().optional().describe("Match all devices in this room"),
          stateKey: z.string().optional().describe("Numeric state key for delta threshold matching (e.g. temperature)"),
          deltaThreshold: z
            .number()
            .optional()
            .describe("Change must exceed this value to match the rule. Used with stateKey."),
        })
        .describe("Conditions for matching events"),
      lane: z
        .enum(["immediate", "batched", "silent"])
        .describe("Which triage lane to route matching events to"),
      reason: z.string().describe("Why this rule exists — for your future reference"),
    },
    async (args) => {
      const existing = store.findByCondition(args.condition);
      if (existing) {
        const updated = store.update(existing.id, {
          lane: args.lane,
          reason: args.reason,
          enabled: true,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Updated existing triage rule "${existing.id}": route ${args.lane} — ${args.reason}`,
            },
          ],
        };
      }
      const rule = store.create({
        condition: args.condition,
        lane: args.lane,
        reason: args.reason,
        createdBy: "coordinator",
        enabled: true,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Created triage rule "${rule.id}": route ${args.lane} — ${args.reason}`,
          },
        ],
      };
    },
  );

  const listTriageRules = tool(
    "list_triage_rules",
    "List all triage rules, showing their conditions, lanes, and status. Use during reflection to review and tune your event filtering.",
    {},
    async () => {
      const rules = store.getAll();
      return {
        content: [
          {
            type: "text" as const,
            text:
              rules.length === 0
                ? "No triage rules configured. Using built-in defaults."
                : JSON.stringify(rules, null, 2),
          },
        ],
      };
    },
  );

  const removeTriageRule = tool(
    "remove_triage_rule",
    "Remove a triage rule by its ID",
    {
      id: z.string().describe("The triage rule ID to remove"),
    },
    async (args) => {
      const removed = store.remove(args.id);
      return {
        content: [
          {
            type: "text" as const,
            text: removed
              ? `Removed triage rule "${args.id}"`
              : `No triage rule found with ID "${args.id}"`,
          },
        ],
      };
    },
  );

  const toggleTriageRule = tool(
    "toggle_triage_rule",
    "Enable or disable a triage rule",
    {
      id: z.string().describe("The triage rule ID to toggle"),
      enabled: z.boolean().describe("Whether to enable (true) or disable (false)"),
    },
    async (args) => {
      const rule = store.toggle(args.id, args.enabled);
      return {
        content: [
          {
            type: "text" as const,
            text: rule
              ? `Triage rule "${args.id}" is now ${args.enabled ? "enabled" : "disabled"}`
              : `No triage rule found with ID "${args.id}"`,
          },
        ],
      };
    },
  );

  return createSdkMcpServer({
    name: "triage",
    version: "1.0.0",
    tools: [setTriageRule, listTriageRules, removeTriageRule, toggleTriageRule],
  });
}
