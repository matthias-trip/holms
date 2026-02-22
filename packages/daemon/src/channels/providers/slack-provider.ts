import type { ChannelProvider, ChannelConversation, InboundMessage, ApprovalAction, ApprovalPayload } from "../types.js";
import { ApprovalMixin } from "../approval-mixin.js";
import { v4 as uuid } from "uuid";
import slackifyMarkdown from "slackify-markdown";

export class SlackProvider implements ChannelProvider {
  readonly id = "slack";
  readonly displayName = "Slack";

  private app: any;
  private onMessage: ((msg: InboundMessage) => void) | null = null;
  private conversations: ChannelConversation[] = [];
  private approval = new ApprovalMixin();

  /** Maps conversationId → last inbound message metadata (ts + channel) for reaction tracking */
  private lastInbound = new Map<string, { ts: string; channel: string }>();

  /** Maps messageId → tracking info for active requests (reaction added, original message ts) */
  private activeRequests = new Map<string, { channelId: string; userTs: string; reactionAdded: boolean }>();

  constructor(
    private botToken: string,
    private signingSecret: string,
    private appToken?: string,
  ) {}

  async start(onMessage: (msg: InboundMessage) => void): Promise<void> {
    this.onMessage = onMessage;

    // Dynamic import so @slack/bolt is only required when Slack is enabled
    const { App } = await import("@slack/bolt");

    // Validate token before starting the full app — auth.test is the
    // lightest possible API call and will fail fast with a clear error
    // if credentials are invalid, without spinning up Socket Mode.
    const { WebClient } = await import("@slack/web-api");
    const testClient = new WebClient(this.botToken);
    try {
      await testClient.auth.test();
    } catch (err: any) {
      const msg = err?.data?.error ?? err?.message ?? "unknown error";
      throw new Error(`Slack authentication failed: ${msg}`);
    }

    this.app = new App({
      token: this.botToken,
      signingSecret: this.signingSecret,
      socketMode: !!this.appToken,
      appToken: this.appToken,
    });

    // Listen for messages
    this.app.message(async ({ message }: any) => {
      if (message.subtype) return; // Skip bot messages, edits, etc.
      if (!message.text) return;

      const conversationId = `slack:${message.channel}`;

      // Ensure conversation is tracked — fetch full info for newly seen channels
      if (!this.conversations.find((c) => c.id === conversationId)) {
        let displayName = `#${message.channel}`;
        let topic: string | undefined;
        try {
          const info = await this.app.client.conversations.info({
            token: this.botToken,
            channel: message.channel,
          });
          if (info.channel?.name) displayName = `#${info.channel.name}`;
          if (info.channel?.topic?.value) topic = info.channel.topic.value;
        } catch (err: any) {
          console.warn("[Slack] Failed to fetch channel info:", err);
        }
        this.conversations.push({
          id: conversationId,
          providerId: "slack",
          externalId: message.channel,
          displayName,
          topic,
        });
      }

      // Store inbound metadata for reaction tracking
      this.lastInbound.set(conversationId, { ts: message.ts, channel: message.channel });

      this.onMessage?.({
        id: uuid(),
        conversationId,
        senderId: message.user,
        content: message.text,
        timestamp: Date.now(),
        metadata: { ts: message.ts, channel: message.channel },
      });
    });

    // Listen for approval button actions
    this.app.action(/^approval_(approve|reject)_/, async ({ action, ack, respond, body }: any) => {
      await ack();

      const parsed = this.approval.parseApprovalButtonId(action.action_id.replace("approval_", ""));
      if (!parsed) return;

      const userId = body?.user?.username ?? body?.user?.id ?? "unknown";
      const approved = parsed.decision === "approve";

      // Replace the Block Kit message — remove buttons, show result
      const emoji = approved ? ":white_check_mark:" : ":x:";
      const verb = approved ? "Approved" : "Rejected";
      await respond({
        replace_original: true,
        text: `${emoji} ${verb} by @${userId}`,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `${emoji} *${verb}* by <@${body?.user?.id ?? userId}>` },
          },
        ],
      });

