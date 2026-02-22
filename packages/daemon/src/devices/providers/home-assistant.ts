import WebSocket from "ws";
// Polyfill WebSocket for Node.js — home-assistant-js-websocket expects a browser environment
(globalThis as any).WebSocket ??= WebSocket;

import {
  createConnection,
  createLongLivedTokenAuth,
  subscribeEntities,
  type Connection,
  type HassEntities,
  type HassEntity,
} from "home-assistant-js-websocket";
import type { Device, DeviceEvent, DeviceArea, CommandResult, DeviceDomain } from "@holms/shared";
import type { DeviceProvider } from "../types.js";
import { HAEntityFilter } from "./ha-entity-filter.js";
import { getStandardCapabilities } from "../capabilities.js";

/** Attributes we strip from fallback state — UI-only, not useful for automation */
const IGNORED_ATTRS = new Set([
  "friendly_name", "icon", "entity_picture", "supported_features",
  "device_class", "state_class", "unit_of_measurement",
]);

interface HAArea {
  area_id: string;
  name: string;
  floor_id?: string;
}

interface HAFloor {
  floor_id: string;
  name: string;
}

interface HAEntityEntry {
  entity_id: string;
  area_id?: string;
  device_id?: string;
}

interface HADeviceEntry {
  id: string;
  area_id?: string;
  name?: string;
  manufacturer?: string;
  model?: string;
  sw_version?: string;
}

// ── State Normalization ──────────────────────────────────────────────

interface NormalizedResult {
  state: Record<string, unknown>;
  attributes?: Record<string, unknown>;
}

/** Collect remaining HA attributes not already normalized into state or ignored. */
function collectExtraAttrs(
  a: Record<string, unknown>,
  extracted: Set<string>,
): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(a)) {
    if (!IGNORED_ATTRS.has(key) && !extracted.has(key)) {
      extra[key] = value;
    }
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
}

