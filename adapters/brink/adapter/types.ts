// ── Adapter Config ─────────────────────────────────────────────────────────

export interface BrinkAdapterConfig {
  username?: string;
  password?: string;
  systemId?: number;
  gatewayId?: number;
  pollInterval?: number; // seconds, default 60, minimum 30
}

// ── Brink API Responses ────────────────────────────────────────────────────

export interface BrinkSystem {
  id: number;
  gatewayId: number;
  name: string;
}

export interface ParameterDescriptor {
  uiId: string;
  name: string;
  valueId: number;
  value: number;
  description: string;
  isReadOnly: boolean;
  minValue?: number;
  maxValue?: number;
  stepSize?: number;
}

export interface MenuPage {
  parameterDescriptors?: ParameterDescriptor[];
}

export interface MenuItem {
  description: string;
  menuItems?: MenuItem[];
  pages?: MenuPage[];
  parameterDescriptors?: ParameterDescriptor[];
}

export interface AppGuiDescription {
  menuItems: MenuItem[];
}

export interface WriteParameter {
  ValueId: number;
  Value: string;
}

// ── State Mapping Constants ────────────────────────────────────────────────

/** Maps API Lüftungsstufe value → reported fan_speed level (0=standby, 1=low, 2=medium, 3=high) */
export const FAN_SPEED_MAP: Record<number, number> = {
  0: 0,
  1: 1,
  2: 2,
  3: 3,
};

export const MODE_MAP: Record<number, string> = {
  0: "auto",
  1: "manual",
  2: "holiday",
  3: "party",
  4: "night",
};

export const BYPASS_MAP: Record<number, string> = {
  0: "init",
  1: "opening",
  2: "closing",
  3: "open",
  4: "closed",
  255: "unknown",
};

/**
 * Known German keywords used to match parameters across firmware versions.
 * The API uses `uiId` for most parameters and `name` for some (e.g. bypass).
 * We check both fields against these keywords.
 */
export const PARAM_KEYWORDS = {
  fanSpeed: ["Lüftungsstufe", "lüftungsstufe", "Luftungsstufe"],
  mode: ["Betriebsart", "betriebsart"],
  filterAlarm: ["Filtermeldung", "filtermeldung", "Filter", "Status Filtermeldung"],
  bypass: ["Bypassklappe", "bypassklappe", "Bypass", "Status Bypassklappe"],
} as const;
