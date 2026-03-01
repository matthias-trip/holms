import { createInterface } from "node:readline";
import type { AdapterFactory, Adapter } from "./types.js";
import type { ParentMessage, ChildMessage } from "./protocol.js";
import { PROTOCOL_VERSION } from "./protocol.js";

let adapter: Adapter | null = null;

function send(msg: ChildMessage): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function sendLog(level: "debug" | "info" | "warn" | "error", args: unknown[]): void {
  const message = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  send({ type: "log", level, message });
}

/** Intercept console.* so adapter authors can use them normally. */
function interceptConsole(): void {
  console.log = (...args: unknown[]) => sendLog("info", args);
  console.info = (...args: unknown[]) => sendLog("info", args);
  console.warn = (...args: unknown[]) => sendLog("warn", args);
  console.error = (...args: unknown[]) => sendLog("error", args);
  console.debug = (...args: unknown[]) => sendLog("debug", args);
}

async function handleMessage(factory: AdapterFactory, msg: ParentMessage): Promise<void> {
  switch (msg.type) {
    case "init": {
      if (msg.protocolVersion !== PROTOCOL_VERSION) {
        send({
          type: "error",
          message: `Protocol version mismatch: expected ${PROTOCOL_VERSION}, got ${msg.protocolVersion}`,
        });
        process.exit(1);
      }
      try {
        adapter = factory(msg.config);
        const { entities, groups } = await adapter.register();

        await adapter.subscribe((entityId, property, state) => {
          send({ type: "state_changed", entityId, property, state });
        });

        send({ type: "ready", entities, groups });
      } catch (err) {
        send({
          type: "error",
          message: `Init failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        process.exit(1);
      }
      break;
    }

    case "observe": {
      if (!adapter) {
        send({ type: "error", requestId: msg.requestId, message: "Not initialized" });
        return;
      }
      try {
        const state = await adapter.observe(msg.entityId, msg.property);
        send({ type: "observe_result", requestId: msg.requestId, state });
      } catch (err) {
        send({
          type: "error",
          requestId: msg.requestId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case "execute": {
      if (!adapter) {
        send({ type: "error", requestId: msg.requestId, message: "Not initialized" });
        return;
      }
      try {
        await adapter.execute(msg.entityId, msg.property, msg.command);
        send({ type: "execute_result", requestId: msg.requestId, success: true });
      } catch (err) {
        send({
          type: "execute_result",
          requestId: msg.requestId,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case "ping": {
      if (!adapter) {
        send({ type: "error", requestId: msg.requestId, message: "Not initialized" });
        return;
      }
      try {
        await adapter.ping();
        send({ type: "pong", requestId: msg.requestId });
      } catch (err) {
        send({
          type: "error",
          requestId: msg.requestId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case "discover": {
      if (!adapter) {
        send({ type: "error", requestId: msg.requestId, message: "Not initialized" });
        return;
      }
      if (!adapter.discover) {
        send({
          type: "discover_result",
          requestId: msg.requestId,
          gateways: [],
          message: "This adapter does not support discovery",
        });
        return;
      }
      try {
        const result = await adapter.discover(msg.params);
        send({
          type: "discover_result",
          requestId: msg.requestId,
          gateways: result.gateways,
          message: result.message,
        });
      } catch (err) {
        send({
          type: "error",
          requestId: msg.requestId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case "pair": {
      if (!adapter) {
        send({ type: "error", requestId: msg.requestId, message: "Not initialized" });
        return;
      }
      if (!adapter.pair) {
        send({
          type: "pair_result",
          requestId: msg.requestId,
          success: false,
          error: "This adapter does not support pairing",
        });
        return;
      }
      try {
        const result = await adapter.pair(msg.params);
        send({
          type: "pair_result",
          requestId: msg.requestId,
          success: result.success,
          credentials: result.credentials,
          error: result.error,
          message: result.message,
        });
      } catch (err) {
        send({
          type: "pair_result",
          requestId: msg.requestId,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case "query": {
      if (!adapter) {
        send({ type: "error", requestId: msg.requestId, message: "Not initialized" });
        return;
      }
      if (!adapter.query) {
        send({
          type: "error",
          requestId: msg.requestId,
          message: "This adapter does not support queries",
        });
        return;
      }
      try {
        const result = await adapter.query(msg.entityId, msg.property, msg.params);
        send({
          type: "query_result",
          requestId: msg.requestId,
          items: result.items,
          total: result.total,
          truncated: result.truncated,
        });
      } catch (err) {
        send({
          type: "error",
          requestId: msg.requestId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case "shutdown": {
      if (adapter) {
        await adapter.destroy();
      }
      process.exit(0);
    }
  }
}

/**
 * Entry point for adapter processes. Call this with your adapter factory
 * at the top level of your entry file:
 *
 * ```ts
 * import { runAdapter } from "@holms/adapter-sdk";
 * runAdapter((config) => new MyAdapter(config));
 * ```
 */
export function runAdapter(factory: AdapterFactory): void {
  interceptConsole();

  const rl = createInterface({ input: process.stdin });

  rl.on("line", (line) => {
    let msg: ParentMessage;
    try {
      msg = JSON.parse(line) as ParentMessage;
    } catch {
      process.stderr.write(`[adapter-sdk] Failed to parse message: ${line}\n`);
      return;
    }

    handleMessage(factory, msg).catch((err) => {
      send({
        type: "error",
        message: `Unhandled error: ${err instanceof Error ? err.message : String(err)}`,
      });
    });
  });

  rl.on("close", () => {
    // stdin closed — parent is gone
    process.exit(0);
  });
}
