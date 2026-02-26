import { AsyncLocalStorage } from "node:async_hooks";

interface QueryContext {
  channel?: string;
  messageId?: string;
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

/** Run `fn` within an async context that exposes `channel` and `messageId` to MCP tools. */
export function runWithQueryContext<T>(channel: string | undefined, messageId: string | undefined, fn: () => T): T {
  if (channel === undefined && messageId === undefined) return fn();
  return store.run({ channel, messageId }, fn);
}
