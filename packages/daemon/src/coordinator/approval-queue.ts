import { v4 as uuid } from "uuid";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type {
  PendingApproval,
  ConfidenceLevel,
  ActionCategory,
} from "@holms/shared";
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

    // Auto-execute routine high-confidence actions
    if (entry.confidence === "high" && entry.category === "routine") {
      this.autoExecute(entry);
      return { ...entry, status: "approved" };
    }

    this.pending.set(entry.id, entry);
    this.eventBus.emit("approval:pending", entry);
    console.log(
      `[ApprovalQueue] Queued proposal ${entry.id}: ${entry.command} on ${entry.deviceId} (${entry.confidence}/${entry.category})`,
    );
    return entry;
  }

  async approve(id: string): Promise<void> {
    const entry = this.pending.get(id);
    if (!entry) return;

    entry.status = "approved";
    this.pending.delete(id);

    await this.deviceManager.executeCommand(
      entry.deviceId,
      entry.command,
      entry.params,
    );

    this.eventBus.emit("approval:resolved", { id, approved: true });
    console.log(`[ApprovalQueue] Approved and executed: ${id}`);
  }

  reject(id: string, reason?: string): void {
    const entry = this.pending.get(id);
    if (!entry) return;

    entry.status = "rejected";
    this.pending.delete(id);

    this.eventBus.emit("approval:resolved", {
      id,
      approved: false,
      reason,
    });
    console.log(`[ApprovalQueue] Rejected: ${id}${reason ? ` — ${reason}` : ""}`);
  }

  getPending(): PendingApproval[] {
    return Array.from(this.pending.values());
  }

  private async autoExecute(entry: PendingApproval): Promise<void> {
    await this.deviceManager.executeCommand(
      entry.deviceId,
      entry.command,
      entry.params,
    );
    this.eventBus.emit("approval:resolved", { id: entry.id, approved: true });
    console.log(
      `[ApprovalQueue] Auto-executed routine action: ${entry.command} on ${entry.deviceId}`,
    );
  }
}

export function createApprovalToolsServer(queue: ApprovalQueue) {
  const proposeAction = tool(
    "propose_action",
    "Propose a device action. For routine high-confidence actions, this executes immediately. For novel or critical actions, it queues for user approval. Use this instead of execute_device_command when you want supervised autonomy.",
    {
      deviceId: z.string().describe("Device ID to act on"),
      command: z.string().describe("Command to execute"),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .default({})
        .describe("Command parameters"),
      confidence: z
        .enum(["high", "medium", "low"])
        .describe("Your confidence level in this action"),
      category: z
        .enum(["routine", "novel", "critical"])
        .describe(
          "Action category: routine (known good), novel (first time), critical (high impact)",
        ),
      reason: z
        .string()
        .describe("Why you want to take this action"),
    },
    async (args) => {
      const result = queue.propose({
        deviceId: args.deviceId,
        command: args.command,
        params: args.params,
        confidence: args.confidence as ConfidenceLevel,
        category: args.category as ActionCategory,
        reason: args.reason,
      });

      if (result.status === "approved") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Action auto-executed (routine/high-confidence): ${args.command} on ${args.deviceId}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Action proposed and queued for user approval (ID: ${result.id}). Reason: ${args.reason}. The user will approve or reject this.`,
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