/** Normalize HA entity state into standard DAL vocabulary. */
function normalizeState(domain: string, entity: HassEntity): NormalizedResult {
  const s = entity.state;
  const a = entity.attributes;

  switch (domain) {
    case "light": {
      const extracted = new Set(["brightness", "color_temp", "hs_color", "color_mode", "effect"]);
      const state: Record<string, unknown> = { power: s === "on" ? "on" : "off" };
      if (a.brightness != null) state.brightness = Math.round((a.brightness as number) / 255 * 100);
      if (a.color_temp != null) state.colorTemp = Math.round(1_000_000 / (a.color_temp as number));
      if (Array.isArray(a.hs_color)) {
        state.hue = (a.hs_color as number[])[0];
        state.saturation = (a.hs_color as number[])[1];
      }
      if (a.color_mode != null) state.colorMode = a.color_mode;
      if (a.effect != null) state.effect = a.effect;
      return { state, attributes: collectExtraAttrs(a, extracted) };
    }

    case "switch":
      return { state: { power: s === "on" ? "on" : "off" }, attributes: collectExtraAttrs(a, new Set()) };

    case "climate": {
      const extracted = new Set([
        "current_temperature", "temperature", "target_temp_high", "target_temp_low",
        "current_humidity", "fan_mode", "preset_mode", "hvac_action",
      ]);
      const state: Record<string, unknown> = {
        mode: s,
        power: s !== "off" ? "on" : "off",
      };
      if (a.current_temperature != null) state.currentTemp = a.current_temperature;
      if (a.temperature != null) state.targetTemp = a.temperature;
      if (a.target_temp_high != null) state.targetTempHigh = a.target_temp_high;
      if (a.target_temp_low != null) state.targetTempLow = a.target_temp_low;
      if (a.current_humidity != null) state.humidity = a.current_humidity;
      if (a.fan_mode != null) state.fanMode = a.fan_mode;
      if (a.preset_mode != null) state.preset = a.preset_mode;
      if (a.hvac_action != null) state.action = a.hvac_action;
      return { state, attributes: collectExtraAttrs(a, extracted) };
    }

    case "cover": {
      const extracted = new Set(["current_position", "current_tilt_position"]);
      const state: Record<string, unknown> = { state: s };
      if (a.current_position != null) state.position = a.current_position;
      if (a.current_tilt_position != null) state.tilt = a.current_tilt_position;
      return { state, attributes: collectExtraAttrs(a, extracted) };
    }

    case "lock":
      return {
        state: { state: s, locked: s === "locked" },
        attributes: collectExtraAttrs(a, new Set()),
      };

    case "fan": {
      const extracted = new Set(["percentage", "preset_mode", "direction", "oscillating"]);
      const state: Record<string, unknown> = { power: s === "on" ? "on" : "off" };
      if (a.percentage != null) state.speed = a.percentage;
      if (a.preset_mode != null) state.preset = a.preset_mode;
      if (a.direction != null) state.direction = a.direction;
      if (a.oscillating != null) state.oscillating = a.oscillating;
      return { state, attributes: collectExtraAttrs(a, extracted) };
    }

    case "media_player": {
      const extracted = new Set([
        "volume_level", "is_volume_muted", "media_title", "media_artist",
        "media_album_name", "media_content_type", "source", "source_list",
      ]);
      const state: Record<string, unknown> = {
        power: s !== "off" ? "on" : "off",
        playState: s,
      };
      if (a.volume_level != null) state.volume = Math.round((a.volume_level as number) * 100);
      if (a.is_volume_muted != null) state.muted = a.is_volume_muted;
      if (a.media_title != null) state.mediaTitle = a.media_title;
      if (a.media_artist != null) state.mediaArtist = a.media_artist;
      if (a.media_album_name != null) state.mediaAlbum = a.media_album_name;
      if (a.media_content_type != null) state.mediaType = a.media_content_type;
      if (a.source != null) state.source = a.source;
      if (Array.isArray(a.source_list)) state.sources = a.source_list;
      return { state, attributes: collectExtraAttrs(a, extracted) };
    }

    case "alarm_control_panel":
      return {
        state: { state: s, armed: s !== "disarmed" },
        attributes: collectExtraAttrs(a, new Set()),
      };

    case "humidifier": {
      const extracted = new Set(["humidity", "current_humidity", "mode", "action"]);
      const state: Record<string, unknown> = { power: s === "on" ? "on" : "off" };
      if (a.humidity != null) state.targetHumidity = a.humidity;
      if (a.current_humidity != null) state.humidity = a.current_humidity;
      if (a.mode != null) state.mode = a.mode;
      if (a.action != null) state.action = a.action;
      return { state, attributes: collectExtraAttrs(a, extracted) };
    }

    case "water_heater": {
      const extracted = new Set(["current_temperature", "temperature", "away_mode"]);
      const state: Record<string, unknown> = {
        mode: s,
        power: s !== "off" ? "on" : "off",
      };
      if (a.current_temperature != null) state.currentTemp = a.current_temperature;
      if (a.temperature != null) state.targetTemp = a.temperature;
      if (a.away_mode != null) state.away = a.away_mode === "on";
      return { state, attributes: collectExtraAttrs(a, extracted) };
    }

    case "vacuum": {
      const extracted = new Set(["battery_level", "fan_speed"]);
      const state: Record<string, unknown> = { state: s };
      if (a.battery_level != null) state.battery = a.battery_level;
      if (a.fan_speed != null) state.fanSpeed = a.fan_speed;
      return { state, attributes: collectExtraAttrs(a, extracted) };
    }

    case "lawn_mower":
      return { state: { state: s }, attributes: collectExtraAttrs(a, new Set()) };

    case "sensor": {
      const extracted = new Set(["unit_of_measurement"]);
      const num = Number(s);
      const state: Record<string, unknown> = { value: isNaN(num) ? s : num };
      if (a.unit_of_measurement != null) state.unit = a.unit_of_measurement;
      return { state, attributes: collectExtraAttrs(a, extracted) };
    }

    case "binary_sensor":
      return { state: { active: s === "on" }, attributes: collectExtraAttrs(a, new Set()) };

    case "weather": {
      const extracted = new Set([
        "temperature", "humidity", "pressure", "wind_speed",
        "wind_bearing", "visibility", "forecast",
      ]);
      const state: Record<string, unknown> = { condition: s };
      if (a.temperature != null) state.temperature = a.temperature;
      if (a.humidity != null) state.humidity = a.humidity;
      if (a.pressure != null) state.pressure = a.pressure;
      if (a.wind_speed != null) state.windSpeed = a.wind_speed;
      if (a.wind_bearing != null) state.windBearing = a.wind_bearing;
      if (a.visibility != null) state.visibility = a.visibility;
      if (a.forecast != null) state.forecast = a.forecast;
      return { state, attributes: collectExtraAttrs(a, extracted) };
    }

    case "device_tracker": {
      const extracted = new Set(["latitude", "longitude", "battery_level", "source_type"]);
      const state: Record<string, unknown> = { state: s };
      if (a.latitude != null) state.latitude = a.latitude;
      if (a.longitude != null) state.longitude = a.longitude;
      if (a.battery_level != null) state.battery = a.battery_level;
      if (a.source_type != null) state.sourceType = a.source_type;
      return { state, attributes: collectExtraAttrs(a, extracted) };
    }

    case "person": {
      const extracted = new Set(["latitude", "longitude", "source"]);
      const state: Record<string, unknown> = { state: s };
      if (a.latitude != null) state.latitude = a.latitude;
      if (a.longitude != null) state.longitude = a.longitude;
      if (a.source != null) state.source = a.source;
      return { state, attributes: collectExtraAttrs(a, extracted) };
    }

    case "camera": {
      const extracted = new Set(["is_streaming"]);
      const state: Record<string, unknown> = { state: s };
      if (a.is_streaming != null) state.streaming = a.is_streaming;
      return { state, attributes: collectExtraAttrs(a, extracted) };
    }

    case "remote": {
      const extracted = new Set(["current_activity"]);
      const state: Record<string, unknown> = { power: s === "on" ? "on" : "off" };
      if (a.current_activity != null) state.activity = a.current_activity;
      return { state, attributes: collectExtraAttrs(a, extracted) };
    }

    case "scene":
      return { state: { activated: s !== "unknown" }, attributes: collectExtraAttrs(a, new Set()) };

    case "calendar": {
      const extracted = new Set(["message", "start_time", "end_time", "description", "location"]);
      const state: Record<string, unknown> = { active: s === "on" };
      if (a.message != null) state.eventSummary = a.message;
      if (a.start_time != null) state.eventStart = a.start_time;
      if (a.end_time != null) state.eventEnd = a.end_time;
      if (a.description != null) state.eventDescription = a.description;
      if (a.location != null) state.eventLocation = a.location;
      return { state, attributes: collectExtraAttrs(a, extracted) };
    }

    case "update": {
      const extracted = new Set(["installed_version", "latest_version", "in_progress", "release_summary", "title"]);
      return {
        state: {
          available: s === "on",
          currentVersion: a.installed_version ?? null,
          latestVersion: a.latest_version ?? null,
          installing: a.in_progress === true,
          releaseSummary: a.release_summary ?? null,
          title: a.title ?? null,
        },
        attributes: collectExtraAttrs(a, extracted),
      };
    }

    case "siren": {
      const extracted = new Set(["available_tones"]);
      const state: Record<string, unknown> = { power: s === "on" ? "on" : "off" };
      if (Array.isArray(a.available_tones)) state.tones = a.available_tones;
      return { state, attributes: collectExtraAttrs(a, extracted) };
    }

    case "valve": {
      const extracted = new Set(["current_position"]);
      const state: Record<string, unknown> = { state: s };
      if (a.current_position != null) state.position = a.current_position;
      return { state, attributes: collectExtraAttrs(a, extracted) };
    }

    case "number":
    case "select":
    case "text":
    case "date":
    case "datetime":
    case "time": {
      const extracted = new Set(["min", "max", "step", "options"]);
      const num = Number(s);
      const state: Record<string, unknown> = { value: isNaN(num) ? s : num };
      if (a.min != null) state.min = a.min;
      if (a.max != null) state.max = a.max;
      if (a.step != null) state.step = a.step;
      if (Array.isArray(a.options)) state.options = a.options;
      return { state, attributes: collectExtraAttrs(a, extracted) };
    }

    default: {
      // Fallback for unknown domains — flatten state filtering UI-only attrs
      const state: Record<string, unknown> = { state: s };
      const extracted = new Set<string>();
      for (const [key, value] of Object.entries(a)) {
        if (!IGNORED_ATTRS.has(key)) {
          state[key] = value;
          extracted.add(key);
        }
      }
      return { state, attributes: collectExtraAttrs(a, extracted) };
    }
  }
}

