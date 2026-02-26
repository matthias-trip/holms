import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ChannelManager } from "../channels/manager.js";
import { getQueryChannel, getQueryMessageId } from "./query-context.js";

export function createProgressToolsServer(channelManager: ChannelManager) {
  const progressUpdate = tool(
    "progress_update",
    "Send a brief progress update to the user while you're working on a multi-step request. The message appears as a lightweight status in their channel (italicized in WhatsApp/Slack, status line in web). Use this to keep users informed during long-running tasks — e.g. 'Checking your current automations...', 'Analyzing the data now...'. Don't overdo it: one update per logical phase, not per tool call.",
    {
      message: z.string().describe("Short progress message to show the user (1-2 sentences max)"),
    },
    async (args) => {
      const channel = getQueryChannel();
      const messageId = getQueryMessageId();

      if (!channel || !messageId) {
        return {
          content: [
            { type: "text" as const, text: "No active channel context — progress update skipped." },
          ],
        };
      }

      channelManager.sendProgressUpdate(messageId, args.message);

      return {
        content: [
          { type: "text" as const, text: `Progress update sent: "${args.message}"` },
        ],
      };
    },
  );

  return createSdkMcpServer({
    name: "progress",
    version: "1.0.0",
    tools: [progressUpdate],
  });
}