      // Trigger the full backend approval flow
      this.approval.fireApprovalAction(parsed.approvalId, parsed.decision, userId)
        .catch((err) => console.error("[Slack] Approval callback error:", err));
    });

    await this.app.start();

    // Fetch joined conversations — try each type separately so a missing
    // scope (e.g. groups:read for private channels) doesn't block the rest.
    const allChannels: any[] = [];
    for (const type of ["public_channel", "private_channel"]) {
      try {
        const result = await this.app.client.conversations.list({
          token: this.botToken,
          types: type,
          exclude_archived: true,
          limit: 100,
        });
        if (result.channels) allChannels.push(...result.channels);
      } catch (err: any) {
        const needed = err?.data?.needed;
        if (needed) {
          console.warn(`[Slack] Cannot list ${type} — missing scope: ${needed}`);
        } else {
          console.warn(`[Slack] Failed to list ${type}:`, err);
        }
      }
    }
    this.conversations = allChannels
      .filter((ch: any) => ch.is_member)
      .map((ch: any) => ({
        id: `slack:${ch.id}`,
        providerId: "slack",
        externalId: ch.id,
        displayName: `#${ch.name}`,
        topic: ch.topic?.value,
      }));
  }

  seedConversations(conversations: ChannelConversation[]): void {
    for (const conv of conversations) {
      if (!this.conversations.find((c) => c.id === conv.id)) {
        this.conversations.push(conv);
      }
    }
  }

  getConversations(): ChannelConversation[] {
    return this.conversations;
  }

  sendToken(conversationId: string, messageId: string, _token: string): void {
    // On first token for this messageId, add a :thinking_face: reaction to the user's message.
    // All subsequent tokens are no-ops — don't post reasoning text to Slack.
    if (this.activeRequests.has(messageId)) return;

    const inbound = this.lastInbound.get(conversationId);
    if (!inbound) return;

    const channelId = inbound.channel;
    const userTs = inbound.ts;
    this.activeRequests.set(messageId, { channelId, userTs, reactionAdded: true });

    this.app?.client.reactions.add({
      token: this.botToken,
      channel: channelId,
      timestamp: userTs,
      name: "thinking_face",
    }).catch((err: any) => console.warn("[Slack] Failed to add reaction:", err));
  }

  sendStreamEnd(conversationId: string, messageId: string, content: string): void {
    const tracking = this.activeRequests.get(messageId);
    const channelId = tracking?.channelId ?? conversationId.replace("slack:", "");

    // Convert standard Markdown to Slack mrkdwn format before posting
    const mrkdwnContent = slackifyMarkdown(content);

    // Post a single final message
    this.app?.client.chat.postMessage({
      token: this.botToken,
      channel: channelId,
      text: mrkdwnContent,
    }).catch((err: any) => console.warn("[Slack] Failed to send final message:", err));

    // Remove the :thinking_face: reaction
    if (tracking?.reactionAdded) {
      this.app?.client.reactions.remove({
        token: this.botToken,
        channel: tracking.channelId,
        timestamp: tracking.userTs,
        name: "thinking_face",
      }).catch((err: any) => console.warn("[Slack] Failed to remove reaction:", err));
    }

    this.activeRequests.delete(messageId);
  }

  async sendApproval(conversationId: string, approval: ApprovalPayload): Promise<void> {
    const channelId = conversationId.replace("slack:", "");

    await this.app?.client.chat.postMessage({
      token: this.botToken,
      channel: channelId,
      text: approval.message,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: slackifyMarkdown(approval.message) },
        },
        { type: "divider" },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: approval.approveLabel, emoji: true },
              style: "primary",
              action_id: `approval_approve_${approval.id}`,
            },
            {
              type: "button",
              text: { type: "plain_text", text: approval.rejectLabel, emoji: true },
              style: "danger",
              action_id: `approval_reject_${approval.id}`,
            },
          ],
        },
      ],
    });
  }

  onApprovalAction(callback: (action: ApprovalAction) => Promise<void>): void {
    this.approval.onApprovalAction(callback);
  }

  async stop(): Promise<void> {
    this.activeRequests.clear();
    this.lastInbound.clear();

    try {
      await this.app?.stop();
    } catch {
      // Ignore errors during shutdown
    }
    this.app = null;
  }
}
