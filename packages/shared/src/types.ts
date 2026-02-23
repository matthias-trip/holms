// ── Device Types ──

// Open domain system — known domains + extensible via string
export type DeviceDomain =
  | "light" | "switch" | "climate" | "cover" | "lock"
  | "sensor" | "binary_sensor" | "media_player" | "camera"
  | "fan" | "vacuum" | "scene" | "button" | "number"
  | "select" | "siren" | "valve" | "water_heater"
  | "alarm_control_panel" | "humidifier" | "lawn_mower"
  | "remote" | "calendar" | "device_tracker" | "person"
  | "weather" | "update" | "event" | "image" | "sun"
  | "zone" | "text" | "date" | "datetime" | "time" | "todo"
  | (string & {}); // extensible — custom domains still work

export interface ParamDescriptor {
  name: string;
  type: "number" | "string" | "boolean" | "enum";
  required: boolean;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: string[];
  default?: unknown;
}

export interface CapabilityDescriptor {
  name: string;
  description: string;
  params: ParamDescriptor[];
}

export interface DeviceArea {
  id: string;
  name: string;
  floor?: string;
}

export interface DeviceAvailability {
  online: boolean;
  lastSeen: number;
  source: string;
}

export interface DeviceMetadata {
  manufacturer?: string;
  model?: string;
  swVersion?: string;
  viaDevice?: string;
}

export interface Device {
  id: string;
  name: string;
  domain: DeviceDomain;
  area: DeviceArea;
  state: Record<string, unknown>;
  capabilities: CapabilityDescriptor[];
  dataQueries?: DataQueryDescriptor[];
  availability: DeviceAvailability;
  metadata?: DeviceMetadata;
  attributes?: Record<string, unknown>;
}

export interface DeviceEvent {
  deviceId: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
  domain?: DeviceDomain;
  area?: string;
  previousState?: Record<string, unknown>;
}

export interface DataQueryDescriptor {
  name: string;
  description: string;
  params: ParamDescriptor[];
}

export interface DataQueryResult {
  success: boolean;
  data?: unknown;
  mimeType?: string;   // for binary data like camera images
  error?: string;
}

export interface DeviceCommand {
  deviceId: string;
  command: string;
  params: Record<string, unknown>;
}

export interface CommandResult {
  success: boolean;
  error?: string;
  newState?: Record<string, unknown>;
}

// ── Memory Types ──

export interface Memory {
  id: number;
  content: string;
  retrievalCues: string;
  tags: string[];
  entityId?: string;
  personId?: string;
  pinned: boolean;
  scope?: string;  // null/undefined = global (household), conversation ID = per-user
  createdAt: number;
  updatedAt: number;
}

export interface ScoredMemory extends Memory {
  similarity: number; // 0–1 cosine similarity, present only for semantic queries
}

export interface MemoryQueryMeta {
  totalMatches: number;
  ageRangeMs: [number, number];
  highSimilarityCluster: boolean;
}

export interface MemoryReflectStats {
  totalCount: number;
  countsByTag: Record<string, number>;
  ageDistribution: { bucket: string; count: number }[];
  similarClusters: { size: number; sample: string }[];
  recentGrowthRate: number;
}

// ── Goal Types ──

export type GoalStatus = "active" | "paused" | "completed" | "abandoned";
export type GoalEventType = "observation" | "action" | "milestone" | "status_change" | "attention" | "user_note";

