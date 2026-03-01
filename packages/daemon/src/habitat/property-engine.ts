import { EventEmitter } from "node:events";
import type {
  PropertyName,
  QueryResult,
  HabitatEvent,
  ObserveResult,
  SpaceObservation,
  PropertyObservation,
  SourceObservation,
  InfluenceResult,
  CapabilitiesResult,
} from "./types.js";
import type { SpaceRegistry } from "./space-registry.js";
import type { AdapterSupervisor } from "./supervisor/supervisor.js";
import type { HabitatConfigStore } from "./config-store.js";

export class PropertyEngine extends EventEmitter {
  private registry: SpaceRegistry;
  private supervisor: AdapterSupervisor;
  private configStore: HabitatConfigStore;

  constructor(registry: SpaceRegistry, supervisor: AdapterSupervisor, configStore: HabitatConfigStore) {
    super();
    this.registry = registry;
    this.supervisor = supervisor;
    this.configStore = configStore;
  }

  /** Return state from SQLite cache — no adapter calls. Used by frontend polling. */
  observeCached(space?: string, property?: PropertyName): ObserveResult {
    const spaces = space
      ? [this.registry.getSpace(space)].filter(Boolean)
      : this.registry.getAllSpaces();

    const allState = this.configStore.getAllState();
    const spaceObservations: SpaceObservation[] = [];

    for (const sp of spaces) {
      if (!sp) continue;

      const propMap = new Map<PropertyName, typeof sp.sources>();
      for (const source of sp.sources) {
        for (const prop of source.properties) {
          if (property && prop.property !== property) continue;
          const list = propMap.get(prop.property) ?? [];
          list.push(source);
          propMap.set(prop.property, list);
        }
      }

      const propertyObservations: PropertyObservation[] = [];
      for (const [propName, sources] of propMap) {
        const sourceObs: SourceObservation[] = [];

        for (const source of sources) {
          const sourceProp = source.properties.find((p) => p.property === propName);
          if (!sourceProp) continue;

          const cached = allState.get(`${source.id}:${propName}`);

          sourceObs.push({
            source: source.id,
            adapterId: source.adapterId,
            role: sourceProp.role,
            mounting: sourceProp.mounting,
            features: sourceProp.features,
            reachable: source.reachable,
            state: cached ?? {},
          });
        }

        propertyObservations.push({ property: propName, sources: sourceObs });
      }

      spaceObservations.push({ space: sp.id, properties: propertyObservations });
    }

    return { spaces: spaceObservations };
  }

  /** Query adapters live for current state. Used by agent MCP tool. */
  async observe(space?: string, property?: PropertyName): Promise<ObserveResult> {
    const spaces = space
      ? [this.registry.getSpace(space)].filter(Boolean)
      : this.registry.getAllSpaces();

    const spaceObservations: SpaceObservation[] = [];

    for (const sp of spaces) {
      if (!sp) continue;

      // Group sources by property
      const propMap = new Map<PropertyName, typeof sp.sources>();
      for (const source of sp.sources) {
        for (const prop of source.properties) {
          if (property && prop.property !== property) continue;
          const list = propMap.get(prop.property) ?? [];
          list.push(source);
          propMap.set(prop.property, list);
        }
      }

      const propertyObservations: PropertyObservation[] = [];
      for (const [propName, sources] of propMap) {
        const sourceObs: SourceObservation[] = [];

        for (const source of sources) {
          const route = this.registry.getSourceRoute(source.id);
          const sourceProp = source.properties.find((p) => p.property === propName);
          if (!route || !sourceProp) continue;

          let state: Record<string, unknown> = {};
          let cached = false;
          if (source.reachable) {
            try {
              state = await this.supervisor.observe(route.adapterId, route.entityId, propName);
            } catch {
              // Adapter unreachable — fall back to cached state
              const cachedState = this.configStore.getState(source.id, propName);
              if (cachedState) {
                state = cachedState.state;
                cached = true;
              } else {
                state = { error: "unreachable" };
              }
            }
          } else {
            // Source marked unreachable — use cached state if available
            const cachedState = this.configStore.getState(source.id, propName);
            if (cachedState) {
              state = cachedState.state;
              cached = true;
            }
          }

          sourceObs.push({
            source: source.id,
            adapterId: route.adapterId,
            role: sourceProp.role,
            mounting: sourceProp.mounting,
            features: sourceProp.features,
            reachable: source.reachable,
            state,
            ...(cached ? { cached: true } : {}),
          });
        }

        propertyObservations.push({ property: propName, sources: sourceObs });
      }

      spaceObservations.push({ space: sp.id, properties: propertyObservations });
    }

    return { spaces: spaceObservations };
  }

