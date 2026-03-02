import { z } from "zod";

// ── Wire Format ────────────────────────────────────────────────────────────

/** Client → Server message envelope */
export const ClientMessageSchema = z.object({
  id: z.string(),
  type: z.string(),
  payload: z.unknown().default({}),
});
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/** Server → Client message envelope */
export interface ServerMessage {
  id?: string;
  type: string;
  payload: unknown;
}

// ── Subscription Streams ───────────────────────────────────────────────────

export const SUBSCRIPTION_STREAMS = [
  "spaces",
  "chat",
  "approvals",
  "activity",
  "location",
] as const;
export type SubscriptionStream = (typeof SUBSCRIPTION_STREAMS)[number];

// ── Command Payloads ───────────────────────────────────────────────────────

export const SubscribePayload = z.object({
  events: z.array(z.enum(SUBSCRIPTION_STREAMS)),
});

export const UnsubscribePayload = z.object({
  events: z.array(z.enum(SUBSCRIPTION_STREAMS)),
});

export const SpacesInfluencePayload = z.object({
  space: z.string(),
  target: z.union([
    z.object({ property: z.string() }),
    z.object({ source: z.string() }),
  ]),
  params: z.record(z.string(), z.unknown()),
});

export const ChatSendPayload = z.object({
  message: z.string(),
  channel: z.string().optional(),
});

export const ChatHistoryPayload = z.object({
  limit: z.number().int().positive().optional().default(50),
  before: z.number().optional(),
});

export const ApprovalApprovePayload = z.object({
  id: z.string(),
});

export const ApprovalRejectPayload = z.object({
  id: z.string(),
  reason: z.string().optional(),
});

// ── Location Payloads ─────────────────────────────────────────────

export const LocationUpdatePayload = z.object({
  zoneId: z.string().nullable(),
  zoneName: z.string(),
  event: z.enum(["enter", "exit"]),
});

export const LocationZonesPayload = z.object({});

// ── Server Event Types ─────────────────────────────────────────────────────

export type ServerEventType =
  | "response"
  | "error"
  | "spaces.event"
  | "spaces.snapshot"
  | "chat.token"
  | "chat.end"
  | "chat.status"
  | "approval.new"
  | "approval.resolved"
  | "activity.new"
  | "location.zones_changed"
  | "pong";
