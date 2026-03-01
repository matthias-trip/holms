import { v4 as uuid } from "uuid";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { PendingApproval } from "@holms/shared";
import type { Habitat } from "../habitat/habitat.js";
import type { EventBus } from "../event-bus.js";

export class ApprovalQueue {
  private pending = new Map<string, PendingApproval>();

  constructor(
    private habitat: Habitat,
    private eventBus: EventBus,
  ) {}

  propose(
    proposal: Omit<PendingApproval, "id" | "status" | "createdAt">,
  ): PendingApproval {
    const entry: PendingApproval = {
      ...proposal,
      id: uuid(),
      status: "pending",
      createdAt: Date.now(),
    };

    // Always queue for user approval — the agent's choice to use propose_action
    // is itself the signal that this needs human confirmation.
    this.pending.set(entry.id, entry);
    this.eventBus.emit("approval:pending", entry);
    console.log(
      `[ApprovalQueue] Queued proposal ${entry.id}: ${entry.command} on ${entry.deviceId}`,
    );
    return entry;
  }

  async approve(id: string): Promise<PendingApproval | undefined> {
    const entry = this.pending.get(id);
    if (!entry) return undefined;

    entry.status = "approved";
    this.pending.delete(id);

    await this.habitat.engine.influence(
      "",
      { source: entry.deviceId },
      entry.params,
    );

    this.eventBus.emit("approval:resolved", {
      id, approved: true,
      deviceId: entry.deviceId, command: entry.command, params: entry.params, actionReason: entry.reason,
    });
    console.log(`[ApprovalQueue] Approved and executed: ${id}`);
    return entry;
  }

  reject(id: string, reason?: string): PendingApproval | undefined {
    const entry = this.pending.get(id);
    if (!entry) return;

    entry.status = "rejected";
    this.pending.delete(id);

    this.eventBus.emit("approval:resolved", {
      id, approved: false, reason,
      deviceId: entry.deviceId, command: entry.command, params: entry.params, actionReason: entry.reason,
    });
    console.log(`[ApprovalQueue] Rejected: ${id}${reason ? ` — ${reason}` : ""}`);
    return entry;
  }

  getPending(): PendingApproval[] {
    return Array.from(this.pending.values());
  }
}

export function createApprovalToolsServer(queue: ApprovalQueue) {
  const proposeAction = tool(
    "propose_action",
    "Propose a device action that requires user approval before executing. The action will be queued and shown to the user with approve/reject buttons. You MUST use this when: a memory preference constrains the device, the action is security-sensitive (locks, alarms), the action is novel (first time), or you are uncertain about user intent. When in doubt, prefer this over execute_device_command.",
    {
      deviceId: z.string().describe("Device ID to act on"),
      command: z.string().describe("Command to execute"),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .default({})
        .describe("Command parameters"),
      reason: z
        .string()
        .describe("Why you want to take this action"),
      message: z
        .string()
        .describe("A user-facing message describing what you want to do and why. Write in the same language as the conversation."),
      approveLabel: z
        .string()
        .describe("Short label for the approve button, written in the conversation language. Be contextual, e.g. 'Yes, open gate' instead of generic 'Approve'."),
      rejectLabel: z
        .string()
        .describe("Short label for the reject button, written in the conversation language. Be contextual, e.g. 'No, keep closed' instead of generic 'Reject'."),
    },
    async (args) => {
      const result = queue.propose({
        deviceId: args.deviceId,
        command: args.command,
        params: args.params,
        reason: args.reason,
        message: args.message,
        approveLabel: args.approveLabel,
        rejectLabel: args.rejectLabel,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Action queued for user approval (ID: ${result.id}): ${args.command} on ${args.deviceId}. The user will approve or reject this.`,
          },
        ],
      };
    },
  );

  const resolveApproval = tool(
    "resolve_approval",
    "Resolve a pending approval based on the user's conversational response. Use this when a user replies to an approval request with text like 'yes', 'do it', 'no thanks', etc. You know the approval ID from the propose_action result.",
    {
      approvalId: z.string().describe("The approval ID returned by propose_action"),
      approved: z.boolean().describe("Whether the user approved (true) or rejected (false) the action"),
      reason: z.string().optional().describe("Optional reason for rejection"),
    },
    async (args) => {
      if (args.approved) {
        const result = await queue.approve(args.approvalId);
        if (!result) {
          return {
            content: [{ type: "text" as const, text: `Approval ${args.approvalId} not found or already resolved.` }],
          };
        }
        return {
          content: [{ type: "text" as const, text: `Approved and executed: ${result.command} on ${result.deviceId}.` }],
        };
      } else {
        const result = queue.reject(args.approvalId, args.reason);
        if (!result) {
          return {
            content: [{ type: "text" as const, text: `Approval ${args.approvalId} not found or already resolved.` }],
          };
        }
        return {
          content: [{ type: "text" as const, text: `Rejected: ${result.command} on ${result.deviceId}.${args.reason ? ` Reason: ${args.reason}` : ""}` }],
        };
      }
    },
  );

  return createSdkMcpServer({
    name: "approval",
    version: "1.0.0",
    tools: [proposeAction, resolveApproval],
  });
}
