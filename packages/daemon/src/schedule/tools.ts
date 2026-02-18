import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ScheduleStore } from "./store.js";

export function createScheduleToolsServer(store: ScheduleStore) {
  const createSchedule = tool(
    "create_schedule",
    "Create a time-based schedule. The schedule will fire at the specified time and you will receive the instruction to reason about. Do NOT create a reflex alongside the schedule — let the learning loop handle promotion after repeated successful executions.",
    {
      instruction: z.string().describe("Natural language instruction to execute when the schedule fires"),
      hour: z.number().min(0).max(23).describe("Hour of day (0-23)"),
      minute: z.number().min(0).max(59).describe("Minute of hour (0-59)"),
      recurrence: z
        .enum(["once", "daily", "weekdays", "weekends", "weekly"])
        .describe("How often the schedule repeats"),
      dayOfWeek: z
        .number()
        .min(0)
        .max(6)
        .optional()
        .describe("Day of week (0=Sun..6=Sat), only for weekly recurrence"),
    },
    async (args) => {
      const schedule = store.create({
        instruction: args.instruction,
        hour: args.hour,
        minute: args.minute,
        recurrence: args.recurrence,
        dayOfWeek: args.dayOfWeek ?? null,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Created schedule "${schedule.id}": "${args.instruction}" at ${String(args.hour).padStart(2, "0")}:${String(args.minute).padStart(2, "0")} (${args.recurrence}). Next fire: ${new Date(schedule.nextFireAt).toLocaleString()}`,
          },
        ],
      };
    },
  );

  const listSchedules = tool(
    "list_schedules",
    "List all schedules with their times, recurrence, and next fire times",
    {},
    async () => {
      const schedules = store.getAll();
      return {
        content: [
          {
            type: "text" as const,
            text:
              schedules.length === 0
                ? "No schedules configured."
                : JSON.stringify(schedules, null, 2),
          },
        ],
      };
    },
  );

  const updateSchedule = tool(
    "update_schedule",
    "Update an existing schedule's time, recurrence, instruction, or enabled status",
    {
      id: z.string().describe("Schedule ID to update"),
      instruction: z.string().optional().describe("New instruction text"),
      hour: z.number().min(0).max(23).optional().describe("New hour (0-23)"),
      minute: z.number().min(0).max(59).optional().describe("New minute (0-59)"),
      recurrence: z
        .enum(["once", "daily", "weekdays", "weekends", "weekly"])
        .optional()
        .describe("New recurrence"),
      dayOfWeek: z.number().min(0).max(6).optional().describe("New day of week"),
      enabled: z.boolean().optional().describe("Enable or disable the schedule"),
    },
    async (args) => {
      const { id, ...fields } = args;
      const schedule = store.update(id, fields);
      return {
        content: [
          {
            type: "text" as const,
            text: schedule
              ? `Updated schedule "${id}". Next fire: ${new Date(schedule.nextFireAt).toLocaleString()}`
              : `No schedule found with ID "${id}"`,
          },
        ],
      };
    },
  );

  const deleteSchedule = tool(
    "delete_schedule",
    "Delete a schedule by its ID",
    {
      id: z.string().describe("Schedule ID to delete"),
    },
    async (args) => {
      const removed = store.remove(args.id);
      return {
        content: [
          {
            type: "text" as const,
            text: removed
              ? `Deleted schedule "${args.id}"`
              : `No schedule found with ID "${args.id}"`,
          },
        ],
      };
    },
  );

  return createSdkMcpServer({
    name: "schedule",
    version: "1.0.0",
    tools: [createSchedule, listSchedules, updateSchedule, deleteSchedule],
  });
}
