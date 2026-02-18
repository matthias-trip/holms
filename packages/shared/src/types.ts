// ── Device Types ──

export type DeviceType =
  | "light"
  | "thermostat"
  | "motion_sensor"
  | "door_lock"
  | "switch"
  | "contact_sensor";

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  room: string;
  state: Record<string, unknown>;
  capabilities: string[];
}

export interface DeviceEvent {
  deviceId: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export interface DeviceCommand {
  deviceId: string;
  command: string;
  params: Record<string, unknown>;
}

// ── Memory Types ──

export type MemoryType =
  | "observation"
  | "preference"
  | "pattern"
  | "goal"
  | "reflection"
  | "plan";

export interface Memory {
  key: string;
  content: string;
  type: MemoryType;
  tags: string[];
  scope: string | null;
  createdAt: number;
  updatedAt: number;
}

// ── Specialist Types ──

export type SpecialistDomain = "lighting" | "presence" | "electricity";

export interface SpecialistProposal {
  id: string;
  specialist: SpecialistDomain;
  deviceId: string;
  command: string;
  params: Record<string, unknown>;
  confidence: ConfidenceLevel;
  category: ActionCategory;
  reason: string;
  priority: number;
  timestamp: number;
}

export interface ConflictFlag {
  specialist: SpecialistDomain;
  description: string;
  affectedDeviceIds: string[];
  suggestedResolution: string;
}

export interface SpecialistResult {
  specialist: SpecialistDomain;
  proposals: SpecialistProposal[];
  reasoning: string;
  conflicts: ConflictFlag[];
}

// ── Schedule Types ──

export type ScheduleRecurrence = "once" | "daily" | "weekdays" | "weekends" | "weekly";

export interface Schedule {
  id: string;
  instruction: string;
  hour: number;
  minute: number;
  recurrence: ScheduleRecurrence;
  dayOfWeek: number | null;
  enabled: boolean;
  createdAt: number;
  lastFiredAt: number | null;
  nextFireAt: number;
}

// ── Reflex Types ──

export interface ReflexTrigger {
  deviceId?: string;
  eventType?: string;
  condition?: Record<string, unknown>;
  scheduleId?: string;
}

export interface ReflexAction {
  deviceId: string;
  command: string;
  params: Record<string, unknown>;
}

export interface ReflexRule {
  id: string;
  trigger: ReflexTrigger;
  action: ReflexAction;
  reason: string;
  createdBy: string;
  createdAt: number;
  enabled: boolean;
}

// ── Approval Types ──

export type ConfidenceLevel = "high" | "medium" | "low";
export type ActionCategory = "routine" | "novel" | "critical";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface PendingApproval {
  id: string;
  deviceId: string;
  command: string;
  params: Record<string, unknown>;
  reason: string;
  createdAt: number;
  status: ApprovalStatus;
}

// ── Chat Types ──

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// ── Agent Activity Types ──

export type AgentActivityType =
  | "thinking" | "tool_use" | "result" | "reflection" | "outcome"
  | "turn_start"
  | "specialist_dispatched" | "specialist_result"
  | "approval_pending" | "approval_resolved"
  | "reflex_fired"
  | "triage";

export interface AgentActivity {
  id: string;
  type: AgentActivityType;
  data: Record<string, unknown>;
  timestamp: number;
  agentId?: string;
  turnId?: string;
}

// ── Turn / Agent Status Types ──

export type TurnTrigger = "user_message" | "device_events" | "schedule" | "proactive" | "approval_result" | "outcome_feedback";

export interface AgentStatus {
  agentId: string;
  name: string;
  role: "coordinator" | "specialist";
  description: string;
  processing: boolean;
}

// ── Triage Types ──

export type TriageLane = "immediate" | "batched" | "silent";

export interface TriageCondition {
  deviceId?: string;
  deviceType?: DeviceType;
  eventType?: string;
  room?: string;
  stateKey?: string;
  deltaThreshold?: number;
}

export interface TriageRule {
  id: string;
  condition: TriageCondition;
  lane: TriageLane;
  reason: string;
  createdBy: string;
  createdAt: number;
  enabled: boolean;
}

// ── Event Types for the bus ──

export interface BusEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}
