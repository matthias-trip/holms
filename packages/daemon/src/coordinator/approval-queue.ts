import { v4 as uuid } from "uuid";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { PendingApproval } from "@holms/shared";
import type { DeviceManager } from "../devices/manager.js";
import type { EventBus } from "../event-bus.js";

export class ApprovalQueue {
  private pending = new Map<string, PendingApproval>();

  constructor(
    private deviceManager: DeviceManager,
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

    await this.deviceManager.executeCommand(
      entry.deviceId,
      entry.command,
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
    },
    async (args) => {
      const result = queue.propose({
        deviceId: args.deviceId,
        command: args.command,
        params: args.params,
        reason: args.reason,
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

  return createSdkMcpServer({
    name: "approval",
    version: "1.0.0",
    tools: [proposeAction],
  });
}
