import type { ChannelProvider, ChannelConversation, InboundMessage, ApprovalPayload } from "../types.js";
import type { ChannelStatus } from "@holms/shared";
import { v4 as uuid } from "uuid";
import { mkdirSync } from "node:fs";

type BaileysModule = typeof import("@whiskeysockets/baileys");

export class WhatsAppProvider implements ChannelProvider {
  readonly id = "whatsapp";
  readonly displayName = "WhatsApp";

  private sock: any = null;
  private conversations = new Map<string, ChannelConversation>();
  private ownJid: string | null = null;
  private composingFor = new Set<string>();
  private stopped = false;

  constructor(
    private allowedNumbers: Set<string> | null,
    private authDir: string,
    private setStatus: (status: ChannelStatus, message?: string) => void,
  ) {}

  async start(onMessage: (msg: InboundMessage) => void): Promise<void> {
    // Ensure auth directory exists
    mkdirSync(this.authDir, { recursive: true });

    // Dynamic import to avoid top-level require issues
    const baileys: BaileysModule = await import("@whiskeysockets/baileys");
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      DisconnectReason,
      fetchLatestBaileysVersion,
    } = baileys;

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();

    // Silent logger — suppress noisy baileys/pino output
    const noop = () => {};
    const silentLogger = { level: "silent", info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop, child: () => silentLogger } as any;

    const createSocket = async () => {
      if (this.stopped) return;

      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: silentLogger,
      });

      this.sock = sock;

      sock.ev.on("connection.update", async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.setStatus("pairing", qr);
          console.log("[WhatsApp] QR code generated — scan in the UI");
        }

        if (connection === "open") {
          this.ownJid = sock.user?.id ?? null;
          this.setStatus("connected");
          console.log("[WhatsApp] Connected as", this.ownJid);
        }

        if (connection === "close") {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          if (shouldReconnect && !this.stopped) {
            console.log("[WhatsApp] Disconnected, reconnecting...");
            this.setStatus("disconnected", "Reconnecting...");
            // Small delay before reconnect
            await new Promise((r) => setTimeout(r, 2000));
            createSocket();
          } else {
            console.log("[WhatsApp] Logged out or stopped");
            this.setStatus("disconnected", "Logged out");
          }
        }
      });

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("messages.upsert", (upsert: any) => {
        if (this.stopped) return;

        const messages = upsert.messages ?? [];
        for (const msg of messages) {
          // Skip our own messages
          if (msg.key.fromMe) continue;

          // Skip status broadcasts
          if (msg.key.remoteJid === "status@broadcast") continue;

          const senderJid = msg.key.remoteJid;
          if (!senderJid) continue;

          // Check allow-list
          if (this.allowedNumbers) {
            // JID format: number@s.whatsapp.net — extract the number part
            const number = senderJid.split("@")[0];
            // Check both with and without + prefix
            if (!this.allowedNumbers.has(number) && !this.allowedNumbers.has(`+${number}`)) {
              console.log(`[WhatsApp] Blocked message from ${number} (not in allow list)`);
              continue;
            }
          }

          // Extract text content
          const text =
            msg.message?.conversation ??
            msg.message?.extendedTextMessage?.text ??
            msg.message?.imageMessage?.caption ??
            msg.message?.videoMessage?.caption;

          if (!text) continue;

          // Track conversation
          const conversationId = `whatsapp:${senderJid}`;
          if (!this.conversations.has(conversationId)) {
            const displayNumber = senderJid.split("@")[0];
            const pushName = msg.pushName ?? displayNumber;
            this.conversations.set(conversationId, {
              id: conversationId,
              providerId: "whatsapp",
              externalId: senderJid,
              displayName: pushName,
            });
            console.log(`[WhatsApp] New conversation: ${pushName} (${senderJid})`);
          }

          onMessage({
            id: uuid(),
            conversationId,
            senderId: senderJid,
            content: text,
            timestamp: (msg.messageTimestamp as number) * 1000 || Date.now(),
          });
        }
      });
    };

    await createSocket();
  }

  seedConversations(conversations: ChannelConversation[]): void {
    for (const conv of conversations) {
      if (!this.conversations.has(conv.id)) {
        this.conversations.set(conv.id, conv);
      }
    }
  }

  getConversations(): ChannelConversation[] {
    return Array.from(this.conversations.values());
  }

  sendToken(conversationId: string, _messageId: string, _token: string): void {
    // Send typing indicator on first token per message
    if (!this.composingFor.has(conversationId) && this.sock) {
      this.composingFor.add(conversationId);
      const jid = conversationId.replace("whatsapp:", "");
      this.sock.presenceSubscribe(jid).catch(() => {});
      this.sock.sendPresenceUpdate("composing", jid).catch(() => {});
    }
  }

  sendStreamEnd(conversationId: string, _messageId: string, content: string): void {
    const jid = conversationId.replace("whatsapp:", "");
    this.composingFor.delete(conversationId);

    if (this.sock) {
      // Clear composing indicator
      this.sock.sendPresenceUpdate("paused", jid).catch(() => {});
      // Send the actual message
      this.sock.sendMessage(jid, { text: content }).catch((err: any) => {
        console.error(`[WhatsApp] Failed to send message to ${jid}:`, err);
      });
    }
  }

  async sendImage(conversationId: string, _messageId: string, image: Buffer, caption?: string): Promise<void> {
    const jid = conversationId.replace("whatsapp:", "");
    if (!this.sock) return;

    await this.sock.sendMessage(jid, { image, caption }).catch((err: any) => {
      console.error(`[WhatsApp] Failed to send image to ${jid}:`, err);
    });
  }

  async sendApproval(conversationId: string, approval: ApprovalPayload): Promise<void> {
    const jid = conversationId.replace("whatsapp:", "");
    if (!this.sock) return;

    // Send as plain text — the agent handles approval responses conversationally
    // via resolve_approval when the user replies
    await this.sock.sendMessage(jid, { text: approval.message }).catch((err: any) => {
      console.error(`[WhatsApp] Failed to send approval message to ${jid}:`, err);
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    this.conversations.clear();
    this.composingFor.clear();
    console.log("[WhatsApp] Provider stopped");
  }
}
