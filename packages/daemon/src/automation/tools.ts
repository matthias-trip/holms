import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AutomationStore } from "./store.js";
import type { AutomationDisplay, AutomationTrigger } from "@holms/shared";
import { getQueryChannel } from "../coordinator/query-context.js";

const timeTriggerSchema = z.object({
  type: z.literal("time"),
  hour: z.number().min(0).max(23).describe("Hour of day (0-23)"),
  minute: z.number().min(0).max(59).describe("Minute of hour (0-59)"),
  recurrence: z.enum(["once", "daily", "weekdays", "weekends", "weekly"]).describe("How often it repeats"),
  dayOfWeek: z.number().min(0).max(6).nullable().describe("Day of week (0=Sun..6=Sat), only for weekly"),
});

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

const triggerSchema = z.discriminatedUnion("type", [
  timeTriggerSchema,
  deviceEventTriggerSchema,
  stateThresholdTriggerSchema,
]);

const displaySchema = z.object({
  conditions: z.array(z.string()).optional().describe("Human-readable conditions that must be true, e.g. ['Someone is home', 'After sunset']"),
  actions: z.array(z.string()).optional().describe("Human-readable action summaries, e.g. ['Dim living room to 20%', 'Lock front door']"),
});

export function createAutomationToolsServer(store: AutomationStore) {
  const createAutomation = tool(
    "create_automation",
    `Create an automation that wakes the AI with an instruction when triggered. Three trigger types:
- **time**: fires at a specific time (like a schedule). Example: "turn off lights at 22:30 daily"
- **device_event**: fires when a device emits a matching event. eventType must match the ACTUAL event type the device emits (e.g. "state_changed", "motion_detected", "contact_changed"). Do NOT invent event types like "turn_off" — devices emit generic events like "state_changed" with details in the data fields. Use the condition field to match specific state values using standard DAL keys. Example: trigger on kitchen light turning off → eventType: "state_changed", condition: { power: "off" }. Binary sensor activated → condition: { active: true }. If unsure about the exact event type, omit eventType to match ANY event from that device.
- **state_threshold**: fires when a numeric device state crosses a threshold. Example: "when living room temp exceeds 25°C, consider cooling"

The instruction is what you will reason about each time it fires. Do NOT create a reflex alongside the automation — let the learning loop handle promotion.

IMPORTANT: Always provide the display field with conditions (any "only if" guard-rails from the instruction) and actions (the concrete things you will do). This powers the UI pipeline visualization.`,
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
      if (automation.trigger.type === "time") {
        const t = automation.trigger;
        triggerDesc = `at ${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")} (${t.recurrence})`;
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
