import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ProactiveScheduler } from "./proactive.js";
import { getQueryChannel } from "../coordinator/query-context.js";

export function createSchedulerToolsServer(scheduler: ProactiveScheduler) {
  const triggerProactive = tool(
    "trigger_proactive",
    `Trigger an immediate proactive cycle that runs in a separate ephemeral session. The result is posted back to the current channel once complete.

Types:
- "situational": Quick home state check — scan all devices, note anything unusual or noteworthy. Use after a sequence of events to take stock, or when the user asks for a status overview.
- "reflection": Review recent actions and outcomes — consolidate memories, check for patterns, maintain memory health. Use periodically or after significant activity.
- "goal_review": Assess active goals — check progress, update priorities, identify blocked goals. Use before complex planning or when re-evaluating strategy.
- "daily_summary": End-of-day recap — summarize what happened, what changed, what needs attention tomorrow. Normally fires automatically but can be triggered on demand.`,
    {
      type: z.enum(["situational", "reflection", "goal_review", "daily_summary"])
        .describe("The type of proactive cycle to trigger"),
    },
    async (args) => {
      const channel = getQueryChannel();
      // Fire-and-forget — the actual run happens in a separate ephemeral session
      scheduler.triggerWakeup(args.type, channel).catch((err) => {
        console.error(`[Scheduler] trigger_proactive error (${args.type}):`, err);
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Proactive ${args.type.replace("_", " ")} cycle triggered. It will run in a separate session and post results back to this channel.`,
          },
        ],
      };
    },
  );

  return createSdkMcpServer({
    name: "scheduler",
    version: "1.0.0",
    tools: [triggerProactive],
  });
}