export interface Goal {
  id: string;
  title: string;
  description: string;
  summary?: string;
  nextSteps?: string;
  status: GoalStatus;
  needsAttention: boolean;
  attentionReason?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface GoalEvent {
  id: number;
  goalId: string;
  type: GoalEventType;
  content: string;
  timestamp: number;
}

export interface GoalWithEvents extends Goal {
  events: GoalEvent[];
}

// ── Automation Types ──

export type AutomationRecurrence = "once" | "daily" | "weekdays" | "weekends" | "weekly";

export interface TimeTrigger {
  type: "time";
  hour: number;           // 0-23
  minute: number;         // 0-59
  recurrence: AutomationRecurrence;
  dayOfWeek: number | null;
}

export interface DeviceEventTrigger {
  type: "device_event";
  deviceId: string;
  eventType?: string;     // e.g. "motion_detected", "state_changed"
  condition?: Record<string, unknown>; // optional data field matching
}

export interface StateThresholdTrigger {
  type: "state_threshold";
  deviceId: string;
  stateKey: string;       // e.g. "currentTemp"
  operator: "gt" | "lt" | "eq" | "gte" | "lte";
  value: number;
}

export type AutomationTrigger = TimeTrigger | DeviceEventTrigger | StateThresholdTrigger;

export interface AutomationDisplay {
  conditions?: string[];  // ["Someone is home", "After sunset"]
  actions?: string[];     // ["Dim living room to 20%", "Check weather forecast"]
}

export interface Automation {
  id: string;
  summary: string;
  instruction: string;
  trigger: AutomationTrigger;
  display?: AutomationDisplay;
  enabled: boolean;
  createdAt: number;
  lastFiredAt: number | null;
  nextFireAt: number | null;  // null for non-time triggers
  channel: string | null;
}

// ── Reflex Types ──

export interface ReflexTrigger {
  deviceId?: string;
  eventType?: string;
  condition?: Record<string, unknown>;
  automationId?: string;
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
  message: string;
  approveLabel: string;
  rejectLabel: string;
  createdAt: number;
  status: ApprovalStatus;
}

// ── Chat Types ──

export type ChatMessageStatus =
  | "thinking"
  | "approval_pending"
  | "approval_resolved"
  | null;

export interface ChatMessageFeedback {
  sentiment: "positive" | "negative";
  comment?: string;
  response?: string;  // agent's reflection after processing feedback
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  status?: ChatMessageStatus;
  approvalId?: string;
  channel?: string;
  feedback?: ChatMessageFeedback;
}

/** JSON shape stored in content when status is approval_pending or approval_resolved */
export interface ApprovalMessageData {
  approvalId: string;
  deviceId: string;
  command: string;
  params: Record<string, unknown>;
  reason: string;
  message?: string;
  approveLabel?: string;
  rejectLabel?: string;
  resolved?: { approved: boolean };
}

// ── Device Provider Types ──

export type DeviceProviderStatus = "connected" | "disconnected" | "error" | "unconfigured";

export interface DeviceProviderInfo {
  id: string;
  displayName: string;
  description: string;
  enabled: boolean;
  status: DeviceProviderStatus;
  statusMessage?: string;
  configSchema: ChannelConfigField[];   // reuse same config field shape
  config: Record<string, unknown>;      // masked passwords
  deviceCount: number;
  origin: "builtin" | "plugin";
}

// ── Channel Types ──

export type ChannelStatus = "connected" | "disconnected" | "error" | "unconfigured" | "pairing";

export interface ChannelCapabilities {
  multiConversation: boolean;
  approvalButtons: boolean;
  richFormatting: boolean;
  threads: boolean;
  reactions: boolean;
  fileUpload: boolean;
}

export interface ChannelConfigField {
  key: string;
  label: string;
  type: "string" | "password" | "boolean" | "number";
  required: boolean;
  placeholder?: string;
  description?: string;
}

export interface ChannelProviderInfo {
  id: string;
  displayName: string;
  description: string;
  enabled: boolean;
  status: ChannelStatus;
  statusMessage?: string;
  capabilities: ChannelCapabilities;
  configSchema: ChannelConfigField[];
  config: Record<string, unknown>;
  origin: "builtin" | "plugin";
}

export interface ChannelRoute {
  id: string;
  eventType: "approval" | "device_event" | "broadcast";
  channelId: string;
  enabled: boolean;
  createdAt: number;
}

export interface ChannelConversationInfo {
  id: string;
  providerId: string;
  providerName: string;
  displayName: string;
  topic?: string;
}

// ── People Types ──

export interface PersonChannel {
  channelId: string;
  senderId?: string;
}

export interface Person {
  id: string;
  name: string;
  primaryChannel?: string;
  channels: PersonChannel[];
  createdAt: number;
  updatedAt: number;
}

// ── Agent Activity Types ──

export type AgentActivityType =
  | "thinking" | "tool_use" | "result" | "reflection" | "outcome"
  | "turn_start"
  | "deep_reason_start" | "deep_reason_result"
  | "approval_pending" | "approval_resolved"
  | "reflex_fired"
  | "triage"
  | "triage_classify"
  | "automation_event_fired"
  | "cycle_feedback"
  | "cycle_feedback_response"
  | "history_flush"
  | "history_entity_discovered"
  | "history_import"
  | "analyze_history_start"
  | "analyze_history_result";

export interface AgentActivity {
  id: string;
  type: AgentActivityType;
  data: Record<string, unknown>;
  timestamp: number;
  agentId?: string;
  turnId?: string;
}

// ── Turn / Agent Status Types ──

export type TurnTrigger = "user_message" | "device_events" | "automation" | "proactive" | "approval_result" | "outcome_feedback" | "suggestions" | "onboarding";

export interface AgentStatus {
  agentId: string;
  name: string;
  role: "coordinator";
  description: string;
  processing: boolean;
}

// ── Triage Types ──

export type TriageLane = "immediate" | "batched" | "silent";

export interface TriageCondition {
  deviceId?: string;
  deviceDomain?: DeviceDomain;
  eventType?: string;
  area?: string;
  deltaThreshold?: number;
}

export interface TriageRule {
  id: string;
  condition: TriageCondition;
  lane: TriageLane;
  holdMinutes?: number;
  reason: string;
  createdBy: string;
  createdAt: number;
  enabled: boolean;
}

// ── Plugin Types ──

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  author?: string;
  path: string;
  enabled: boolean;
  capabilities: string[];
  installed: boolean;
  origin: "builtin" | "user";
}

// ── Event Types for the bus ──

export interface BusEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}
