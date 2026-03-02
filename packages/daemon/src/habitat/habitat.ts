import type Database from "better-sqlite3";
import type { EventBus } from "../event-bus.js";
import type { HabitatEvent, PropertyName } from "./types.js";
import { HabitatConfigStore } from "./config-store.js";
import { SpaceRegistry } from "./space-registry.js";
import { AdapterSupervisor } from "./supervisor/supervisor.js";
import { AdapterRegistry, type AdapterSetup } from "./supervisor/adapter-registry.js";
import { PropertyEngine } from "./property-engine.js";
import type { SecretStore } from "./secret-store.js";

const EVENT_BUFFER_SIZE = 100;

export class Habitat {
  readonly engine: PropertyEngine;
  readonly registry: SpaceRegistry;
  readonly configStore: HabitatConfigStore;
  readonly supervisor: AdapterSupervisor;
  private recentEvents: HabitatEvent[] = [];
  private collectionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    db: Database.Database,
    private eventBus: EventBus,
    pluginAdapters?: Array<{ type: string; modulePath: string; setup?: AdapterSetup }>,
    secretStore?: SecretStore,
  ) {
    this.configStore = new HabitatConfigStore(db);
    this.registry = new SpaceRegistry();

    // Build adapter type → module path registry (only plugin-discovered adapters)
    const adapterRegistry = new AdapterRegistry();
    if (pluginAdapters) {
      for (const pa of pluginAdapters) {
        adapterRegistry.register(pa.type, pa.modulePath, pa.setup);
      }
    }

    this.supervisor = new AdapterSupervisor({
      registry: adapterRegistry,
      secretStore,
      onStateChange: (adapterId: string, entityId: string, property, state, previousState) => {
        this.engine.handleStateChange(adapterId, entityId, property, state, previousState);
      },
      onReachabilityChange: (adapterId, reachable) => {
        this.registry.setAdapterReachability(adapterId, reachable);
      },
      onEntityRegistration: (adapterId, entities) => {
        this.registry.applyEntityRegistrations(adapterId, entities);
      },
      onLog: (adapterId, entry) => {
        this.eventBus.emit("adapter:log", {
          adapterId,
          level: entry.level,
          message: entry.message,
          timestamp: entry.timestamp,
        });
      },
    });
    this.engine = new PropertyEngine(this.registry, this.supervisor, this.configStore);

    // Forward PropertyEngine events to the EventBus
    this.engine.on("event", (event: HabitatEvent) => {
      this.recentEvents.push(event);
      if (this.recentEvents.length > EVENT_BUFFER_SIZE) {
        this.recentEvents.shift();
      }
      this.eventBus.emit("habitat:event", event);
    });
  }

  async start(): Promise<void> {
    // Load config from DB and build in-memory registry
    const data = this.configStore.loadAll();
    this.registry.load(data.spaces, data.sources, data.sourceProperties);

    // Fire-and-forget: start adapters in the background
    // They'll register entities and emit events via callbacks as they come online
    Promise.allSettled(
      data.adapters.map((adapter) => this.supervisor.startAdapter(adapter)),
    ).then((results) => {
      for (const r of results) {
        if (r.status === "rejected") {
          console.error(`[Habitat] Adapter failed to start:`, r.reason);
        }
      }
    });

    console.log(`[Habitat] Started — ${data.spaces.length} space(s), ${data.adapters.length} adapter(s) (booting in background)`);

    // Seed state cache after a short delay to give fast adapters time to connect
    setTimeout(() => {
      if (data.sources.length > 0) {
        this.engine.observe().then(
          (result) => {
            // Persist each source's live state into the cache
            for (const sp of result.spaces) {
              for (const prop of sp.properties) {
                for (const src of prop.sources) {
                  if (Object.keys(src.state).length > 0 && !("error" in src.state)) {
                    this.configStore.upsertState(src.source, prop.property, src.state, undefined, Date.now());
                  }
                }
              }
            }
            console.log(`[Habitat] State cache seeded`);
          },
          (err) => console.warn(`[Habitat] State cache seed failed:`, err),
        );
      }
      this.seedCollections();
    }, 3000);

    this.collectionTimer = setInterval(() => this.seedCollections(), 5 * 60 * 1000);
  }

  async stop(): Promise<void> {
    if (this.collectionTimer) {
      clearInterval(this.collectionTimer);
      this.collectionTimer = null;
    }
    await this.supervisor.stopAll();
  }

  /** Reload the in-memory registry from DB (after config changes) */
  reload(): void {
    const data = this.configStore.loadAll();
    this.registry.load(data.spaces, data.sources, data.sourceProperties);

    // Re-apply reachability from running adapters
    for (const adapterId of this.supervisor.getRunningAdapterIds()) {
      this.registry.setAdapterReachability(adapterId, true);
    }

    // Seed state for sources that have no cached state yet
    this.seedMissingState();
    this.seedCollections();
  }

  /** Seed state for sources that have no cached state in the DB yet. */
  private seedMissingState(): void {
    const allState = this.configStore.getAllState();
    const spaces = this.registry.getAllSpaces();
    const unseeded: Array<{ source: string; adapterId: string; entityId: string; property: PropertyName }> = [];

    for (const sp of spaces) {
      for (const source of sp.sources) {
        for (const prop of source.properties) {
          const key = `${source.id}:${prop.property}`;
          if (!allState.has(key)) {
            unseeded.push({ source: source.id, adapterId: source.adapterId, entityId: source.entityId, property: prop.property });
          }
        }
      }
    }

    if (unseeded.length === 0) return;

    Promise.all(
      unseeded.map(async (u) => {
        try {
          const state = await this.supervisor.observe(u.adapterId, u.entityId, u.property);
          if (Object.keys(state).length > 0) {
            this.configStore.upsertState(u.source, u.property, state, undefined, Date.now());
          }
        } catch { /* adapter not available yet — will get state on next SSE event */ }
      }),
    ).then(() => {
      console.log(`[Habitat] Seeded state for ${unseeded.length} new source(s)`);
    });
  }

  /** Seed collection items (e.g. calendar events) from all sources. */
  private seedCollections(): void {
    const spaces = this.registry.getAllSpaces();
    const queries: Array<{ sourceId: string; adapterId: string; entityId: string; property: PropertyName }> = [];

    for (const sp of spaces) {
      for (const source of sp.sources) {
        for (const prop of source.properties) {
          queries.push({
            sourceId: source.id,
            adapterId: source.adapterId,
            entityId: source.entityId,
            property: prop.property,
          });
        }
      }
    }

    Promise.allSettled(
      queries.map(async (q) => {
        const result = await this.supervisor.query(q.adapterId, q.entityId, q.property, {});
        if (result.items.length > 0) {
          this.configStore.syncCollectionItems(q.sourceId, q.property, result.items, Date.now());
        }
      }),
    ).then((results) => {
      const seeded = results.filter((r) => r.status === "fulfilled").length;
      if (seeded > 0) {
        console.log(`[Habitat] Collection cache seeded (${seeded}/${results.length})`);
      }
    });
  }

  /** Get recent events from the ring buffer */
  getRecentEvents(limit = 50): HabitatEvent[] {
    return this.recentEvents.slice(-limit);
  }

  /**
   * Ensure a virtual people adapter and person space exist for location tracking.
   * Creates the adapter, space, source, and source property if missing.
   */
  ensurePersonLocation(personId: string, personName: string): void {
    // 1. Ensure virtual "people" adapter
    if (!this.configStore.getAdapter("people")) {
      this.configStore.createAdapter({
        id: "people",
        type: "people",
        config: {},
      });
    }

    // 2. Ensure space `person:<slug>`
    const slug = personName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const spaceId = `person:${slug}`;
    if (!this.configStore.getSpace(spaceId)) {
      this.configStore.createSpace({
        id: spaceId,
        displayName: personName,
      });
    }

    // 3. Ensure source linking adapter entity to the space
    const entityId = `location:${personId}`;
    const sourceId = `people:${entityId}`;
    if (!this.configStore.getSource(sourceId)) {
      this.configStore.createSource({
        id: sourceId,
        spaceId,
        adapterId: "people",
        entityId,
      });
    }

    // 4. Ensure source property
    const existingProps = this.configStore.listSourceProperties(sourceId);
    if (!existingProps.some((p) => p.property === "location")) {
      this.configStore.setSourceProperty({
        sourceId,
        property: "location",
        role: "primary",
        features: ["geofence"],
      });
    }

    // 5. Reload registry and mark reachable
    this.reload();
    this.registry.setAdapterReachability("people", true);
  }

  /**
   * Update a person's location in the habitat (fires a habitat event).
   */
  updatePersonLocation(personId: string, state: Record<string, unknown>): void {
    const entityId = `location:${personId}`;

    // Find the source for this person
    const spaces = this.registry.getAllSpaces();
    for (const space of spaces) {
      for (const source of space.sources) {
        if (source.adapterId === "people" && source.entityId === entityId) {
          // Get previous state from cache
          const cached = this.configStore.getState(source.id, "location");
          const previousState = cached?.state ?? undefined;
          this.engine.handleStateChange("people", entityId, "location", state, previousState);
          return;
        }
      }
    }
    console.warn(`[Habitat] No source found for person location ${personId}`);
  }
}
