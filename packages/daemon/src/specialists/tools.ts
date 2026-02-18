import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { SpecialistDomain } from "@holms/shared";

export function createSpecialistToolsServer(domain: SpecialistDomain) {
  const proposeAction = tool(
    "propose_action",
    "Propose a device action for the coordinator to review and execute. You do NOT execute actions directly — you propose them with confidence and reasoning.",
    {
      deviceId: z.string().describe("The device ID to act on"),
      command: z
        .string()
        .describe("The command to execute (e.g., turn_on, set_brightness, set_temperature)"),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .default({})
        .describe("Command parameters"),
      confidence: z
        .enum(["high", "medium", "low"])
        .describe("How confident are you this is the right action?"),
      category: z
        .enum(["routine", "novel", "critical"])
        .describe("Action category: routine (safe), novel (first time), critical (needs approval)"),
      reason: z
        .string()
        .describe("Why you're proposing this action"),
      priority: z
        .number()
        .min(1)
        .max(10)
        .describe("Priority 1-10 (10 = highest urgency)"),
    },
    async (args) => {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              _type: "proposal",
              specialist: domain,
              ...args,
              id: `${domain}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              timestamp: Date.now(),
            }),
          },
        ],
      };
    },
  );

  const flagConflict = tool(
    "flag_conflict",
    "Flag a potential conflict or cross-domain concern for the coordinator to resolve.",
    {
      description: z
        .string()
        .describe("Description of the conflict or concern"),
      affectedDeviceIds: z
        .array(z.string())
        .describe("Device IDs affected by this conflict"),
      suggestedResolution: z
        .string()
        .describe("Your suggested way to resolve this conflict"),
    },
    async (args) => {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              _type: "conflict",
              specialist: domain,
              ...args,
            }),
          },
        ],
      };
    },
  );

  const requestInfo = tool(
    "request_info",
    "Request additional information from the coordinator. Use when you need context you don't have.",
    {
      question: z
        .string()
        .describe("What information do you need?"),
    },
    async (args) => {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              _type: "info_request",
              specialist: domain,
              question: args.question,
            }),
          },
        ],
      };
    },
  );

  return createSdkMcpServer({
    name: `specialist-${domain}`,
    version: "1.0.0",
    tools: [proposeAction, flagConflict, requestInfo],
  });
}
