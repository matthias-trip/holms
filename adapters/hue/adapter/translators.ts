import type { PropertyName, EntityRegistration } from "@holms/adapter-sdk";
import type {
  HueLight,
  HueGroupedLight,
  HueMotion,
  HueTemperature,
  HueLightLevel,
  HueContact,
  HueDevice,
  HueRoom,
  HueResourceRef,
} from "./types.js";

// ── Hue → Habitat State ────────────────────────────────────────────────────

export function lightToIllumination(light: HueLight): Record<string, unknown> {
  const state: Record<string, unknown> = { on: light.on.on };
  if (light.dimming) {
    state.brightness = light.dimming.brightness;
  }
  if (light.color_temperature?.mirek != null) {
    state.color_temp = light.color_temperature.mirek;
  }
  if (light.color?.xy) {
    const { h, s } = xyToHs(light.color.xy.x, light.color.xy.y);
    state.color = { h, s };
  }
  return state;
}

export function motionToOccupancy(motion: HueMotion): Record<string, unknown> {
  return {
    occupied: motion.motion.motion,
    last_motion: motion.motion.motion_report?.changed ?? null,
  };
}

export function temperatureToClimate(temp: HueTemperature): Record<string, unknown> {
  return { current_temp: temp.temperature.temperature };
}

export function lightLevelToIllumination(ll: HueLightLevel): Record<string, unknown> {
  // Hue encodes light level as 10000 * log10(lux) + 1
  const lux = Math.pow(10, (ll.light.light_level - 1) / 10_000);
  return { lux: Math.round(lux * 100) / 100 };
}

export function contactToAccess(contact: HueContact): Record<string, unknown> {
  return {
    open: contact.contact_report?.state === "no_contact",
  };
}

export function smartPlugToPower(light: HueLight): Record<string, unknown> {
  return { on: light.on.on };
}

// ── Habitat → Hue Command ──────────────────────────────────────────────────

export function illuminationToLightPut(cmd: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if ("on" in cmd && typeof cmd.on === "boolean") {
    body.on = { on: cmd.on };
  }
  if ("brightness" in cmd && typeof cmd.brightness === "number") {
    body.dimming = { brightness: cmd.brightness };
  }
  if ("color_temp" in cmd && typeof cmd.color_temp === "number") {
    body.color_temperature = { mirek: cmd.color_temp };
  }
  if (cmd.color && typeof cmd.color === "object" && "h" in (cmd.color as object) && "s" in (cmd.color as object)) {
    const { h, s } = cmd.color as { h: number; s: number };
    const xy = hsToXy(h, s);
    body.color = { xy };
  }
  if ("transition" in cmd && typeof cmd.transition === "number") {
    body.dynamics = { duration: cmd.transition };
  }
  // Scene activation via special field
  if ("scene" in cmd && typeof cmd.scene === "string") {
    return { __scene: cmd.scene };
  }

  return body;
}

export function powerToSmartPlugPut(cmd: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if ("on" in cmd && typeof cmd.on === "boolean") {
    body.on = { on: cmd.on };
  }
  return body;
}

// ── Color Conversion ────────────────────────────────────────────────────────

/**
 * CIE xy → HS (hue 0–360, saturation 0–100).
 * Approximate conversion via XYZ → sRGB → HSV.
 */
export function xyToHs(x: number, y: number): { h: number; s: number } {
  const z = 1.0 - x - y;
  const Y = 1.0; // normalized brightness
  const X = (Y / y) * x;
  const Z = (Y / y) * z;

  // XYZ → linear sRGB
  let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
  let b = X * 0.051713 - Y * 0.121364 + Z * 1.011530;

  // Clamp negatives
  const maxVal = Math.max(r, g, b, 0.0001);
  if (maxVal > 1) { r /= maxVal; g /= maxVal; b /= maxVal; }
  r = Math.max(0, r);
  g = Math.max(0, g);
  b = Math.max(0, b);

  // Gamma correction
  r = r <= 0.0031308 ? 12.92 * r : 1.055 * Math.pow(r, 1.0 / 2.4) - 0.055;
  g = g <= 0.0031308 ? 12.92 * g : 1.055 * Math.pow(g, 1.0 / 2.4) - 0.055;
  b = b <= 0.0031308 ? 12.92 * b : 1.055 * Math.pow(b, 1.0 / 2.4) - 0.055;

  // RGB → HSV
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : (delta / max) * 100;

  return { h: Math.round(h), s: Math.round(s) };
}

/**
 * HS (hue 0–360, saturation 0–100) → CIE xy.
 * Approximate conversion via HSV → sRGB → XYZ → xy.
 */
export function hsToXy(h: number, s: number): { x: number; y: number } {
  const sat = s / 100;
  const v = 1.0;
  const c = v * sat;
  const hPrime = h / 60;
  const xComp = c * (1 - Math.abs((hPrime % 2) - 1));

  let r = 0, g = 0, b = 0;
  if (hPrime < 1) { r = c; g = xComp; }
  else if (hPrime < 2) { r = xComp; g = c; }
  else if (hPrime < 3) { g = c; b = xComp; }
  else if (hPrime < 4) { g = xComp; b = c; }
  else if (hPrime < 5) { r = xComp; b = c; }
  else { r = c; b = xComp; }

  const m = v - c;
  r += m; g += m; b += m;

  // Reverse gamma
  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

  // sRGB → XYZ (Wide RGB D65 matrix)
  const X = r * 0.664511 + g * 0.154324 + b * 0.162028;
  const Y = r * 0.283881 + g * 0.668433 + b * 0.047685;
  const Z = r * 0.000088 + g * 0.072310 + b * 0.986039;

  const sum = X + Y + Z;
  if (sum === 0) return { x: 0.3127, y: 0.3290 }; // D65 white point

  return {
    x: Math.round((X / sum) * 10000) / 10000,
    y: Math.round((Y / sum) * 10000) / 10000,
  };
}

