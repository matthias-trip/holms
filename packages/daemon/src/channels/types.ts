export interface ChannelConversation {
  id: string;              // globally unique: "web:default", "slack:#general"
  providerId: string;      // "web", "slack"
  externalId: string;      // provider-specific: "default", "#general"
  displayName: string;     // "Web UI", "#general"
  topic?: string;          // purpose: "electricity optimization & daily reports"
}

export interface InboundMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ApprovalAction {
  approvalId: string;
  decision: "approve" | "reject";
  userId: string;
}

export interface ApprovalPayload {
  id: string;
  deviceId: string;
  command: string;
  params: Record<string, unknown>;
  reason: string;
  message: string;
  approveLabel: string;
  rejectLabel: string;
}

export interface ChannelProvider {
  readonly id: string;
  readonly displayName: string;

  start(onMessage: (msg: InboundMessage) => void): Promise<void>;
  getConversations(): ChannelConversation[];
  sendToken(conversationId: string, messageId: string, token: string): void;
  sendStreamEnd(conversationId: string, messageId: string, content: string, reasoning?: string): void;
  stop(): Promise<void>;

  /** Pre-populate conversations from persisted storage on startup */
  seedConversations?(conversations: ChannelConversation[]): void;

  /** Send an image (e.g. rendered chart) with optional caption */
  sendImage?(conversationId: string, messageId: string, image: Buffer, caption?: string): Promise<void>;

  /** Send an interactive approval card (e.g. Block Kit buttons in Slack) */
  sendApproval?(conversationId: string, approval: ApprovalPayload): Promise<void>;
  /** Register a callback for when a user acts on an approval card */
  onApprovalAction?(callback: (action: ApprovalAction) => Promise<void>): void;
}

import type { ChannelCapabilities, ChannelConfigField, ChannelStatus } from "@holms/shared";
import type { z } from "zod";

export interface ChannelProviderDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly origin: "builtin" | "plugin";
  readonly capabilities: ChannelCapabilities;
  readonly configSchema: z.ZodObject<any>;

  getConfigFields(): ChannelConfigField[];
  validateConfig(config: Record<string, unknown>): string[] | null;
  createProvider(config: Record<string, unknown>): ChannelProvider;
  getStatus(): ChannelStatus;
  getStatusMessage(): string | undefined;
  setStatus(status: ChannelStatus, message?: string): void;
}