// ── Command Translation ──────────────────────────────────────────────

interface TranslatedCommand {
  service: string;
  serviceData: Record<string, unknown>;
}

/** Translate a standard DAL command into an HA service call + param transformation. */
function translateCommand(
  domain: string,
  command: string,
  params: Record<string, unknown>,
): TranslatedCommand {
  // Domain-specific translations
  switch (domain) {
    case "light":
      switch (command) {
        case "set_brightness":
          return { service: "turn_on", serviceData: { brightness: Math.round(((params.brightness as number) / 100) * 255) } };
        case "set_color_temp":
          return { service: "turn_on", serviceData: { color_temp: Math.round(1_000_000 / (params.colorTemp as number)) } };
        case "set_color":
          return { service: "turn_on", serviceData: { hs_color: [params.hue, params.saturation] } };
      }
      break;

    case "climate":
      switch (command) {
        case "set_mode":
          return { service: "set_hvac_mode", serviceData: { hvac_mode: params.mode } };
        case "set_fan_mode":
          return { service: "set_fan_mode", serviceData: { fan_mode: params.fanMode } };
        case "set_preset":
          return { service: "set_preset_mode", serviceData: { preset_mode: params.preset } };
        case "set_temperature":
          return { service: "set_temperature", serviceData: { temperature: params.temperature } };
      }
      break;

    case "cover":
      switch (command) {
        case "open": return { service: "open_cover", serviceData: {} };
        case "close": return { service: "close_cover", serviceData: {} };
        case "stop": return { service: "stop_cover", serviceData: {} };
        case "set_position": return { service: "set_cover_position", serviceData: { position: params.position } };
        case "set_tilt": return { service: "set_cover_tilt_position", serviceData: { tilt_position: params.tilt } };
      }
      break;

    case "fan":
      switch (command) {
        case "set_speed": return { service: "set_percentage", serviceData: { percentage: params.speed } };
        case "set_preset": return { service: "set_preset_mode", serviceData: { preset_mode: params.preset } };
        case "set_direction": return { service: "set_direction", serviceData: { direction: params.direction } };
        case "oscillate": return { service: "oscillate", serviceData: { oscillating: params.enabled } };
      }
      break;

    case "media_player":
      switch (command) {
        case "play": return { service: "media_play", serviceData: {} };
        case "pause": return { service: "media_pause", serviceData: {} };
        case "stop": return { service: "media_stop", serviceData: {} };
        case "next_track": return { service: "media_next_track", serviceData: {} };
        case "previous_track": return { service: "media_previous_track", serviceData: {} };
        case "set_volume": return { service: "volume_set", serviceData: { volume_level: (params.volume as number) / 100 } };
        case "mute": return { service: "volume_mute", serviceData: { is_volume_muted: params.muted } };
        case "set_source": return { service: "select_source", serviceData: { source: params.source } };
        case "play_media": return { service: "play_media", serviceData: { media_content_type: params.mediaType, media_content_id: params.mediaId } };
      }
      break;

    case "alarm_control_panel":
      switch (command) {
        case "disarm": return { service: "alarm_disarm", serviceData: params.code ? { code: params.code } : {} };
        case "arm_home": return { service: "alarm_arm_home", serviceData: params.code ? { code: params.code } : {} };
        case "arm_away": return { service: "alarm_arm_away", serviceData: params.code ? { code: params.code } : {} };
        case "arm_night": return { service: "alarm_arm_night", serviceData: params.code ? { code: params.code } : {} };
        case "arm_vacation": return { service: "alarm_arm_vacation", serviceData: params.code ? { code: params.code } : {} };
        case "trigger": return { service: "alarm_trigger", serviceData: {} };
      }
      break;

    case "humidifier":
      switch (command) {
        case "set_humidity": return { service: "set_humidity", serviceData: { humidity: params.humidity } };
        case "set_mode": return { service: "set_mode", serviceData: { mode: params.mode } };
      }
      break;

    case "water_heater":
      switch (command) {
        case "set_temperature": return { service: "set_temperature", serviceData: { temperature: params.temperature } };
        case "set_mode": return { service: "set_operation_mode", serviceData: { operation_mode: params.mode } };
        case "set_away":
          return params.away
            ? { service: "turn_away_mode_on", serviceData: {} }
            : { service: "turn_away_mode_off", serviceData: {} };
      }
      break;

    case "vacuum":
      if (command === "dock") return { service: "return_to_base", serviceData: {} };
      break;

    case "lawn_mower":
      if (command === "start") return { service: "start_mowing", serviceData: {} };
      if (command === "dock") return { service: "dock", serviceData: {} };
      break;

    case "scene":
      if (command === "activate") return { service: "turn_on", serviceData: {} };
      break;

    case "valve":
      switch (command) {
        case "open": return { service: "open_valve", serviceData: {} };
        case "close": return { service: "close_valve", serviceData: {} };
        case "set_position": return { service: "set_valve_position", serviceData: { position: params.position } };
      }
      break;

    case "remote":
      if (command === "send_command") return { service: "send_command", serviceData: { command: params.command } };
      break;

    case "calendar":
      if (command === "create_event") {
        return {
          service: "create_event",
          serviceData: {
            summary: params.summary,
            start_date_time: params.startTime,
            end_date_time: params.endTime,
            ...(params.description ? { description: params.description } : {}),
            ...(params.location ? { location: params.location } : {}),
          },
        };
      }
      break;

    case "update":
      if (command === "install") {
        return { service: "install", serviceData: params.version ? { version: params.version } : {} };
      }
      break;
  }

  // Universal commands that work across all domains
  if (command === "turn_on") return { service: "turn_on", serviceData: {} };
  if (command === "turn_off") return { service: "turn_off", serviceData: {} };

  // Fallback — pass command name as service, params as-is
  return { service: command, serviceData: { ...params } };
}

