import { v4 as uuid } from "uuid";
import type { CoordinatorHub } from "./coordinator-hub.js";
import type { ApprovalQueue } from "./approval-queue.js";
import type { ChatStore } from "../chat/store.js";
import type { EventBus } from "../event-bus.js";
import type { ChannelManager } from "../channels/manager.js";

export interface ApprovalProcessorDeps {
  hub: CoordinatorHub;
  chatStore: ChatStore;
  approvalQueue: ApprovalQueue;
  eventBus: EventBus;
  channelManager: ChannelManager;
}

/**
 * Shared approval decision handler used by both tRPC and channel callbacks.
 *
 * 1. Resolves the approval in ApprovalQueue (execute or reject)
 * 2. Updates the approval card in chat DB
 * 3. Inserts a thinking placeholder
 * 4. Runs the coordinator to produce a response
 * 5. Finalises the thinking row
 *
 * Returns `{ success, thinkingMessageId }`.
 */
export async function executeApprovalDecision(
  deps: ApprovalProcessorDeps,
  approvalId: string,
  approved: boolean,
  userReason?: string,
): Promise<{ success: boolean; thinkingMessageId: string | null }> {
  const { hub, chatStore, approvalQueue, eventBus, channelManager } = deps;

  // (0) Resolve in queue
  const entry = approved
    ? await approvalQueue.approve(approvalId)
    : approvalQueue.reject(approvalId, userReason);

  if (!entry) return { success: false, thinkingMessageId: null };

  // (a) Update the approval card in chat
  const cardMsg = chatStore.findByApprovalId(approvalId);
  if (cardMsg) {
    try {
      const parsed = JSON.parse(cardMsg.content);
      parsed.resolved = { approved };
      chatStore.updateMessage(cardMsg.id, {
        content: JSON.stringify(parsed),
        status: "approval_resolved",
      });
    } catch { /* content wasn't valid JSON */ }
  }

  // (b) Insert thinking placeholder
  const channel = hub.getApprovalChannel(approvalId);
  const [pid, conv] = channel.split(":");
  const thinkingId = uuid();
  chatStore.add({
    id: thinkingId,
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    status: "thinking",
    channel,
  });

  // Track the response for channel routing
  channelManager.trackResponse(thinkingId, pid ?? "web", conv ? channel : "web:default");

  // (c) Background: run coordinator, streaming into the thinking message
  processApprovalResult(deps, approvalId, approved, {
    deviceId: entry.deviceId,
    command: entry.command,
    params: entry.params,
    reason: entry.reason,
  }, thinkingId, userReason).catch(console.error);

  return { success: true, thinkingMessageId: thinkingId };
}

/**
 * Run the coordinator on approval result and stream its response into the
 * thinking placeholder message. On completion (or error) finalises the DB row
 * and emits `chat:stream_end` so the frontend clears the streaming state.
 */
async function processApprovalResult(
  deps: ApprovalProcessorDeps,
  approvalId: string,
  approved: boolean,
  action: { deviceId: string; command: string; params: Record<string, unknown>; reason: string },
  thinkingMessageId: string,
  userReason?: string,
): Promise<void> {
  const { hub, chatStore, eventBus } = deps;
  try {
    const channel = hub.getApprovalChannel(approvalId);
    const result = await hub.handleApprovalResult(
      approvalId, approved, action, userReason, thinkingMessageId, channel,
    );
    chatStore.updateMessage(thinkingMessageId, {
      content: result,
      status: null,
    });
  } catch (err) {
    console.error("[approval] coordinator error:", err);
    const fallback = "Sorry, I encountered an error processing this approval.";
    chatStore.updateMessage(thinkingMessageId, {
      content: fallback,
      status: null,
    });
    eventBus.emit("chat:stream_end", {
      messageId: thinkingMessageId,
      content: fallback,
      timestamp: Date.now(),
    });
  }
}
