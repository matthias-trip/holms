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
  createdAt: number;
  updatedAt: number;
}

// ── Reflex Types ──

export interface ReflexTrigger {
  deviceId?: string;
  eventType?: string;
  condition?: Record<string, unknown>;
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
  confidence: ConfidenceLevel;
  category: ActionCategory;
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

export type AgentActivityType = "thinking" | "tool_use" | "result" | "reflection" | "outcome";

export interface AgentActivity {
  id: string;
  type: AgentActivityType;
  data: Record<string, unknown>;
  timestamp: number;
}

// ── Event Types for the bus ──

export interface BusEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}
