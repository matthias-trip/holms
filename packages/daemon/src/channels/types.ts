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

export interface ChannelProvider {
  readonly id: string;
  readonly displayName: string;

  start(onMessage: (msg: InboundMessage) => void): Promise<void>;
  getConversations(): ChannelConversation[];
  sendToken(conversationId: string, messageId: string, token: string): void;
  sendStreamEnd(conversationId: string, messageId: string, content: string, reasoning?: string): void;
  stop(): Promise<void>;
}
