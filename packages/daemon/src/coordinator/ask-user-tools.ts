import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import type { EventBus } from "../event-bus.js";
import type { ChannelManager } from "../channels/manager.js";
import type { ChatStore } from "../chat/store.js";
import { getQueryChannel, getQueryMessageId } from "./query-context.js";

export function createAskUserToolsServer(
  chatStore: ChatStore,
  eventBus: EventBus,
  channelManager: ChannelManager,
) {
  const askUser = tool(
    "ask_user",
    `Present a structured question to the user with selectable options.

Use this when you need the user to choose between concrete options — adapter setup flows, room selection, configuration choices, preferences, confirmations. The user sees clickable buttons for each option and can optionally type a free-text answer.

Do NOT use this for open-ended conversation — just send a normal message instead. Use it when there are specific options to pick from.

IMPORTANT: After calling this tool, your turn ends. STOP immediately — do not call more tools or continue reasoning. The user's next message will contain their answer.`,
    {
      prompt: z.string().describe("The question to display to the user"),
      options: z.array(z.string()).min(0).describe("Selectable options the user can pick from"),
      allow_free_input: z.boolean().default(true).describe("Whether to allow the user to type a custom answer instead of picking an option"),
      input_type: z.enum(["text", "secret"]).default("text").describe("Input type. Use 'secret' for passwords, API keys, and tokens — renders a password field and the agent receives an opaque $secret:... reference instead of the plaintext value"),
    },
    async (args) => {
      const channel = getQueryChannel();
      const messageId = getQueryMessageId();

      if (!channel || !messageId) {
        return {
          content: [{
            type: "text" as const,
            text: "No active channel context — cannot ask user. Send the question as a normal message instead.",
          }],
        };
      }

      // Check if the channel supports interactive questions
      const capabilities = channelManager.getCapabilities(channel);
      if (!capabilities?.interactiveQuestions) {
        // Fallback: return the question as formatted text for the agent to relay
        const optionsList = args.options.map((opt, i) => `${i + 1}. ${opt}`).join("\n");
        const freeInputNote = args.allow_free_input ? "\n\n(The user can also type a custom answer.)" : "";
        return {
          content: [{
            type: "text" as const,
            text: `This channel doesn't support interactive questions. Send the question as a normal message and wait for the user's text reply. Here's the question to relay:\n\n${args.prompt}\n\nOptions:\n${optionsList}${freeInputNote}`,
          }],
        };
      }

      // Persist question as a chat message
      const questionMsgId = uuid();
      const questionData = {
        questionId: questionMsgId,
        prompt: args.prompt,
        options: args.options,
        allowFreeInput: args.allow_free_input,
        ...(args.input_type === "secret" ? { inputType: "secret" as const } : {}),
      };

      chatStore.add({
        id: questionMsgId,
        role: "assistant",
        content: JSON.stringify(questionData),
        timestamp: Date.now(),
        status: "question_pending",
        channel,
      });

      // Emit stream_end so the frontend picks it up as a regular message
      eventBus.emit("chat:stream_end", {
        messageId: questionMsgId,
        content: JSON.stringify(questionData),
        timestamp: Date.now(),
      });

      return {
        content: [{
          type: "text" as const,
          text: "Question displayed to the user. STOP here — do not call more tools or continue reasoning. The user's next message will contain their answer.",
        }],
      };
    },
  );

  return createSdkMcpServer({
    name: "ask_user",
    version: "1.0.0",
    tools: [askUser],
  });
}
