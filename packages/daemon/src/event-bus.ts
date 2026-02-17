import { EventEmitter } from "events";
import type {
  DeviceEvent,
  DeviceCommand,
  ReflexRule,
  PendingApproval,
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
    cost: number;
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