// ── Device Classification ───────────────────────────────────────────────────

const SMART_PLUG_ARCHETYPES = new Set([
  "plug", "hue_signe_table", "hue_smart_plug",
]);

export interface ClassifiedEntity {
  entityId: string;
  properties: Array<{ property: PropertyName; features: string[] }>;
  /** Hue room/zone ID for grouping suggestions */
  roomId?: string;
}

export interface ServiceLookup {
  lights: Map<string, HueLight>;
  motions: Map<string, HueMotion>;
  temperatures: Map<string, HueTemperature>;
  lightLevels: Map<string, HueLightLevel>;
  contacts: Map<string, HueContact>;
}

/**
 * Classify a Hue device into Habitat entity properties based on its services.
 * Returns null for devices with no mappable services (e.g. button-only devices).
 */
export function classifyDevice(
  device: HueDevice,
  services: ServiceLookup,
  roomMap: Map<string, string>, // deviceId → roomId
): ClassifiedEntity | null {
  const properties: Array<{ property: PropertyName; features: string[] }> = [];
  const isSmartPlug = SMART_PLUG_ARCHETYPES.has(device.product_data.product_archetype);

  for (const svc of device.services) {
    classifyService(svc, services, isSmartPlug, properties);
  }

  if (properties.length === 0) return null;

  return {
    entityId: device.id,
    properties,
    roomId: roomMap.get(device.id),
  };
}

function classifyService(
  svc: HueResourceRef,
  services: ServiceLookup,
  isSmartPlug: boolean,
  properties: Array<{ property: PropertyName; features: string[] }>,
): void {
  switch (svc.rtype) {
    case "light": {
      const light = services.lights.get(svc.rid);
      if (!light) break;

      if (isSmartPlug) {
        properties.push({ property: "power", features: ["switch"] });
      } else {
        const features: string[] = ["dimmable"];
        if (light.color_temperature) features.push("color_temp");
        if (light.color) features.push("color");
        properties.push({ property: "illumination", features });
      }
      break;
    }
    case "motion": {
      if (services.motions.has(svc.rid)) {
        properties.push({ property: "occupancy", features: ["motion"] });
      }
      break;
    }
    case "temperature": {
      if (services.temperatures.has(svc.rid)) {
        properties.push({ property: "climate", features: [] });
      }
      break;
    }
    case "light_level": {
      if (services.lightLevels.has(svc.rid)) {
        properties.push({ property: "illumination", features: ["ambient_sensing"] });
      }
      break;
    }
    case "contact": {
      if (services.contacts.has(svc.rid)) {
        properties.push({ property: "access", features: ["contact"] });
      }
      break;
    }
    // button, zigbee_connectivity, device_power, etc. — skip
  }
}

/**
 * Build a device → room mapping from Hue rooms.
 * Each room's children reference devices; map those device IDs to the room ID.
 */
export function buildRoomMap(
  rooms: Array<{ id: string; children: HueResourceRef[] }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const room of rooms) {
    for (const child of room.children) {
      if (child.rtype === "device") {
        map.set(child.rid, room.id);
      }
    }
  }
  return map;
}

/**
 * Build the service lookup maps from fetched resources.
 */
export function buildServiceLookup(
  lights: HueLight[],
  motions: HueMotion[],
  temperatures: HueTemperature[],
  lightLevels: HueLightLevel[],
  contacts: HueContact[],
): ServiceLookup {
  return {
    lights: new Map(lights.map((l) => [l.id, l])),
    motions: new Map(motions.map((m) => [m.id, m])),
    temperatures: new Map(temperatures.map((t) => [t.id, t])),
    lightLevels: new Map(lightLevels.map((ll) => [ll.id, ll])),
    contacts: new Map(contacts.map((c) => [c.id, c])),
  };
}

// ── Room Classification (rooms mode) ──────────────────────────────────────

/**
 * Classify a Hue room as a Habitat entity using its grouped_light service.
 * Also picks up sensor properties from devices that belong to the room.
 */
export function classifyRoom(
  room: HueRoom,
  groupedLight: HueGroupedLight | undefined,
  services: ServiceLookup,
  devices: HueDevice[],
): ClassifiedEntity | null {
  const properties: Array<{ property: PropertyName; features: string[] }> = [];

  // Illumination from grouped_light
  if (groupedLight) {
    const features: string[] = ["dimmable"];
    if (groupedLight.color_temperature) features.push("color_temp");
    if (groupedLight.color) features.push("color");
    properties.push({ property: "illumination", features });
  }

  // Collect device IDs in this room
  const roomDeviceIds = new Set(
    room.children.filter((c) => c.rtype === "device").map((c) => c.rid),
  );

  // Add sensor properties from devices in the room
  for (const device of devices) {
    if (!roomDeviceIds.has(device.id)) continue;
    for (const svc of device.services) {
      switch (svc.rtype) {
        case "motion":
          if (services.motions.has(svc.rid)) {
            properties.push({ property: "occupancy", features: ["motion"] });
          }
          break;
        case "temperature":
          if (services.temperatures.has(svc.rid)) {
            properties.push({ property: "climate", features: [] });
          }
          break;
        case "light_level":
          if (services.lightLevels.has(svc.rid)) {
            properties.push({ property: "illumination", features: ["ambient_sensing"] });
          }
          break;
        case "contact":
          if (services.contacts.has(svc.rid)) {
            properties.push({ property: "access", features: ["contact"] });
          }
          break;
      }
    }
  }

  if (properties.length === 0) return null;

  return { entityId: room.id, properties };
}
