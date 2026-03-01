import { runAdapter, type Adapter, type AdapterFactory, type CommandFieldDef, type EntityRegistration, type EntityGroup, type RegistrationResult, type PropertyName, type DiscoverResult, type PairResult } from "@holms/adapter-sdk";
import type { HueAdapterConfig, HueGroupedLight, HueSSEEvent } from "./types.js";
import { HueBridgeClient } from "./bridge-client.js";
import { HueSSEListener } from "./sse-listener.js";
import { discoverBridges, pairBridge } from "./discovery.js";
import {
  lightToIllumination,
  motionToOccupancy,
  temperatureToClimate,
  lightLevelToIllumination,
  contactToAccess,
  smartPlugToPower,
  illuminationToLightPut,
  powerToSmartPlugPut,
  classifyDevice,
  classifyRoom,
  buildRoomMap,
  buildServiceLookup,
} from "./translators.js";

const ILLUMINATION_HINTS: Record<string, CommandFieldDef> = {
  on: { type: "boolean" },
  brightness: { type: "number", min: 0, max: 100, description: "Brightness %" },
  color_temp: { type: "number", min: 153, max: 500, description: "Color temp in mirek (153=cool daylight, 370=warm, 500=candle)" },
  transition: { type: "number", description: "Fade duration in ms" },
  scene: { type: "string", description: "Hue scene ID to activate" },
};

const POWER_HINTS: Record<string, CommandFieldDef> = {
  on: { type: "boolean" },
};

function applyCommandHints(registrations: EntityRegistration[]): void {
  for (const reg of registrations) {
    for (const prop of reg.properties) {
      if (prop.property === "illumination") {
        prop.commandHints = ILLUMINATION_HINTS;
      } else if (prop.property === "power") {
        prop.commandHints = POWER_HINTS;
      }
    }
  }
}

type TranslatorFn = (resource: any) => Record<string, unknown>;

interface ServiceMapping {
  entityId: string;
  property: PropertyName;
  resourceType: string;
  /** Translate Hue resource → Habitat state */
  translate: TranslatorFn;
  /** Is this a smart plug (uses power commands instead of light commands)? */
  isSmartPlug?: boolean;
}

export class HueAdapter implements Adapter {
  private client: HueBridgeClient | null = null;
  private sse: HueSSEListener | null = null;
  private configured: boolean;
  private entityMode: "devices" | "rooms";

  /** resource ID → service mapping for SSE and observe lookups */
  private resourceMap = new Map<string, ServiceMapping>();
  /** entity ID → set of resource IDs */
  private entityResources = new Map<string, Set<string>>();
  /** entity ID → property → last known state */
  private stateCache = new Map<string, Map<PropertyName, Record<string, unknown>>>();

  constructor(config: Record<string, unknown>) {
    const cfg = config as unknown as HueAdapterConfig;
    this.entityMode = cfg.entity_mode ?? "rooms";
    if (!cfg.bridge_ip || !cfg.api_key) {
      // Onboarding mode — no bridge config, only discover/pair available
      this.configured = false;
      return;
    }
    this.configured = true;
    this.client = new HueBridgeClient(cfg.bridge_ip, cfg.api_key);
  }

  async register(): Promise<RegistrationResult> {
    if (!this.configured || !this.client) return { entities: [] };

    // Fetch all resources in parallel
    const [devices, lights, rooms, motions, temperatures, lightLevels, contacts, groupedLights] =
      await Promise.all([
        this.client.getDevices(),
        this.client.getLights(),
        this.client.getRooms(),
        this.client.getMotionSensors(),
        this.client.getTemperatureSensors(),
        this.client.getLightLevelSensors(),
        this.client.getContactSensors(),
        this.entityMode === "rooms" ? this.client.getGroupedLights() : Promise.resolve([] as HueGroupedLight[]),
      ]);

    const services = buildServiceLookup(lights, motions, temperatures, lightLevels, contacts);

    if (this.entityMode === "rooms") {
      return this.registerRooms(rooms, devices, groupedLights, services);
    }
    return this.registerDevices(devices, lights, rooms, services);
  }