// ── Provider ─────────────────────────────────────────────────────────

export class HomeAssistantProvider implements DeviceProvider {
  readonly name = "home_assistant";

  private connection: Connection | null = null;
  private entities = new Map<string, HassEntity>();
  private areas = new Map<string, HAArea>();
  private floors = new Map<string, HAFloor>();
  private entityRegistry = new Map<string, HAEntityEntry>();
  private deviceRegistry = new Map<string, HADeviceEntry>();
  private listeners: Array<(event: DeviceEvent) => void> = [];
  private filter: HAEntityFilter;
  private unsubEntities?: () => void;
  private url: string;
  private token: string;

  constructor(url: string, token: string, dbPath: string = "./holms.db") {
    this.url = url.replace(/\/+$/, ""); // strip trailing slash
    this.token = token;
    this.filter = new HAEntityFilter(dbPath);
  }

  async connect(): Promise<void> {
    const auth = createLongLivedTokenAuth(this.url, this.token);
    this.connection = await createConnection({ auth });

    // Load registries
    const [areas, floors, entityEntries, deviceEntries] = await Promise.all([
      this.connection.sendMessagePromise<HAArea[]>({ type: "config/area_registry/list" }),
      this.connection.sendMessagePromise<HAFloor[]>({ type: "config/floor_registry/list" }),
      this.connection.sendMessagePromise<HAEntityEntry[]>({ type: "config/entity_registry/list" }),
      this.connection.sendMessagePromise<HADeviceEntry[]>({ type: "config/device_registry/list" }),
    ]);

    for (const area of areas) this.areas.set(area.area_id, area);
    for (const floor of floors) this.floors.set(floor.floor_id, floor);
    for (const entry of entityEntries) this.entityRegistry.set(entry.entity_id, entry);
    for (const device of deviceEntries) this.deviceRegistry.set(device.id, device);

    // Subscribe to entity state changes
    this.unsubEntities = subscribeEntities(this.connection, (newEntities) => {
      this.handleEntityUpdate(newEntities);
    });

    console.log(`[HomeAssistant] Connected to ${this.url} — ${this.entities.size} entities`);
  }

