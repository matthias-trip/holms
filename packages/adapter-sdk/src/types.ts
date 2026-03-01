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

// ── Command Field Definition ──────────────────────────────────────────────

export interface CommandFieldDef {
  type: "boolean" | "number" | "string" | "object";
  description?: string;
  values?: (number | string)[];
  min?: number;
  max?: number;
}

// ── Entity Registration ────────────────────────────────────────────────────

export interface EntityRegistration {
  entityId: string;
  displayName?: string;
  properties: Array<{
    property: PropertyName;
    features: string[];
    commandHints?: Record<string, CommandFieldDef>;
  }>;
}

// ── Entity Grouping ──────────────────────────────────────────────────────

export interface EntityGroup {
  id: string;
  name: string;
  type: "room" | "zone" | "area";
  entityIds: string[];
}

export interface RegistrationResult {
  entities: EntityRegistration[];
  groups?: EntityGroup[];
}

// ── Discover / Pair Results ─────────────────────────────────────────────

export interface DiscoverResult {
  gateways: Array<{ id: string; name: string; address: string; metadata?: Record<string, unknown> }>;
  message?: string;
}

export interface PairResult {
  success: boolean;
  credentials?: Record<string, unknown>;
  error?: string;
  message?: string;
}

// ── Query Result ──────────────────────────────────────────────────────────

export interface QueryResult {
  items: Record<string, unknown>[];
  total?: number;
  truncated?: boolean;
}

// ── Adapter Interface ──────────────────────────────────────────────────────

export interface Adapter {
  register(): Promise<RegistrationResult>;
  execute(
    entityId: string,
    property: PropertyName,
    command: Record<string, unknown>,
  ): Promise<void>;
  observe(
    entityId: string,
    property: PropertyName,
  ): Promise<Record<string, unknown>>;
  query?(
    entityId: string,
    property: PropertyName,
    params: Record<string, unknown>,
  ): Promise<QueryResult>;
  subscribe(
    cb: (
      entityId: string,
      property: PropertyName,
      state: Record<string, unknown>,
    ) => void,
  ): Promise<void>;
  ping(): Promise<boolean>;
  destroy(): Promise<void>;
  discover?(params: Record<string, unknown>): Promise<DiscoverResult>;
  pair?(params: Record<string, unknown>): Promise<PairResult>;
}

export type AdapterFactory = (config: Record<string, unknown>) => Adapter;
