import { EventEmitter } from "events";
import type {
  AgentActivity,
  DeviceEvent,
  DeviceCommand,
  ReflexRule,
  PendingApproval,
  Schedule,
  TurnTrigger,
  TriageLane,
} from "@holms/shared";

export interface EventBusEvents {
  "device:event": (event: DeviceEvent) => void;
  "agent:thinking": (data: {
    prompt: string;
    timestamp: number;
  }) => void;
  "agent:tool_use": (data: {
    tool: string;
    input: unknown;
    timestamp: number;
  }) => void;
  "agent:result": (data: {
    result: string;
    summary?: string | null;
    model?: string;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    durationMs: number;
    durationApiMs: number;
    numTurns: number;
    totalCostUsd: number;
    timestamp: number;
  }) => void;
  "reflex:triggered": (data: {
    rule: ReflexRule;
    event: DeviceEvent;
    action: DeviceCommand;
  }) => void;
  "chat:response": (data: { message: string; timestamp: number }) => void;
  "approval:pending": (data: PendingApproval) => void;
  "approval:resolved": (data: {
    id: string;
    approved: boolean;
    reason?: string;
    deviceId: string;
    command: string;
    params: Record<string, unknown>;
    actionReason?: string;
  }) => void;
  "agent:outcome": (data: {
    action: string;
    feedback: string;
    timestamp: number;
  }) => void;
  "agent:reflection": (data: {
    insight: string;
    timestamp: number;
  }) => void;
  "deep_reason:start": (data: {
    problem: string;
    model: string;
    timestamp: number;
  }) => void;
  "deep_reason:result": (data: {
    problem: string;
    analysis: string;
    model: string;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    durationMs: number;
    durationApiMs: number;
    numTurns: number;
    totalCostUsd: number;
    timestamp: number;
  }) => void;
  "agent:turn_start": (data: {
    turnId: string;
    trigger: TurnTrigger;
    summary: string;
    model?: string;
    timestamp: number;
  }) => void;
  "schedule:fired": (data: { schedule: Schedule; timestamp: number }) => void;
  "chat:token": (data: {
    token: string;
    messageId: string;
    timestamp: number;
  }) => void;
  "chat:stream_end": (data: {
    messageId: string;
    content: string;
    reasoning?: string;
    timestamp: number;
  }) => void;
  "agent:triage_classify": (data: {
    deviceId: string;
    eventType: string;
    lane: TriageLane;
    ruleId: string | null;
    reason: string;
    deviceName?: string;
    room?: string;
    timestamp: number;
  }) => void;
  "agent:triage_batch": (data: {
    eventCount: number;
    timestamp: number;
  }) => void;
  "activity:stored": (activity: AgentActivity) => void;
}

export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  on<K extends keyof EventBusEvents>(
    event: K,
    listener: EventBusEvents[K],
  ): void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
  }

  off<K extends keyof EventBusEvents>(
    event: K,
    listener: EventBusEvents[K],
  ): void {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  emit<K extends keyof EventBusEvents>(
    event: K,
    ...args: Parameters<EventBusEvents[K]>
  ): void {
    this.emitter.emit(event, ...args);
  }
}
