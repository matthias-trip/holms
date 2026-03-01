import { AsyncLocalStorage } from "node:async_hooks";
import type { FlowContext } from "./query-runner.js";

interface QueryContext {
  channel?: string;
  messageId?: string;
  flowContext?: FlowContext;
}

const store = new AsyncLocalStorage<QueryContext>();

/** Get the channel from the current async context (if any). */
export function getQueryChannel(): string | undefined {
  return store.getStore()?.channel;
}

/** Get the messageId from the current async context (if any). */
export function getQueryMessageId(): string | undefined {
  return store.getStore()?.messageId;
}

/** Get the flow context from the current async context (if any). */
export function getQueryFlowContext(): FlowContext | undefined {
  return store.getStore()?.flowContext;
}

/** Run `fn` within an async context that exposes `channel`, `messageId`, and `flowContext` to MCP tools. */
export function runWithQueryContext<T>(channel: string | undefined, messageId: string | undefined, fn: () => T, flowContext?: FlowContext): T {
  if (channel === undefined && messageId === undefined && flowContext === undefined) return fn();
  return store.run({ channel, messageId, flowContext }, fn);
}
