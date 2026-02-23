import { EventEmitter } from "events";
import type {
  AgentActivity,
  DeviceEvent,
  DeviceCommand,
  ReflexRule,
  PendingApproval,
  Automation,
  TurnTrigger,
  TriageLane,
  ChannelStatus,
} from "@holms/shared";

export interface EventBusEvents {
  "device:event": (event: DeviceEvent) => void;
  "agent:thinking": (data: {
    prompt: string;
    turnId?: string;
    timestamp: number;
  }) => void;
  "agent:tool_use": (data: {
    tool: string;
    input: unknown;
    turnId?: string;
    timestamp: number;
  }) => void;
  "agent:result": (data: {
    result: string;
    summary?: string;
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
    turnId?: string;
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
    turnId?: string;
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
    turnId?: string;
    timestamp: number;
  }) => void;
  "agent:turn_start": (data: {
    turnId: string;
    trigger: TurnTrigger;
    proactiveType?: string;
    model?: string;
    channel?: string;
    channelDisplayName?: string;
    coordinatorType?: string;
    timestamp: number;
  }) => void;
  "automation:time_fired": (data: { automation: Automation; timestamp: number }) => void;
  "automation:event_fired": (data: {
    automation: Automation;
    event: DeviceEvent;
    timestamp: number;
  }) => void;
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
    area?: string;
    timestamp: number;
  }) => void;
  "agent:triage_batch": (data: {
    eventCount: number;
    timestamp: number;
  }) => void;
  "channel:status_changed": (data: {
    providerId: string;
    status: ChannelStatus;
    message?: string;
    timestamp: number;
  }) => void;
  "chat:status": (data: {
    messageId: string;
    status: string;
    timestamp: number;
  }) => void;
  "chat:message_feedback": (data: {
    messageId: string;
    sentiment: "positive" | "negative";
    comment?: string;
    timestamp: number;
  }) => void;
  "chat:message_feedback_response": (data: {
    messageId: string;
    response: string;
    timestamp: number;
  }) => void;
  "history:flush": (data: {
    rowCount: number;
    entityCount: number;
    bufferSize: number;
    timestamp: number;
  }) => void;
  "history:entity_discovered": (data: {
    entityId: string;
    friendlyName: string;
    domain: string;
    area: string;
    valueType: string;
    timestamp: number;
  }) => void;
  "analyze_history:start": (data: {
    question: string;
    model: string;
    turnId?: string;
    timestamp: number;
  }) => void;
  "analyze_history:result": (data: {
    question: string;
    analysis: string;
    model: string;
    durationMs: number;
    turnId?: string;
    timestamp: number;
  }) => void;
  "history:import_progress": (data: {
    deviceId: string;
    phase: string;
    processed: number;
    total: number;
    message?: string;
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
