import https from "node:https";
import type { IncomingMessage } from "node:http";
import type { HueSSEEvent } from "./types.js";

export class HueSSEListener {
  private req: ReturnType<typeof https.request> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 1_000;
  private stopped = false;

  constructor(
    private bridgeIp: string,
    private apiKey: string,
    private agent: https.Agent,
  ) {}

  start(onEvent: (events: HueSSEEvent[]) => void, onError?: (err: Error) => void): void {
    this.stopped = false;
    this.connect(onEvent, onError);
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.req) {
      this.req.destroy();
      this.req = null;
    }
  }

  private connect(onEvent: (events: HueSSEEvent[]) => void, onError?: (err: Error) => void): void {
    if (this.stopped) return;

    this.req = https.request(
      `https://${this.bridgeIp}/eventstream/clip/v2`,
      {
        method: "GET",
        agent: this.agent,
        headers: {
          "hue-application-key": this.apiKey,
          Accept: "text/event-stream",
        },
      },
      (res: IncomingMessage) => {
        if (res.statusCode !== 200) {
          const err = new Error(`Hue SSE: HTTP ${res.statusCode}`);
          onError?.(err);
          this.scheduleReconnect(onEvent, onError);
          return;
        }

        // Connected — reset backoff
        this.backoffMs = 1_000;

        let buffer = "";

        res.setEncoding("utf-8");
        res.on("data", (chunk: string) => {
          buffer += chunk;

          // SSE messages are separated by double newlines
          const parts = buffer.split("\n\n");
          // Keep the last (potentially incomplete) part in the buffer
          buffer = parts.pop()!;

          for (const part of parts) {
            if (!part.trim()) continue;
            const dataLines = part
              .split("\n")
              .filter((line) => line.startsWith("data: "))
              .map((line) => line.slice(6));

            if (dataLines.length === 0) continue;

            try {
              const parsed = JSON.parse(dataLines.join("")) as HueSSEEvent[];
              onEvent(parsed);
            } catch {
              // Malformed SSE data — skip
            }
          }
        });

        res.on("end", () => {
          if (!this.stopped) {
            this.scheduleReconnect(onEvent, onError);
          }
        });

        res.on("error", (err) => {
          onError?.(err);
          if (!this.stopped) {
            this.scheduleReconnect(onEvent, onError);
          }
        });
      },
    );

    this.req.on("error", (err) => {
      onError?.(err);
      if (!this.stopped) {
        this.scheduleReconnect(onEvent, onError);
      }
    });

    this.req.end();
  }

  private scheduleReconnect(
    onEvent: (events: HueSSEEvent[]) => void,
    onError?: (err: Error) => void,
  ): void {
    if (this.stopped) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(onEvent, onError);
    }, this.backoffMs);
    // Exponential backoff capped at 30s
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
  }
}