  private registerDevices(
    devices: Awaited<ReturnType<HueBridgeClient["getDevices"]>>,
    _lights: Awaited<ReturnType<HueBridgeClient["getLights"]>>,
    rooms: Awaited<ReturnType<HueBridgeClient["getRooms"]>>,
    services: ReturnType<typeof buildServiceLookup>,
  ): RegistrationResult {
    const roomMap = buildRoomMap(rooms);
    const registrations: EntityRegistration[] = [];

    for (const device of devices) {
      const classified = classifyDevice(device, services, roomMap);
      if (!classified) continue;

      registrations.push({
        entityId: classified.entityId,
        displayName: device.metadata.name,
        properties: classified.properties,
      });

      const resourceIds = new Set<string>();

      // Map each service resource to its entity + translator
      for (const svc of device.services) {
        const mapping = this.resolveServiceMapping(
          svc.rid,
          svc.rtype,
          classified.entityId,
          classified.properties,
          services,
        );
        if (mapping) {
          this.resourceMap.set(svc.rid, mapping);
          resourceIds.add(svc.rid);
        }
      }

      this.entityResources.set(classified.entityId, resourceIds);
      this.cacheInitialState(classified.entityId, services);
    }

    applyCommandHints(registrations);

    // Build groups from Hue rooms
    const groups: EntityGroup[] = rooms
      .map((room) => ({
        id: room.id,
        name: room.metadata.name,
        type: "room" as const,
        entityIds: room.children
          .filter((c) => c.rtype === "device")
          .map((c) => c.rid)
          .filter((rid) => registrations.some((r) => r.entityId === rid)),
      }))
      .filter((g) => g.entityIds.length > 0);

    return { entities: registrations, groups };
  }

  private registerRooms(
    rooms: Awaited<ReturnType<HueBridgeClient["getRooms"]>>,
    devices: Awaited<ReturnType<HueBridgeClient["getDevices"]>>,
    groupedLights: HueGroupedLight[],
    services: ReturnType<typeof buildServiceLookup>,
  ): RegistrationResult {
    // Map room ID → its grouped_light (owner.rid is the room ID)
    const glByRoom = new Map<string, HueGroupedLight>();
    for (const gl of groupedLights) {
      glByRoom.set(gl.owner.rid, gl);
    }

    const registrations: EntityRegistration[] = [];

    for (const room of rooms) {
      const gl = glByRoom.get(room.id);
      const classified = classifyRoom(room, gl, services, devices);
      if (!classified) continue;

      registrations.push({
        entityId: classified.entityId,
        displayName: room.metadata.name,
        properties: classified.properties,
      });

      const resourceIds = new Set<string>();

      // Map the grouped_light resource
      if (gl) {
        const mapping = this.resolveServiceMapping(
          gl.id,
          "grouped_light",
          room.id,
          classified.properties,
          services,
        );
        if (mapping) {
          this.resourceMap.set(gl.id, mapping);
          resourceIds.add(gl.id);

          // Cache initial illumination state from the grouped_light
          const stateMap = new Map<PropertyName, Record<string, unknown>>();
          stateMap.set("illumination", mapping.translate(gl));
          this.stateCache.set(room.id, stateMap);
        }
      }

      // Map sensor resources from devices in this room
      const roomDeviceIds = new Set(
        room.children.filter((c) => c.rtype === "device").map((c) => c.rid),
      );
      for (const device of devices) {
        if (!roomDeviceIds.has(device.id)) continue;
        for (const svc of device.services) {
          // Skip lights — room uses grouped_light for illumination control
          if (svc.rtype === "light") continue;
          const mapping = this.resolveServiceMapping(
            svc.rid,
            svc.rtype,
            room.id,
            classified.properties,
            services,
          );
          if (mapping) {
            this.resourceMap.set(svc.rid, mapping);
            resourceIds.add(svc.rid);
          }
        }
      }

      this.entityResources.set(room.id, resourceIds);
      this.cacheInitialState(room.id, services);
    }

    applyCommandHints(registrations);

    // No groups needed in rooms mode — each room IS an entity
    return { entities: registrations };
  }

