import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { GoalStatus, GoalEventType } from "@holms/shared";
import type { GoalStore } from "./store.js";

export function createGoalToolsServer(store: GoalStore) {
  const goalCreate = tool(
    "goal_create",
    "Create a new tracked goal. Goals represent long-term objectives you're working toward — energy efficiency, comfort routines, security improvements, etc. Created goals start as active.",
    {
      title: z.string().describe("Short descriptive title for the goal"),
      description: z.string().describe("Detailed description of what this goal aims to achieve and how you plan to work toward it"),
    },
    async (args) => {
      const goal = store.create(args.title, args.description);
      return {
        content: [{
          type: "text" as const,
          text: `Created goal "${goal.title}" (${goal.id})`,
        }],
      };
    },
  );

  const goalList = tool(
    "goal_list",
    "List all goals, optionally filtered by status. Returns goals ordered by attention-needed first, then most recently updated.",
    {
      status: z
        .enum(["active", "paused", "completed", "abandoned"])
        .optional()
        .describe("Filter by goal status. Omit to list all goals."),
    },
    async (args) => {
      const goals = store.list(args.status as GoalStatus | undefined);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(goals, null, 2),
        }],
      };
    },
  );

  const goalGet = tool(
    "goal_get",
    "Get a single goal with its recent timeline of events (observations, actions, milestones, status changes, attention flags).",
    {
      goal_id: z.string().describe("ID of the goal to retrieve"),
      event_limit: z.number().optional().default(20).describe("Max timeline events to return (default 20)"),
    },
    async (args) => {
      const goal = store.get(args.goal_id);
      if (!goal) {
        return {
          content: [{ type: "text" as const, text: `No goal found with id ${args.goal_id}` }],
        };
      }
      const events = store.getEvents(args.goal_id, args.event_limit);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ ...goal, events }, null, 2),
        }],
      };
    },
  );

  const goalLog = tool(
    "goal_log",
    "Log an event to a goal's timeline. Use during any turn — not just goal_review — to track observations, actions taken, or milestones reached.",
    {
      goal_id: z.string().describe("ID of the goal to log to"),
      type: z
        .enum(["observation", "action", "milestone", "attention", "user_note"])
        .describe("Type of event: observation (something noticed), action (something done), milestone (significant progress), attention (needs user input), user_note (user-provided context)"),
      content: z.string().describe("Description of the event"),
    },
    async (args) => {
      const goal = store.get(args.goal_id);
      if (!goal) {
        return {
          content: [{ type: "text" as const, text: `No goal found with id ${args.goal_id}` }],
        };
      }
      const event = store.addEvent(args.goal_id, args.type as GoalEventType, args.content);
      return {
        content: [{
          type: "text" as const,
          text: `Logged ${args.type} to goal "${goal.title}": ${args.content}`,
        }],
      };
    },
  );

  const goalUpdate = tool(
    "goal_update",
    "Update a goal's status or attention flag. Use to mark goals as completed/abandoned, pause/resume them, or flag for user attention when blocked or uncertain.",
    {
      goal_id: z.string().describe("ID of the goal to update"),
      status: z
        .enum(["active", "paused", "completed", "abandoned"])
        .optional()
        .describe("New status for the goal"),
      needs_attention: z
        .boolean()
        .optional()
        .describe("Flag the goal for user attention (true) or dismiss the flag (false)"),
      attention_reason: z
        .string()
        .optional()
        .describe("Why the goal needs attention — shown to the user in the UI"),
      summary: z
        .string()
        .optional()
        .describe("Short status summary shown in the UI (1 line, e.g. 'Monitoring energy usage, 2 peaks detected this week')"),
      next_steps: z
        .string()
        .optional()
        .describe("Markdown bullet list of planned next actions (e.g. '- Monitor energy peaks tomorrow\\n- Adjust thermostat schedule if pattern holds')"),
    },
    async (args) => {
      const goal = store.update(args.goal_id, {
        status: args.status as GoalStatus | undefined,
        needsAttention: args.needs_attention,
        attentionReason: args.attention_reason,
        summary: args.summary,
        nextSteps: args.next_steps,
      });
      if (!goal) {
        return {
          content: [{ type: "text" as const, text: `No goal found with id ${args.goal_id}` }],
        };
      }
      const parts = [`Updated goal "${goal.title}"`];
      if (args.status) parts.push(`→ ${args.status}`);
      if (args.needs_attention !== undefined) parts.push(args.needs_attention ? "(flagged for attention)" : "(attention dismissed)");
      return {
        content: [{ type: "text" as const, text: parts.join(" ") }],
      };
    },
  );

  return createSdkMcpServer({
    name: "goals",
    version: "1.0.0",
    tools: [goalCreate, goalList, goalGet, goalLog, goalUpdate],
  });
}
