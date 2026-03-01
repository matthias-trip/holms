import type { PropertyName, EntityRegistration, EntityGroup } from "./types.js";

export const PROTOCOL_VERSION = 4;

// ── Parent → Child Messages ─────────────────────────────────────────────────

export interface InitMessage {
  type: "init";
  protocolVersion: number;
  adapterId: string;
  adapterType: string;
  config: Record<string, unknown>;
}

export interface ObserveMessage {
  type: "observe";
  requestId: string;
  entityId: string;
  property: PropertyName;
}

export interface ExecuteMessage {
  type: "execute";
  requestId: string;
  entityId: string;
  property: PropertyName;
  command: Record<string, unknown>;
}

export interface PingMessage {
  type: "ping";
  requestId: string;
}

export interface ShutdownMessage {
  type: "shutdown";
}

export interface DiscoverMessage {
  type: "discover";
  requestId: string;
  params: Record<string, unknown>;
}

export interface PairMessage {
  type: "pair";
  requestId: string;
  params: Record<string, unknown>;
}

export interface QueryMessage {
  type: "query";
  requestId: string;
  entityId: string;
  property: PropertyName;
  params: Record<string, unknown>;
}

export type ParentMessage =
  | InitMessage
  | ObserveMessage
  | ExecuteMessage
  | PingMessage
  | ShutdownMessage
  | DiscoverMessage
  | PairMessage
  | QueryMessage;

// ── Child → Parent Messages ─────────────────────────────────────────────────

export interface ReadyMessage {
  type: "ready";
  entities: EntityRegistration[];
  groups?: EntityGroup[];
}

export interface ObserveResultMessage {
  type: "observe_result";
  requestId: string;
  state: Record<string, unknown>;
}

export interface ExecuteResultMessage {
  type: "execute_result";
  requestId: string;
  success: boolean;
  error?: string;
}

export interface StateChangedMessage {
  type: "state_changed";
  entityId: string;
  property: PropertyName;
  state: Record<string, unknown>;
  previousState?: Record<string, unknown>;
}

export interface PongMessage {
  type: "pong";
  requestId: string;
}

export interface ErrorMessage {
  type: "error";
  requestId?: string;
  message: string;
}

export interface LogMessage {
  type: "log";
  level: "debug" | "info" | "warn" | "error";
  message: string;
}

export interface DiscoverResultMessage {
  type: "discover_result";
  requestId: string;
  gateways: Array<{ id: string; name: string; address: string; metadata?: Record<string, unknown> }>;
  message?: string;
}

export interface PairResultMessage {
  type: "pair_result";
  requestId: string;
  success: boolean;
  credentials?: Record<string, unknown>;
  error?: string;
  message?: string;
}

export interface QueryResultMessage {
  type: "query_result";
  requestId: string;
  items: Record<string, unknown>[];
  total?: number;
  truncated?: boolean;
}

export type ChildMessage =
  | ReadyMessage
  | ObserveResultMessage
  | ExecuteResultMessage
  | StateChangedMessage
  | PongMessage
  | ErrorMessage
  | LogMessage
  | DiscoverResultMessage
  | PairResultMessage
  | QueryResultMessage;
