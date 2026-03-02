import { v4 as uuid } from "uuid";
import type { TRPCContext } from "../context.js";
import type { ServerMessage } from "./protocol.js";
import {
  SpacesInfluencePayload,
  ChatSendPayload,
  ChatHistoryPayload,
  ApprovalApprovePayload,
  ApprovalRejectPayload,
  LocationUpdatePayload,
} from "./protocol.js";

type Handler = (payload: unknown, ctx: TRPCContext, conversationId: string, personId?: string) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  "spaces.list": async (_payload, ctx) => {
    const result = await ctx.habitat.engine.observe();
    return result;
  },

  "spaces.influence": async (payload, ctx) => {
    const { space, target, params } = SpacesInfluencePayload.parse(payload);
    const result = await ctx.habitat.engine.influence(
      space,
      target as { property?: any; source?: string },
      params,
    );
    return result;
  },

  "chat.send": async (payload, ctx, conversationId) => {
    const { message, channel } = ChatSendPayload.parse(payload);
    const targetChannel = channel ?? conversationId;

    const msgId = uuid();
    await ctx.channelManager.sendMessage({
      id: msgId,
      conversationId: targetChannel,
      senderId: "native-user",
      content: message,
      timestamp: Date.now(),
    });
    return { messageId: msgId };
  },

  "chat.history": async (payload, ctx, conversationId) => {
    const { limit, before } = ChatHistoryPayload.parse(payload);
    const messages = ctx.chatStore.getHistory(limit, before, conversationId);
    return { messages };
  },

  "approval.pending": async (_payload, ctx) => {
    return { approvals: ctx.approvalQueue.getPending() };
  },

  "approval.approve": async (payload, ctx) => {
    const { id } = ApprovalApprovePayload.parse(payload);
    const result = await ctx.approvalQueue.approve(id);
    if (!result) throw new Error(`Approval ${id} not found`);
    return { approved: true, id };
  },

  "approval.reject": async (payload, ctx) => {
    const { id, reason } = ApprovalRejectPayload.parse(payload);
    const result = ctx.approvalQueue.reject(id, reason);
    if (!result) throw new Error(`Approval ${id} not found`);
    return { rejected: true, id };
  },

  "location.update": async (payload, ctx, _conversationId, personId) => {
    if (!personId) throw new Error("Location updates require an authenticated device linked to a person");
    const { zoneId, zoneName, event } = LocationUpdatePayload.parse(payload);
    const update = ctx.peopleStore.recordLocationChange(personId, zoneId, zoneName, event);
    ctx.habitat.updatePersonLocation(personId, {
      zone_id: zoneId,
      zone_name: zoneName,
      event,
      since: update.timestamp,
    });
    return { success: true };
  },

  "location.zones": async (_payload, ctx) => {
    return { zones: ctx.peopleStore.getZones() };
  },

  ping: async () => {
    return { time: Date.now() };
  },
};

/**
 * Dispatch an incoming command to the appropriate handler.
 * Returns the response payload or throws on error.
 */
export async function dispatchCommand(
  type: string,
  payload: unknown,
  ctx: TRPCContext,
  conversationId: string,
  personId?: string,
): Promise<{ responseType: string; data: unknown }> {
  if (type === "ping") {
    return { responseType: "pong", data: { time: Date.now() } };
  }

  const handler = handlers[type];
  if (!handler) {
    throw new Error(`Unknown command: ${type}`);
  }

  const data = await handler(payload, ctx, conversationId, personId);
  return { responseType: "response", data };
}
