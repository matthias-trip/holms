// ── Hue V2 API Resource Types ───────────────────────────────────────────────

export interface HueAdapterConfig {
  bridge_ip: string;
  api_key: string;
  entity_mode?: "devices" | "rooms";
}

// ── Common ──────────────────────────────────────────────────────────────────

export interface HueResourceRef {
  rid: string;
  rtype: string;
}

export interface HueOwner {
  rid: string;
  rtype: string;
}

// ── Light ───────────────────────────────────────────────────────────────────

export interface HueLight {
  id: string;
  owner: HueOwner;
  on: { on: boolean };
  dimming?: { brightness: number; min_dim_level?: number };
  color_temperature?: { mirek: number | null; mirek_valid: boolean; mirek_schema?: { mirek_minimum: number; mirek_maximum: number } };
  color?: { xy: { x: number; y: number }; gamut_type?: string };
  dynamics?: { status: string; speed: number };
  mode?: string;
  type: "light";
}

// ── Grouped Light (room-level) ──────────────────────────────────────────────

export interface HueGroupedLight {
  id: string;
  owner: HueOwner;
  on: { on: boolean };
  dimming?: { brightness: number; min_dim_level?: number };
  color_temperature?: { mirek: number | null; mirek_valid: boolean; mirek_schema?: { mirek_minimum: number; mirek_maximum: number } };
  color?: { xy: { x: number; y: number }; gamut_type?: string };
  type: "grouped_light";
}

// ── Motion Sensor ───────────────────────────────────────────────────────────

export interface HueMotion {
  id: string;
  owner: HueOwner;
  enabled: boolean;
  motion: { motion: boolean; motion_valid: boolean; motion_report?: { changed: string; motion: boolean } };
  type: "motion";
}

// ── Temperature Sensor ──────────────────────────────────────────────────────

export interface HueTemperature {
  id: string;
  owner: HueOwner;
  enabled: boolean;
  temperature: { temperature: number; temperature_valid: boolean; temperature_report?: { changed: string; temperature: number } };
  type: "temperature";
}

// ── Light Level Sensor ──────────────────────────────────────────────────────

export interface HueLightLevel {
  id: string;
  owner: HueOwner;
  enabled: boolean;
  light: { light_level: number; light_level_valid: boolean; light_level_report?: { changed: string; light_level: number } };
  type: "light_level";
}

// ── Contact Sensor ──────────────────────────────────────────────────────────

export interface HueContact {
  id: string;
  owner: HueOwner;
  enabled: boolean;
  contact_report: { state: "contact" | "no_contact"; changed: string } | null;
  type: "contact";
}

// ── Device ──────────────────────────────────────────────────────────────────

export interface HueDevice {
  id: string;
  product_data: {
    model_id: string;
    manufacturer_name: string;
    product_name: string;
    product_archetype: string;
    certified: boolean;
    software_version: string;
  };
  metadata: { name: string; archetype: string };
  services: HueResourceRef[];
  type: "device";
}

// ── Room / Zone ─────────────────────────────────────────────────────────────

export interface HueRoom {
  id: string;
  metadata: { name: string; archetype: string };
  children: HueResourceRef[];
  services: HueResourceRef[];
  type: "room";
}

export interface HueZone {
  id: string;
  metadata: { name: string; archetype: string };
  children: HueResourceRef[];
  services: HueResourceRef[];
  type: "zone";
}

// ── Scene ───────────────────────────────────────────────────────────────────

export interface HueScene {
  id: string;
  metadata: { name: string; image?: HueResourceRef };
  group: HueResourceRef;
  actions: Array<{
    target: HueResourceRef;
    action: Record<string, unknown>;
  }>;
  type: "scene";
}

// ── SSE Event ───────────────────────────────────────────────────────────────

export interface HueSSEEvent {
  creationtime: string;
  data: Array<{
    id: string;
    type: string;
    [key: string]: unknown;
  }>;
  id: string;
  type: "update" | "add" | "delete";
}

// ── API Response Wrapper ────────────────────────────────────────────────────

export interface HueApiResponse<T> {
  errors: Array<{ description: string }>;
  data: T[];
}

// ── Discovery ───────────────────────────────────────────────────────────────

export interface DiscoveredBridge {
  ip: string;
  name: string;
  id: string;
}

export interface PairResult {
  api_key: string;
  client_key: string;
}
