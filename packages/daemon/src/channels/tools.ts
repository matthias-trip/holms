import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ChannelManager } from "./manager.js";

export function createChannelToolsServer(channelManager: ChannelManager) {
  const listConversations = tool(
    "list_conversations",
    "List all available conversations across all connected channel providers (web, Slack, WhatsApp, etc.). Returns id, providerId, displayName, and topic for each conversation. Use this to discover where you can send messages.",
    {},
    async () => {
      const conversations = channelManager.getConversations();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(conversations, null, 2),
          },
        ],
      };
    },
  );

  const sendMessage = tool(
    "send_message",
    "Send a one-way message to a specific conversation on any connected channel. Use list_conversations first to find the target conversation ID. This pushes a message without creating a coordinator turn or conversation history entry — ideal for reminders, notifications, and cross-channel messages.",
    {
      conversationId: z.string().describe("The target conversation ID (e.g. 'slack:#general')"),
      content: z.string().describe("The message content to send"),
    },
    async (args) => {
      const ok = channelManager.sendDirectMessage(args.conversationId, args.content);
      if (!ok) {
        return {
          content: [
            { type: "text" as const, text: `Failed to send message: conversation "${args.conversationId}" not found or provider not connected.` },
          ],
          isError: true,
        };
      }
      return {
        content: [
          { type: "text" as const, text: `Message sent to ${args.conversationId}.` },
        ],
      };
    },
  );

  return createSdkMcpServer({
    name: "channel",
    version: "1.0.0",
    tools: [listConversations, sendMessage],
  });
}