  async query(
    space: string,
    target: { property?: PropertyName; source?: string },
    params: Record<string, unknown>,
  ): Promise<QueryResult> {
    // Resolve to a single source
    let sourceId: string | undefined;
    let route: { adapterId: string; entityId: string } | undefined;
    let property: PropertyName | undefined;

    if (target.source) {
      sourceId = target.source;
      const source = this.registry.getSource(target.source);
      if (!source) throw new Error(`Source "${target.source}" not found`);
      route = this.registry.getSourceRoute(source.id);
      property = target.property ?? source.properties[0]?.property;
    } else if (target.property) {
      property = target.property;
      const sources = this.registry.getSourcesForProperty(space, target.property);
      if (sources.length === 0) throw new Error(`No sources for property "${target.property}" in space "${space}"`);
      const source = sources[0];
      sourceId = source.id;
      route = this.registry.getSourceRoute(source.id);
    } else {
      throw new Error("Must specify property or source");
    }

    if (!route || !property || !sourceId) throw new Error("Could not resolve query target");

    const result = await this.supervisor.query(route.adapterId, route.entityId, property, params);

    // Persist collection items
    this.configStore.syncCollectionItems(sourceId, property, result.items, Date.now());

    return result;
  }

  async influence(
    space: string,
    target: { property?: PropertyName; source?: string },
    params: Record<string, unknown>,
  ): Promise<InfluenceResult> {
    const results: InfluenceResult["results"] = [];

    if (target.source) {
      // Single source
      const source = this.registry.getSource(target.source);
      if (!source) {
        return { results: [{ source: target.source, success: false, error: "Source not found" }] };
      }
      const route = this.registry.getSourceRoute(source.id);
      if (!route) {
        return { results: [{ source: target.source, success: false, error: "No route" }] };
      }
      // Determine property from source's first matching property or from target
      const prop = target.property ?? source.properties[0]?.property;
      if (!prop) {
        return { results: [{ source: target.source, success: false, error: "No property" }] };
      }
      const result = await this.supervisor.execute(route.adapterId, route.entityId, prop, params);
      results.push({ source: source.id, ...result });
    } else if (target.property) {
      // All sources of this property in the space
      const sources = this.registry.getSourcesForProperty(space, target.property);
      for (const source of sources) {
        const route = this.registry.getSourceRoute(source.id);
        if (!route || !source.reachable) {
          results.push({
            source: source.id,
            success: false,
            error: source.reachable ? "No route" : "Unreachable",
          });
          continue;
        }
        const result = await this.supervisor.execute(
          route.adapterId,
          route.entityId,
          target.property,
          params,
        );
        results.push({ source: source.id, ...result });
      }
    } else {
      return { results: [{ source: "unknown", success: false, error: "Must specify property or source" }] };
    }

    return { results };
  }

  capabilities(space?: string): CapabilitiesResult {
    const spaces = space
      ? [this.registry.getSpace(space)].filter(Boolean)
      : this.registry.getAllSpaces();

    return {
      spaces: spaces
        .filter(Boolean)
        .map((sp) => {
          const propMap = new Map<PropertyName, Array<{
            source: string;
            role: string;
            mounting?: string;
            features: string[];
            reachable: boolean;
          }>>();

          for (const source of sp!.sources) {
            for (const prop of source.properties) {
              const list = propMap.get(prop.property) ?? [];
              list.push({
                source: source.id,
                role: prop.role,
                mounting: prop.mounting,
                features: prop.features,
                reachable: source.reachable,
                ...(prop.commandHints ? { commandHints: prop.commandHints } : {}),
              });
              propMap.set(prop.property, list);
            }
          }

          return {
            space: sp!.id,
            displayName: sp!.displayName,
            floor: sp!.floor,
            properties: Array.from(propMap.entries()).map(([property, sources]) => ({
              property,
              sources,
            })),
          };
        }),
    };
  }

  handleStateChange(
    adapterId: string,
    entityId: string,
    property: PropertyName,
    state: Record<string, unknown>,
    previousState?: Record<string, unknown>,
  ): void {
    // Resolve entity back to space + source
    for (const space of this.registry.getAllSpaces()) {
      for (const source of space.sources) {
        if (source.adapterId === adapterId && source.entityId === entityId) {
          const timestamp = Date.now();

          // Persist state to DB
          this.configStore.upsertState(source.id, property, state, previousState, timestamp);

          const event: HabitatEvent = {
            space: space.id,
            source: source.id,
            property,
            state,
            previousState,
            timestamp,
          };
          this.emit("event", event);
          return;
        }
      }
    }
  }
}
