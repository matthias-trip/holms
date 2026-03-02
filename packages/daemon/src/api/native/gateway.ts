import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuid } from "uuid";
import type { TRPCContext } from "../context.js";
import type { EventBus } from "../../event-bus.js";
import {
  ClientMessageSchema,
  SubscribePayload,
  UnsubscribePayload,
  type ServerMessage,
  type SubscriptionStream,
} from "./protocol.js";
import { dispatchCommand } from "./handlers.js";

interface NativeClient {
  id: string;
  ws: WebSocket;
  subscriptions: Set<SubscriptionStream>;
  conversationId: string;
  personId?: string;
}

/**
 * Native WebSocket gateway for non-tRPC clients (iOS, macOS, etc.).
 * Multiplexes events and commands over a single JSON WebSocket at /ws/native.
 */
export class NativeGateway {
  readonly wss: WebSocketServer;
  private clients = new Map<string, NativeClient>();
  private ctx: TRPCContext;
  private eventBus: EventBus;
  private cleanupFns: (() => void)[] = [];

  constructor(ctx: TRPCContext) {
    this.ctx = ctx;
    this.eventBus = ctx.eventBus;
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));
    this.wireEventBus();
  }

  private handleConnection(ws: WebSocket, req?: import("http").IncomingMessage): void {
    const clientId = uuid();
    const identity = (req as any)?.__authIdentity as { type: string; personId?: string } | undefined;
    const client: NativeClient = {
      id: clientId,
      ws,
      subscriptions: new Set(),
      conversationId: `native:${clientId}`,
      personId: identity?.personId,
    };
    this.clients.set(clientId, client);
    console.log(`[NativeGW] Client connected: ${clientId}${client.personId ? ` (person: ${client.personId})` : ""}`);

    ws.on("message", (raw) => this.handleMessage(client, raw));
    ws.on("close", () => {
      this.clients.delete(clientId);
      console.log(`[NativeGW] Client disconnected: ${clientId}`);
    });
    ws.on("error", (err) => {
      console.error(`[NativeGW] Client error ${clientId}:`, err.message);
    });
  }

  private async handleMessage(client: NativeClient, raw: unknown): Promise<void> {
    let parsed: { id: string; type: string; payload: unknown };
    try {
      const text = typeof raw === "string" ? raw : raw?.toString?.() ?? "";
      parsed = ClientMessageSchema.parse(JSON.parse(text));
    } catch {
      this.send(client, { type: "error", payload: { message: "Invalid message format" } });
      return;
    }

    const { id, type, payload } = parsed;

    try {
      // Handle subscribe/unsubscribe locally
      if (type === "subscribe") {
        const { events } = SubscribePayload.parse(payload);
        for (const stream of events) client.subscriptions.add(stream);

        // Send initial snapshots for newly subscribed streams
        if (events.includes("spaces")) {
          const snapshot = await this.ctx.habitat.engine.observe();
          this.send(client, { id, type: "spaces.snapshot", payload: snapshot });
        }
        if (events.includes("approvals")) {
          const pending = this.ctx.approvalQueue.getPending();
          this.send(client, { id, type: "response", payload: { approvals: pending } });
        }
        if (events.includes("location")) {
          const zones = this.ctx.peopleStore.getZones();
          this.send(client, { id, type: "location.zones_changed", payload: { zones } });
        }

        this.send(client, { id, type: "response", payload: { subscribed: events } });
        return;
      }

      if (type === "unsubscribe") {
        const { events } = UnsubscribePayload.parse(payload);
        for (const stream of events) client.subscriptions.delete(stream);
        this.send(client, { id, type: "response", payload: { unsubscribed: events } });
        return;
      }

      // Dispatch all other commands
      const { responseType, data } = await dispatchCommand(type, payload, this.ctx, client.conversationId, client.personId);
      this.send(client, { id, type: responseType, payload: data });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.send(client, { id, type: "error", payload: { message } });
    }
  }

  /** Wire EventBus events to subscribed clients. */
  private wireEventBus(): void {
    const on = <K extends Parameters<EventBus["on"]>[0]>(
      event: K,
      stream: SubscriptionStream,
      type: string,
      transform?: (data: any) => unknown,
    ) => {
      const listener = (data: any) => {
        const payload = transform ? transform(data) : data;
        this.broadcast(stream, { type, payload });
      };
      this.eventBus.on(event, listener);
      this.cleanupFns.push(() => this.eventBus.off(event, listener));
    };

    // Spaces events
    on("habitat:event", "spaces", "spaces.event");

    // Chat events
    on("chat:token", "chat", "chat.token");
    on("chat:stream_end", "chat", "chat.end");
    on("chat:status", "chat", "chat.status");

    // Approval events
    on("approval:pending", "approvals", "approval.new");
    on("approval:resolved", "approvals", "approval.resolved");

    // Activity events
    on("activity:stored", "activity", "activity.new");

    // Location zone changes — broadcast to clients subscribed to "location"
    on("location:zones_changed", "location", "location.zones_changed");
  }

  /** Send a message to a specific client. */
  private send(client: NativeClient, msg: ServerMessage): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(msg));
    }
  }

  /** Broadcast to all clients subscribed to a specific stream. */
  private broadcast(stream: SubscriptionStream, msg: ServerMessage): void {
    for (const client of this.clients.values()) {
      if (client.subscriptions.has(stream)) {
        this.send(client, msg);
      }
    }
  }

  /** Get count of connected clients. */
  get clientCount(): number {
    return this.clients.size;
  }

  /** Clean up all listeners and close connections. */
  close(): void {
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns = [];
    for (const client of this.clients.values()) {
      client.ws.close();
    }
    this.clients.clear();
    this.wss.close();
  }
}
