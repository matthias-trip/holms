import { AsyncLocalStorage } from "node:async_hooks";

interface QueryContext {
  channel?: string;
}

const store = new AsyncLocalStorage<QueryContext>();

/** Get the channel from the current async context (if any). */
export function getQueryChannel(): string | undefined {
  return store.getStore()?.channel;
}

/** Run `fn` within an async context that exposes `channel` to MCP tools. */
export function runWithChannel<T>(channel: string | undefined, fn: () => T): T {
  if (channel === undefined) return fn();
  return store.run({ channel }, fn);
}