  async observe(entityId: string, property: PropertyName): Promise<Record<string, unknown>> {
    if (!this.configured || !this.client) throw new Error("Adapter not configured");
    const client = this.client;
    const resourceIds = this.entityResources.get(entityId);
    if (!resourceIds) throw new Error(`Unknown entity: ${entityId}`);

    let merged: Record<string, unknown> = {};

    for (const rid of resourceIds) {
      const mapping = this.resourceMap.get(rid);
      if (!mapping || mapping.property !== property) continue;

      const resource = await client.getResource(mapping.resourceType, rid);
      const state = mapping.translate(resource);
      merged = { ...merged, ...state };
    }

    // Update cache
    const entityCache = this.stateCache.get(entityId) ?? new Map();
    entityCache.set(property, merged);
    this.stateCache.set(entityId, entityCache);

    return merged;
  }

  async execute(
    entityId: string,
    property: PropertyName,
    command: Record<string, unknown>,
  ): Promise<void> {
    if (!this.configured || !this.client) throw new Error("Adapter not configured");
    const client = this.client;
    const resourceIds = this.entityResources.get(entityId);
    if (!resourceIds) throw new Error(`Unknown entity: ${entityId}`);

    // Find the controllable resource for this property
    for (const rid of resourceIds) {
      const mapping = this.resourceMap.get(rid);
      if (!mapping || mapping.property !== property) continue;
      if (mapping.resourceType !== "light" && mapping.resourceType !== "grouped_light") continue;

      if (mapping.isSmartPlug) {
        const body = powerToSmartPlugPut(command);
        await client.setLightState(rid, body);
      } else {
        const body = illuminationToLightPut(command);
        // Handle scene activation
        if ("__scene" in body) {
          await client.activateScene(body.__scene as string);
        } else if (mapping.resourceType === "grouped_light") {
          await client.setGroupedLightState(rid, body);
        } else {
          await client.setLightState(rid, body);
        }
      }
      return;
    }

    throw new Error(`No controllable resource for ${entityId}/${property}`);
  }

  async subscribe(
    cb: (entityId: string, property: PropertyName, state: Record<string, unknown>) => void,
  ): Promise<void> {
    if (!this.configured || !this.client) return; // no-op in onboarding mode
    const client = this.client;

    this.sse = new HueSSEListener(
      client.getBridgeIp(),
      client.getApiKey(),
      client.getHttpsAgent(),
    );

    this.sse.start((events: HueSSEEvent[]) => {
      for (const event of events) {
        if (event.type !== "update") continue;
        for (const item of event.data) {
          const mapping = this.resourceMap.get(item.id);
          if (!mapping) continue;

          const state = mapping.translate(item);
          const entityCache = this.stateCache.get(mapping.entityId);
          const previous = entityCache?.get(mapping.property);

          // Merge with existing state for this property (e.g. light + light_level on same entity)
          const merged = { ...(previous ?? {}), ...state };

          // Only emit if something actually changed
          if (JSON.stringify(merged) === JSON.stringify(previous)) continue;

          if (entityCache) {
            entityCache.set(mapping.property, merged);
          }

          cb(mapping.entityId, mapping.property, merged);
        }
      }
    });
  }

  async ping(): Promise<boolean> {
    if (!this.configured || !this.client) return true; // process is alive
    return this.client.ping();
  }

  async destroy(): Promise<void> {
    this.sse?.stop();
    this.client?.destroy();
    this.resourceMap.clear();
    this.entityResources.clear();
    this.stateCache.clear();
  }