  async disconnect(): Promise<void> {
    this.unsubEntities?.();
    this.connection?.close();
    this.connection = null;
    console.log("[HomeAssistant] Disconnected");
  }

  async getDevices(): Promise<Device[]> {
    const allowed = this.filter.getAllowed();
    const devices: Device[] = [];

    for (const [entityId, entity] of this.entities) {
      // If filter is configured (non-empty), only return allowed entities
      if (allowed.size > 0 && !allowed.has(entityId)) continue;
      // If filter is empty (no entities selected), skip all — user must select first
      if (allowed.size === 0) continue;

      devices.push(this.entityToDevice(entityId, entity));
    }

    return devices;
  }

  async getAreas(): Promise<DeviceArea[]> {
    const areaSet = new Set<string>();
    const result: DeviceArea[] = [];
    const allowed = this.filter.getAllowed();

    for (const entityId of this.entities.keys()) {
      if (allowed.size > 0 && !allowed.has(entityId)) continue;
      if (allowed.size === 0) continue;

      const area = this.getEntityArea(entityId);
      if (area && !areaSet.has(area.id)) {
        areaSet.add(area.id);
        result.push(area);
      }
    }

    return result;
  }

  onEvent(callback: (event: DeviceEvent) => void): void {
    this.listeners.push(callback);
  }

