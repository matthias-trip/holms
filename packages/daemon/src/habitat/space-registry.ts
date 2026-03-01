import type {
  Space,
  Source,
  SourceProperty,
  SourceRoute,
  PropertyName,
  SpaceConfig,
  SourceConfig,
  SourcePropertyConfig,
} from "./types.js";
import type { EntityRegistration } from "./supervisor/ipc-protocol.js";

export class SpaceRegistry {
  private spaces = new Map<string, Space>();
  private sourceRoutes = new Map<string, SourceRoute>();

  load(
    spaceConfigs: SpaceConfig[],
    sourceConfigs: SourceConfig[],
    propertyConfigs: SourcePropertyConfig[],
  ): void {
    this.spaces.clear();
    this.sourceRoutes.clear();

    // Build property lookup: sourceId → SourceProperty[]
    const propsBySource = new Map<string, SourceProperty[]>();
    for (const pc of propertyConfigs) {
      const list = propsBySource.get(pc.sourceId) ?? [];
      list.push({
        sourceId: pc.sourceId,
        property: pc.property,
        role: pc.role,
        mounting: pc.mounting,
        features: pc.features,
      });
      propsBySource.set(pc.sourceId, list);
    }

    // Build source lookup: spaceId → Source[]
    const sourcesBySpace = new Map<string, Source[]>();
    for (const sc of sourceConfigs) {
      const source: Source = {
        id: sc.id,
        spaceId: sc.spaceId,
        adapterId: sc.adapterId,
        entityId: sc.entityId,
        properties: propsBySource.get(sc.id) ?? [],
        reachable: false,
      };
      const list = sourcesBySpace.get(sc.spaceId) ?? [];
      list.push(source);
      sourcesBySpace.set(sc.spaceId, list);

      this.sourceRoutes.set(sc.id, {
        sourceId: sc.id,
        adapterId: sc.adapterId,
        entityId: sc.entityId,
      });
    }

    // Build spaces
    for (const sp of spaceConfigs) {
      this.spaces.set(sp.id, {
        id: sp.id,
        displayName: sp.displayName,
        floor: sp.floor,
        sources: sourcesBySpace.get(sp.id) ?? [],
      });
    }
  }

  getSpace(id: string): Space | undefined {
    return this.spaces.get(id);
  }

  getAllSpaces(): Space[] {
    return Array.from(this.spaces.values());
  }

  getSourceRoute(sourceId: string): SourceRoute | undefined {
    return this.sourceRoutes.get(sourceId);
  }

  getSourcesForProperty(spaceId: string, property: PropertyName): Source[] {
    const space = this.spaces.get(spaceId);
    if (!space) return [];
    return space.sources.filter((s) =>
      s.properties.some((p) => p.property === property),
    );
  }

  getSource(sourceId: string): Source | undefined {
    for (const space of this.spaces.values()) {
      const source = space.sources.find((s) => s.id === sourceId);
      if (source) return source;
    }
    return undefined;
  }

  findSourceSpace(sourceId: string): Space | undefined {
    for (const space of this.spaces.values()) {
      if (space.sources.some((s) => s.id === sourceId)) {
        return space;
      }
    }
    return undefined;
  }

  setAdapterReachability(adapterId: string, reachable: boolean): void {
    for (const space of this.spaces.values()) {
      for (const source of space.sources) {
        if (source.adapterId === adapterId) {
          source.reachable = reachable;
        }
      }
    }
  }

  applyEntityRegistrations(adapterId: string, registrations: EntityRegistration[]): void {
    const entityProps = new Map<string, Map<PropertyName, { features: string[]; commandHints?: Record<string, unknown> }>>();
    for (const reg of registrations) {
      const propMap = new Map<PropertyName, { features: string[]; commandHints?: Record<string, unknown> }>();
      for (const p of reg.properties) {
        propMap.set(p.property, { features: p.features, commandHints: p.commandHints });
      }
      entityProps.set(reg.entityId, propMap);
    }

    for (const space of this.spaces.values()) {
      for (const source of space.sources) {
        if (source.adapterId !== adapterId) continue;
        const propMap = entityProps.get(source.entityId);
        if (!propMap) continue;

        for (const prop of source.properties) {
          const runtime = propMap.get(prop.property);
          if (!runtime) continue;

          // Merge: keep config features, add any runtime-discovered ones
          const featureSet = new Set([...prop.features, ...runtime.features]);
          prop.features = Array.from(featureSet);

          // Store adapter-declared command hints
          if (runtime.commandHints) {
            prop.commandHints = runtime.commandHints as typeof prop.commandHints;
          }
        }
      }
    }
  }
}