  async discover(params: Record<string, unknown>): Promise<DiscoverResult> {
    const timeout = (params.timeout as number) ?? 10000;
    const bridges = await discoverBridges(timeout);
    if (bridges.length === 0) {
      return {
        gateways: [],
        message: "No Hue bridges found on the network. Ensure the bridge is powered on and connected to the same network. The user can also provide the bridge IP manually.",
      };
    }
    return {
      gateways: bridges.map((b) => ({
        id: b.id,
        name: b.name || `Hue Bridge (${b.ip})`,
        address: b.ip,
      })),
    };
  }

  async pair(params: Record<string, unknown>): Promise<PairResult> {
    const bridgeIp = (params.address ?? params.bridge_ip) as string;
    if (!bridgeIp) {
      return { success: false, error: "address is required (IP of the Hue bridge)" };
    }
    try {
      const result = await pairBridge(bridgeIp);
      return {
        success: true,
        credentials: { api_key: result.api_key, bridge_ip: bridgeIp },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private resolveServiceMapping(
    rid: string,
    rtype: string,
    entityId: string,
    properties: Array<{ property: PropertyName; features: string[] }>,
    services: ReturnType<typeof buildServiceLookup>,
  ): ServiceMapping | null {
    switch (rtype) {
      case "light": {
        const light = services.lights.get(rid);
        if (!light) return null;
        const isSmartPlug = properties.some((p) => p.property === "power" && p.features.includes("switch"));
        return {
          entityId,
          property: isSmartPlug ? "power" : "illumination",
          resourceType: "light",
          translate: isSmartPlug ? smartPlugToPower : lightToIllumination,
          isSmartPlug,
        };
      }
      case "grouped_light": {
        return {
          entityId,
          property: "illumination",
          resourceType: "grouped_light",
          translate: lightToIllumination,
        };
      }
      case "motion":
        if (!services.motions.has(rid)) return null;
        return { entityId, property: "occupancy", resourceType: "motion", translate: motionToOccupancy };
      case "temperature":
        if (!services.temperatures.has(rid)) return null;
        return { entityId, property: "climate", resourceType: "temperature", translate: temperatureToClimate };
      case "light_level":
        if (!services.lightLevels.has(rid)) return null;
        return { entityId, property: "illumination", resourceType: "light_level", translate: lightLevelToIllumination };
      case "contact":
        if (!services.contacts.has(rid)) return null;
        return { entityId, property: "access", resourceType: "contact", translate: contactToAccess };
      default:
        return null;
    }
  }

  private cacheInitialState(
    entityId: string,
    services: ReturnType<typeof buildServiceLookup>,
  ): void {
    const stateMap = this.stateCache.get(entityId) ?? new Map<PropertyName, Record<string, unknown>>();
    for (const [rid, mapping] of this.resourceMap) {
      if (mapping.entityId !== entityId) continue;
      const resource = this.getResourceFromLookup(rid, mapping.resourceType, services);
      if (resource) {
        const state = mapping.translate(resource);
        const existing = stateMap.get(mapping.property) ?? {};
        stateMap.set(mapping.property, { ...existing, ...state });
      }
    }
    this.stateCache.set(entityId, stateMap);
  }

  private getResourceFromLookup(
    rid: string,
    resourceType: string,
    services: ReturnType<typeof buildServiceLookup>,
  ): unknown | null {
    switch (resourceType) {
      case "light": return services.lights.get(rid) ?? null;
      case "motion": return services.motions.get(rid) ?? null;
      case "temperature": return services.temperatures.get(rid) ?? null;
      case "light_level": return services.lightLevels.get(rid) ?? null;
      case "contact": return services.contacts.get(rid) ?? null;
      default: return null;
    }
  }
}

const createHueAdapter: AdapterFactory = (config) => new HueAdapter(config);
export default createHueAdapter;

// Standalone entry point — when run as a process, start the SDK harness
runAdapter(createHueAdapter);