  async executeCommand(
    deviceId: string,
    command: string,
    params: Record<string, unknown>,
  ): Promise<CommandResult> {
    if (!this.connection) {
      return { success: false, error: "Not connected to Home Assistant" };
    }

    // deviceId format: "ha:<entity_id>"
    const entityId = deviceId.replace(/^ha:/, "");
    const domain = entityId.split(".")[0]!;

    // Translate standard DAL command → HA service call
    const { service, serviceData } = translateCommand(domain, command, params);

    try {
      await this.connection.sendMessagePromise({
        type: "call_service",
        domain,
        service,
        target: { entity_id: entityId },
        service_data: serviceData,
      });

      // State will be updated via the subscription
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message ?? String(err) };
    }
  }

  /** Get all entities (unfiltered) for the entity picker UI */
  getAllEntities(): Array<{
    entity_id: string;
    friendly_name: string;
    domain: string;
    area_name: string | null;
    state: string;
  }> {
    const result: Array<{
      entity_id: string;
      friendly_name: string;
      domain: string;
      area_name: string | null;
      state: string;
    }> = [];

    for (const [entityId, entity] of this.entities) {
      const area = this.getEntityArea(entityId);
      result.push({
        entity_id: entityId,
        friendly_name: entity.attributes.friendly_name ?? entityId,
        domain: entityId.split(".")[0]!,
        area_name: area?.name ?? null,
        state: entity.state,
      });
    }

    return result.sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  }

  /** Get the entity filter for external access (entity picker) */
  getEntityFilter(): HAEntityFilter {
    return this.filter;
  }

  // ── Private ──

  private handleEntityUpdate(newEntities: HassEntities): void {
    const allowed = this.filter.getAllowed();

    for (const [entityId, entity] of Object.entries(newEntities)) {
      const previous = this.entities.get(entityId);
      this.entities.set(entityId, entity);

      // Only emit events for filtered entities
      if (allowed.size > 0 && !allowed.has(entityId)) continue;
      if (allowed.size === 0) continue;

      const domain = entityId.split(".")[0]!;

      // Emit state_changed if the entity existed before and state differs
      if (previous && previous.state !== entity.state) {
        const event: DeviceEvent = {
          deviceId: `ha:${entityId}`,
          type: "state_changed",
          data: normalizeState(domain, entity).state,
          timestamp: Date.now(),
          domain: domain as DeviceDomain,
          area: this.getEntityArea(entityId)?.id,
          previousState: normalizeState(domain, previous).state,
        };

        for (const listener of this.listeners) {
          listener(event);
        }
      }
    }
  }

  private entityToDevice(entityId: string, entity: HassEntity): Device {
    const domain = entityId.split(".")[0]!;
    const area = this.getEntityArea(entityId) ?? { id: "unknown", name: "Unknown" };
    const regEntry = this.entityRegistry.get(entityId);
    const deviceEntry = regEntry?.device_id ? this.deviceRegistry.get(regEntry.device_id) : undefined;

    const { state, attributes } = normalizeState(domain, entity);

    return {
      id: `ha:${entityId}`,
      name: entity.attributes.friendly_name ?? entityId,
      domain: domain as DeviceDomain,
      area,
      state,
      capabilities: getStandardCapabilities(domain),
      availability: {
        online: entity.state !== "unavailable",
        lastSeen: Date.now(),
        source: "home_assistant",
      },
      metadata: deviceEntry ? {
        manufacturer: deviceEntry.manufacturer ?? undefined,
        model: deviceEntry.model ?? undefined,
        swVersion: deviceEntry.sw_version ?? undefined,
      } : undefined,
      ...(attributes ? { attributes } : {}),
    };
  }

  private getEntityArea(entityId: string): DeviceArea | null {
    const regEntry = this.entityRegistry.get(entityId);

    // Entity may have its own area override
    if (regEntry?.area_id) {
      const area = this.areas.get(regEntry.area_id);
      if (area) {
        const floor = area.floor_id ? this.floors.get(area.floor_id) : undefined;
        return { id: area.area_id, name: area.name, floor: floor?.name };
      }
    }

    // Fall back to device's area
    if (regEntry?.device_id) {
      const device = this.deviceRegistry.get(regEntry.device_id);
      if (device?.area_id) {
        const area = this.areas.get(device.area_id);
        if (area) {
          const floor = area.floor_id ? this.floors.get(area.floor_id) : undefined;
          return { id: area.area_id, name: area.name, floor: floor?.name };
        }
      }
    }

    return null;
  }
}
