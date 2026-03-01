import type { CommandFieldDef } from "@holms/adapter-sdk";

// ── Property Names ──────────────────────────────────────────────────────────

export type PropertyName =
  | "illumination"
  | "climate"
  | "occupancy"
  | "access"
  | "media"
  | "power"
  | "water"
  | "safety"
  | "air_quality"
  | "schedule"
  | "weather";

// ── Query Result ──────────────────────────────────────────────────────────

export interface QueryResult {
  items: Record<string, unknown>[];
  total?: number;
  truncated?: boolean;
}

// ── Space Model ─────────────────────────────────────────────────────────────

export interface Space {
  id: string;
  displayName: string;
  floor?: string;
  sources: Source[];
}

export interface Source {
  id: string;
  spaceId: string;
  adapterId: string;
  entityId: string;
  properties: SourceProperty[];
  reachable: boolean;
}

export interface SourceProperty {
  sourceId: string;
  property: PropertyName;
  role: string;
  mounting?: string;
  features: string[];
  commandHints?: Record<string, CommandFieldDef>;
}

// ── Routing ─────────────────────────────────────────────────────────────────

export interface SourceRoute {
  sourceId: string;
  adapterId: string;
  entityId: string;
}

// ── Observe Result ──────────────────────────────────────────────────────────

export interface ObserveResult {
  spaces: SpaceObservation[];
}

export interface SpaceObservation {
  space: string;
  properties: PropertyObservation[];
}

export interface PropertyObservation {
  property: PropertyName;
  sources: SourceObservation[];
}

export interface SourceObservation {
  source: string;
  adapterId?: string;
  role: string;
  mounting?: string;
  features: string[];
  reachable: boolean;
  state: Record<string, unknown>;
  cached?: boolean;
}

// ── Influence Result ────────────────────────────────────────────────────────

export interface InfluenceResult {
  results: InfluenceSourceResult[];
}

export interface InfluenceSourceResult {
  source: string;
  success: boolean;
  error?: string;
}

// ── Capabilities Result ─────────────────────────────────────────────────────

export interface CapabilitiesResult {
  spaces: SpaceCapability[];
}

export interface SpaceCapability {
  space: string;
  displayName: string;
  floor?: string;
  properties: PropertyCapability[];
}

export interface PropertyCapability {
  property: PropertyName;
  sources: SourceCapability[];
}

export interface SourceCapability {
  source: string;
  role: string;
  mounting?: string;
  features: string[];
  reachable: boolean;
  commandHints?: Record<string, CommandFieldDef>;
}

// ── Events ──────────────────────────────────────────────────────────────────

export interface HabitatEvent {
  space: string;
  source: string;
  property: PropertyName;
  state: Record<string, unknown>;
  previousState?: Record<string, unknown>;
  timestamp: number;
}

// ── Adapter Config (DB rows) ────────────────────────────────────────────────

export interface AdapterConfig {
  id: string;
  type: string;
  displayName?: string;
  config: Record<string, unknown>;
}

export interface SpaceConfig {
  id: string;
  displayName: string;
  floor?: string;
}

export interface SourceConfig {
  id: string;
  spaceId: string;
  adapterId: string;
  entityId: string;
}

export interface SourcePropertyConfig {
  sourceId: string;
  property: PropertyName;
  role: string;
  mounting?: string;
  features: string[];
}

// ── Adapter Health ──────────────────────────────────────────────────────────

export interface AdapterHealth {
  id: string;
  type: string;
  status: "running" | "stopped" | "restarting" | "crashed";
  entityCount: number;
  lastPing?: number;
  restartCount: number;
  pid?: number;
}
