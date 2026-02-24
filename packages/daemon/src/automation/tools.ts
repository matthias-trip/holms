import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AutomationStore } from "./store.js";
import type { AutomationDisplay, AutomationTrigger } from "@holms/shared";
import { getQueryChannel } from "../coordinator/query-context.js";

const deviceEventTriggerSchema = z.object({
  type: z.literal("device_event"),
  deviceId: z.string().describe("Device ID to watch"),
  eventType: z.string().optional().describe("Actual device event type to match — e.g. 'state_changed', 'motion_detected'. Do NOT invent types like 'turn_off'. Omit to match any event from the device."),
  condition: z.record(z.string(), z.unknown()).optional().describe("Match on event data fields using standard DAL state keys. E.g. { power: 'off' } to match a light turning off, { power: 'on' } for turning on, { active: true } for a binary sensor activating, { locked: false } for a lock unlocking."),
});

const stateThresholdTriggerSchema = z.object({
  type: z.literal("state_threshold"),
  deviceId: z.string().describe("Device ID to watch"),
  stateKey: z.string().describe("Standard DAL state key to monitor — e.g. 'currentTemp', 'brightness', 'volume', 'speed', 'humidity', 'battery', 'position'"),
  operator: z.enum(["gt", "lt", "eq", "gte", "lte"]).describe("Comparison operator"),
  value: z.number().describe("Threshold value"),
});

const cronTriggerSchema = z.object({
  type: z.literal("cron"),
  expression: z.string().describe("Standard 5-field cron expression, e.g. '*/5 * * * *' (every 5 minutes), '0 */2 * * *' (every 2 hours), '30 6 * * 1-5' (6:30 AM weekdays)"),
});

const triggerSchema = z.discriminatedUnion("type", [
  deviceEventTriggerSchema,
  stateThresholdTriggerSchema,
  cronTriggerSchema,
]);

const displaySchema = z.object({
  conditions: z.array(z.string()).optional().describe("Guard-rail conditions BEYOND the trigger itself, e.g. ['Someone is home', 'After sunset']. NEVER include schedule, time, day-of-week, or event info here — that's already in the trigger. Omit this field entirely if there are no extra conditions."),
  actions: z.array(z.string()).optional().describe("Human-readable action summaries, e.g. ['Dim living room to 20%', 'Lock front door']"),
});

export function createAutomationToolsServer(store: AutomationStore) {
  const createAutomation = tool(
    "create_automation",
    `Create an automation that wakes the AI with an instruction when triggered. Three trigger types: **cron** (time-based), **device_event** (device emits matching event), **state_threshold** (numeric state crosses threshold). See system prompt for trigger details and eventType guidance.

Do NOT create a reflex alongside the automation — let the learning loop handle promotion.

IMPORTANT: Always provide the display field with actions and optionally conditions. Conditions are ONLY for guard-rails beyond what the trigger already expresses — e.g. "Someone is home", "After sunset". NEVER restate the trigger's schedule, event, or time as a condition. Omit conditions entirely if there are none beyond the trigger.`,
    {
      summary: z.string().max(100).describe("Short description shown in UI list (max 100 chars)"),
      instruction: z.string().describe("Full natural language instruction to execute when triggered"),
      trigger: triggerSchema.describe("When to fire this automation"),
      display: displaySchema.optional().describe("Visual summary for the UI pipeline. Always provide this with conditions and actions extracted from the instruction."),
    },
    async (args) => {
      const channel = getQueryChannel() ?? null;
      const automation = store.create({
        summary: args.summary,
        instruction: args.instruction,
        trigger: args.trigger as AutomationTrigger,
        display: args.display as AutomationDisplay | undefined,
        channel,
      });

      let triggerDesc: string;
      if (automation.trigger.type === "cron") {
        triggerDesc = `on cron schedule "${automation.trigger.expression}"`;
      } else if (automation.trigger.type === "device_event") {
        triggerDesc = `on ${automation.trigger.deviceId} ${automation.trigger.eventType ?? "any event"}`;
      } else {
        const t = automation.trigger;
        triggerDesc = `when ${t.deviceId}.${t.stateKey} ${t.operator} ${t.value}`;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Created automation "${automation.id}": "${args.summary}" — triggers ${triggerDesc}${automation.nextFireAt ? `. Next fire: ${new Date(automation.nextFireAt).toLocaleString()}` : ""}`,
          },
        ],
      };
    },
  );

  const listAutomations = tool(
    "list_automations",
    "List all automations with their triggers, instructions, and status",
    {},
    async () => {
      const automations = store.getAll();
      return {
        content: [
          {
            type: "text" as const,
            text:
              automations.length === 0
                ? "No automations configured."
                : JSON.stringify(automations, null, 2),
          },
        ],
      };
    },
  );

  const updateAutomation = tool(
    "update_automation",
    "Update an existing automation's trigger, instruction, summary, display, or enabled status. When updating instruction, also update the display field to keep the visual summary in sync.",
    {
      id: z.string().describe("Automation ID to update"),
      summary: z.string().max(100).optional().describe("New short description"),
      instruction: z.string().optional().describe("New instruction text"),
      trigger: triggerSchema.optional().describe("New trigger configuration"),
      display: displaySchema.optional().describe("Updated visual summary for the UI pipeline"),
      enabled: z.boolean().optional().describe("Enable or disable the automation"),
    },
    async (args) => {
      const { id, ...fields } = args;
      const automation = store.update(id, fields as Parameters<typeof store.update>[1]);
      return {
        content: [
          {
            type: "text" as const,
            text: automation
              ? `Updated automation "${id}".${automation.nextFireAt ? ` Next fire: ${new Date(automation.nextFireAt).toLocaleString()}` : ""}`
              : `No automation found with ID "${id}"`,
          },
        ],
      };
    },
  );

  const deleteAutomation = tool(
    "delete_automation",
    "Delete an automation by its ID",
    {
      id: z.string().describe("Automation ID to delete"),
    },
    async (args) => {
      const removed = store.remove(args.id);
      return {
        content: [
          {
            type: "text" as const,
            text: removed
              ? `Deleted automation "${args.id}"`
              : `No automation found with ID "${args.id}"`,
          },
        ],
      };
    },
  );

  return createSdkMcpServer({
    name: "automation",
    version: "1.0.0",
    tools: [createAutomation, listAutomations, updateAutomation, deleteAutomation],
  });
}
