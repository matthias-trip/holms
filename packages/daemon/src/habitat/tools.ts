import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Habitat } from "./habitat.js";
import type { MemoryStore } from "../memory/store.js";
import { SecretStore } from "./secret-store.js";
import type { PropertyName } from "./types.js";
import { getPropertyDomain, getAllPropertyDomains } from "./properties/index.js";

const PROPERTY_NAMES = [
  "illumination", "climate", "occupancy", "access",
  "media", "power", "water", "safety", "air_quality", "schedule", "weather",
] as const;

/** Strip null/undefined values from objects (one level deep for arrays of objects) */
function compactJson(data: unknown): string {
  return JSON.stringify(data, (_key, value) =>
    value === null || value === undefined ? undefined : value,
  );
}

function buildQueryableHints(): string {
  const domains = getAllPropertyDomains().filter((d) => d.queryable);
  if (domains.length === 0) return "";
  const lines = domains.map((d) => {
    const params = Object.entries(d.queryable!.params)
      .map(([k, v]) => `${k}?: ${v.type}${v.description ? ` (${v.description})` : ""}`)
      .join(", ");
    return `- ${d.name}: { ${params} }`;
  });
  return `\n\nQueryable properties and their params:\n${lines.join("\n")}`;
}

export function createHabitatToolsServer(habitat: Habitat, memoryStore: MemoryStore, secretStore?: SecretStore) {
  // ── Core tools ──

  const observe = tool(
    "observe",
    `Observe the current state of spaces and properties. Returns live state from adapters.
- No args: observe everything
- space only: observe all properties in that space
- space + property: observe a specific property in a space
When an adapter is unreachable, returns the last-known cached state (marked with cached: true) instead of an error.
Use this to check current conditions before acting.`,
    {
      space: z.string().optional().describe("Space ID to observe. Omit for all spaces."),
      property: z.enum(PROPERTY_NAMES).optional().describe("Property to observe. Omit for all properties."),
    },
    async (args) => {
      const result = await habitat.engine.observe(
        args.space,
        args.property as PropertyName | undefined,
      );
      return { content: [{ type: "text" as const, text: compactJson(result) }] };
    },
  );

  const influence = tool(
    "influence",
    `Influence a space by sending commands to its sources. This is how you control things.
- target.property: affect all sources of that property in the space
- target.source: affect a specific source
- params: the command parameters (e.g. { on: true, brightness: 80 })

Check capabilities() first to see accepted params and values — adapters may only accept specific values (e.g. discrete fan speed levels).
Before Acting protocol applies: check memories, consider approvals for novel/sensitive actions.`,
    {
      space: z.string().describe("Space ID to influence"),
      target: z.object({
        property: z.enum(PROPERTY_NAMES).optional().describe("Property to target (affects all sources of this property)"),
        source: z.string().optional().describe("Specific source ID to target"),
      }).describe("What to influence — specify property OR source"),
      params: z.record(z.string(), z.unknown()).describe("Command parameters"),
    },
    async (args) => {
      const result = await habitat.engine.influence(
        args.space,
        {
          property: args.target.property as PropertyName | undefined,
          source: args.target.source,
        },
        args.params,
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  const capabilities = tool(
    "capabilities",
    `Get the structural capabilities of spaces — which properties and sources exist, their roles, features, and reachability. Does not query live state (use observe for that). Useful for understanding what you can control. Properties with queryable schemas will include a "queryable" field.`,
    {
      space: z.string().optional().describe("Space ID. Omit for all spaces."),
    },
    async (args) => {
      const result = habitat.engine.capabilities(args.space);
      // Enrich properties with queryable schema and command hints
      const enriched = {
        ...result,
        spaces: result.spaces.map((sp) => ({
          ...sp,
          properties: sp.properties.map((prop) => {
            const domain = getPropertyDomain(prop.property);
            const enrichedProp: Record<string, unknown> = { ...prop };

            if (domain?.queryable) {
              enrichedProp.queryable = domain.queryable;
            }

            // Merge domain-level commandFields with per-source adapter commandHints
            const domainFields = domain?.commandFields;
            if (domainFields && Object.keys(domainFields).length > 0) {
              enrichedProp.sources = prop.sources.map((src) => {
                // Start with domain defaults, overlay adapter-specific hints
                const merged = { ...domainFields, ...(src.commandHints ?? {}) };
                const { commandHints: _, ...rest } = src;
                return { ...rest, commandHints: merged };
              });
            }

            return enrichedProp;
          }),
        })),
      };
      return { content: [{ type: "text" as const, text: compactJson(enriched) }] };
    },
  );

  const events = tool(
    "events",
    `Get recent habitat events (state changes from adapters). Useful for understanding what has been happening.`,
    {
      limit: z.number().optional().default(20).describe("Max events to return (default 20, max 100)"),
    },
    async (args) => {
      const result = habitat.getRecentEvents(Math.min(args.limit, 100));
      return { content: [{ type: "text" as const, text: compactJson(result) }] };
    },
  );

  const query = tool(
    "query",
    `Query a property for collection data (e.g. calendar events in a time range, forecast data).
Not all properties support queries — use capabilities to check which properties have queryable schemas.
Only use the documented params listed below — unknown params are ignored by adapters.
Results are automatically persisted for later reference.${buildQueryableHints()}`,
    {
      space: z.string().describe("Space ID to query"),
      target: z.object({
        property: z.enum(PROPERTY_NAMES).optional().describe("Property to query"),
        source: z.string().optional().describe("Specific source ID to query"),
      }).describe("What to query — specify property OR source"),
      params: z.record(z.string(), z.unknown()).describe("Query parameters — see tool description for valid params per property"),
    },
    async (args) => {
      try {
        // Validate params against the property domain's queryable schema
        const propName = args.target.property as PropertyName | undefined;
        if (propName) {
          const domain = getPropertyDomain(propName);
          if (domain?.queryable) {
            const validKeys = new Set(Object.keys(domain.queryable.params));
            const unknownKeys = Object.keys(args.params).filter((k) => !validKeys.has(k));
            if (unknownKeys.length > 0) {
              return {
                content: [{
                  type: "text" as const,
                  text: JSON.stringify({
                    error: `Unknown query params: ${unknownKeys.join(", ")}. Valid params for "${propName}": ${[...validKeys].join(", ")}`,
                  }),
                }],
              };
            }
          }
        }

        const result = await habitat.engine.query(
          args.space,
          {
            property: propName,
            source: args.target.source,
          },
          args.params,
        );
        return { content: [{ type: "text" as const, text: compactJson(result) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }] };
      }
    },
  );

  // ── Adapter management tools ──

  const adaptersList = tool(
    "adapters_list",
    `List all configured adapters with their health status, entity count, and configuration.`,
    {},
    async () => {
      const configs = habitat.configStore.listAdapters();
      const health = habitat.supervisor.getHealth();
      const healthMap = new Map(health.map((h) => [h.id, h]));

      const result = configs.map((c) => {
        // Redact secret refs so the agent can't leak them via reasoning
        const redactedConfig: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(c.config)) {
          redactedConfig[k] = SecretStore.isRef(v) ? "[encrypted]" : v;
        }
        return {
          ...c,
          config: redactedConfig,
          health: healthMap.get(c.id) ?? { status: "stopped", entityCount: 0, restartCount: 0 },
        };
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  const adaptersConfigure = tool(
    "adapters_configure",
    `Create or update an adapter's configuration. If the adapter exists, updates its config and restarts it. If new, creates and starts it. Stops any onboarding process for this adapter type.`,
    {
      id: z.string().describe("Adapter ID"),
      type: z.string().describe("Adapter type (e.g. 'hue')"),
      displayName: z.string().optional().describe("Human-readable display name (e.g. 'Hue Bridge - Living Room')"),
      config: z.record(z.string(), z.unknown()).optional().default({}).describe("Adapter configuration"),
    },
    async (args) => {
      const existing = habitat.configStore.getAdapter(args.id);
      if (existing) {
        habitat.configStore.updateAdapter(args.id, { type: args.type, displayName: args.displayName, config: args.config });
        await habitat.supervisor.stopAdapter(args.id);
      } else {
        habitat.configStore.createAdapter({ id: args.id, type: args.type, displayName: args.displayName, config: args.config });
      }

      // Stop onboarding process for this type if running
      await habitat.supervisor.stopOnboardingAdapter(args.type);

      await habitat.supervisor.startAdapter({ id: args.id, type: args.type, displayName: args.displayName, config: args.config });
      habitat.reload();
      return { content: [{ type: "text" as const, text: `Adapter "${args.id}" configured and started.` }] };
    },
  );

  const adaptersDiscover = tool(
    "adapters_discover",
    `Trigger entity discovery on an adapter. Returns entities the adapter has registered, showing what can be assigned to spaces. Also returns any groups (rooms, zones, areas) reported by the adapter — use these to auto-suggest space names and entity assignments.`,
    {
      adapterId: z.string().describe("Adapter ID to discover entities on"),
    },
    async (args) => {
      const health = habitat.supervisor.getAdapterHealth(args.adapterId);
      if (!health || health.status !== "running") {
        return { content: [{ type: "text" as const, text: `Adapter "${args.adapterId}" is not running.` }] };
      }

      // Return all entities registered by the adapter (from boot time)
      const entities = habitat.supervisor.getAdapterEntities(args.adapterId).map((e) => ({
        entityId: e.entityId,
        ...(e.displayName ? { displayName: e.displayName } : {}),
        properties: e.properties.map((p) => ({ property: p.property, features: p.features })),
      }));

      // Also show which are already assigned to spaces
      const allSpaces = habitat.registry.getAllSpaces();
      const assignedSources = allSpaces.flatMap((s) =>
        s.sources.filter((src) => src.adapterId === args.adapterId).map((src) => ({
          sourceId: src.id,
          spaceId: s.id,
          entityId: src.entityId,
          properties: src.properties.map((p) => ({
            property: p.property,
            features: p.features,
          })),
        })),
      );

      const groups = habitat.supervisor.getAdapterGroups(args.adapterId);

      const result: Record<string, unknown> = { adapterId: args.adapterId, entityCount: health.entityCount, entities, assignedSources };
      if (groups.length > 0) {
        result.groups = groups;
      }

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  const adaptersStatus = tool(
    "adapters_status",
    `Get detailed health status for one or all adapters.`,
    {
      adapterId: z.string().optional().describe("Specific adapter ID. Omit for all."),
    },
    async (args) => {
      if (args.adapterId) {
        const health = habitat.supervisor.getAdapterHealth(args.adapterId);
        return { content: [{ type: "text" as const, text: JSON.stringify(health ?? { error: "not found" }, null, 2) }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(habitat.supervisor.getHealth(), null, 2) }] };
    },
  );

  const adaptersDiscoverGateways = tool(
    "adapters_discover_gateways",
    `Discover gateways/bridges/hubs on the local network for a given adapter type. Starts a temporary onboarding adapter process if needed. Use this before pairing to find available devices. Not all adapter types support discovery — some only need manual configuration.`,
    {
      type: z.string().describe("Adapter type (e.g. 'hue')"),
      params: z.record(z.string(), z.unknown()).optional().default({}).describe("Optional discovery parameters (e.g. timeout)"),
    },
    async (args) => {
      const registry = habitat.supervisor.getRegistry();
      const setup = registry.getSetup(args.type);
      if (!setup?.discover) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Adapter type "${args.type}" does not support gateway discovery. Configure it directly with adapters_configure.` }) }] };
      }

      // Start onboarding adapter if not running
      if (!habitat.supervisor.hasOnboardingAdapter(args.type)) {
        await habitat.supervisor.startOnboardingAdapter(args.type);
      }

      const onboardingId = `__onboarding_${args.type}`;
      try {
        const result = await habitat.supervisor.discover(onboardingId, args.params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }] };
      }
    },
  );

  const adaptersPair = tool(
    "adapters_pair",
    `Pair/authenticate with a gateway or bridge for a given adapter type. Typically requires user interaction (e.g. pressing a button on the device). Returns credentials on success that should be passed to adapters_configure. Not all adapter types support pairing — some only need manual configuration.`,
    {
      type: z.string().describe("Adapter type (e.g. 'hue')"),
      address: z.string().describe("IP address or hostname of the gateway/bridge to pair with"),
      params: z.record(z.string(), z.unknown()).optional().default({}).describe("Additional adapter-specific pairing parameters"),
    },
    async (args) => {
      const registry = habitat.supervisor.getRegistry();
      const setup = registry.getSetup(args.type);
      if (!setup?.pair) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Adapter type "${args.type}" does not support pairing. Configure it directly with adapters_configure.` }) }] };
      }

      // Start onboarding adapter if not running
      if (!habitat.supervisor.hasOnboardingAdapter(args.type)) {
        await habitat.supervisor.startOnboardingAdapter(args.type);
      }

      const onboardingId = `__onboarding_${args.type}`;
      try {
        const result = await habitat.supervisor.pair(onboardingId, { address: args.address, ...args.params });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }] };
      }
    },
  );

  // ── Space management tools ──

  const spacesList = tool(
    "spaces_list",
    `List all spaces with their assigned sources and properties.`,
    {},
    async () => {
      const result = habitat.engine.capabilities();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  const spacesCreate = tool(
    "spaces_create",
    `Create one or more spaces. A space represents a physical area (room, zone, etc.) that contains sources. You must create a space before assigning sources to it. Accepts an array — batch all spaces into a single call during setup. Skips already-existing spaces.`,
    {
      spaces: z.array(z.object({
        id: z.string().describe("Space ID (slug, e.g. 'living-room', 'oprit', 'garage')"),
        displayName: z.string().describe("Human-readable name (e.g. 'Living Room', 'Oprit', 'Garage')"),
        floor: z.string().optional().describe("Floor name (e.g. 'Ground Floor', 'First Floor')"),
      })).describe("Spaces to create"),
    },
    async (args) => {
      const created: string[] = [];
      const skipped: string[] = [];
      for (const space of args.spaces) {
        if (habitat.configStore.getSpace(space.id)) {
          skipped.push(space.id);
        } else {
          habitat.configStore.createSpace({ id: space.id, displayName: space.displayName, floor: space.floor });
          created.push(space.id);
        }
      }
      if (created.length > 0) habitat.reload();
      const parts: string[] = [`Created ${created.length} space(s).`];
      if (skipped.length > 0) parts.push(`Skipped ${skipped.length} already existing: ${skipped.join(", ")}.`);
      return { content: [{ type: "text" as const, text: parts.join(" ") }] };
    },
  );

  const spacesAssign = tool(
    "spaces_assign",
    `Assign one or more adapter entities to spaces as sources. Creates sources and their property mappings. Spaces must already exist — use spaces_create first if needed. Accepts an array — batch all assignments into a single call during setup.`,
    {
      assignments: z.array(z.object({
        spaceId: z.string().describe("Space ID to assign to (must already exist)"),
        sourceId: z.string().describe("Source ID (your choice, e.g. 'living-room-ceiling-light')"),
        adapterId: z.string().describe("Adapter ID the entity belongs to"),
        entityId: z.string().describe("Entity ID within the adapter"),
        properties: z.array(z.object({
          property: z.enum(PROPERTY_NAMES).describe("Property domain"),
          role: z.string().describe("Role within the property (e.g. 'primary', 'ambient', 'sensor')"),
          mounting: z.string().optional().describe("Physical mounting (e.g. 'ceiling', 'wall', 'desk')"),
          features: z.array(z.string()).optional().default([]).describe("Feature list (e.g. ['dimmable', 'color_temp'])"),
        })).describe("Property mappings for this source"),
      })).describe("Assignments to create"),
    },
    async (args) => {
      const results: Record<string, number> = {};
      for (const a of args.assignments) {
        habitat.configStore.createSource({
          id: a.sourceId,
          spaceId: a.spaceId,
          adapterId: a.adapterId,
          entityId: a.entityId,
        });
        for (const prop of a.properties) {
          habitat.configStore.setSourceProperty({
            sourceId: a.sourceId,
            property: prop.property as PropertyName,
            role: prop.role,
            mounting: prop.mounting,
            features: prop.features,
          });
        }
        results[a.spaceId] = (results[a.spaceId] ?? 0) + 1;
      }
      if (args.assignments.length > 0) habitat.reload();
      const summary = Object.entries(results).map(([space, count]) => `${space}: ${count}`).join(", ");
      return { content: [{ type: "text" as const, text: `Assigned ${args.assignments.length} source(s). By space: ${summary}.` }] };
    },
  );

  const spacesUpdate = tool(
    "spaces_update",
    `Update an existing space — rename it or change its floor.`,
    {
      id: z.string().describe("Space ID to update"),
      displayName: z.string().optional().describe("New display name"),
      floor: z.string().optional().describe("New floor name"),
    },
    async (args) => {
      const existing = habitat.configStore.getSpace(args.id);
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Space "${args.id}" not found.` }] };
      }
      const updates: Record<string, string | undefined> = {};
      if (args.displayName !== undefined) updates.displayName = args.displayName;
      if (args.floor !== undefined) updates.floor = args.floor;
      habitat.configStore.updateSpace(args.id, updates);
      habitat.reload();
      return { content: [{ type: "text" as const, text: `Space "${args.id}" updated.` }] };
    },
  );

  const spacesDelete = tool(
    "spaces_delete",
    `Delete a space and all its sources (cascades). Use with care — all source assignments in this space will be removed.`,
    {
      id: z.string().describe("Space ID to delete"),
    },
    async (args) => {
      const existing = habitat.configStore.getSpace(args.id);
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Space "${args.id}" not found.` }] };
      }
      habitat.configStore.deleteSpace(args.id);
      habitat.reload();
      return { content: [{ type: "text" as const, text: `Space "${args.id}" and all its sources deleted.` }] };
    },
  );

  const spacesUnassign = tool(
    "spaces_unassign",
    `Remove a source from its space, deleting its property mappings.`,
    {
      sourceId: z.string().describe("Source ID to remove"),
    },
    async (args) => {
      habitat.configStore.deleteSource(args.sourceId);
      habitat.reload();
      return { content: [{ type: "text" as const, text: `Source "${args.sourceId}" unassigned.` }] };
    },
  );

  const adaptersRemove = tool(
    "adapters_remove",
    `Stop and delete an adapter instance. Removes its configuration — sources assigned from this adapter will become unreachable.`,
    {
      adapterId: z.string().describe("Adapter ID to remove"),
    },
    async (args) => {
      const existing = habitat.configStore.getAdapter(args.adapterId);
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Adapter "${args.adapterId}" not found.` }] };
      }
      // Clean up any secrets referenced in the adapter config
      if (secretStore) {
        secretStore.deleteForConfig(existing.config);
      }
      await habitat.supervisor.stopAdapter(args.adapterId);
      habitat.configStore.deleteAdapter(args.adapterId);
      habitat.reload();
      return { content: [{ type: "text" as const, text: `Adapter "${args.adapterId}" stopped and removed.` }] };
    },
  );

  const sourcesUpdateProperty = tool(
    "sources_update_property",
    `Update role, mounting, or features on a source's property mapping. Merges with existing values — only specified fields are changed.`,
    {
      sourceId: z.string().describe("Source ID"),
      property: z.enum(PROPERTY_NAMES).describe("Property to update"),
      role: z.string().optional().describe("New role (e.g. 'primary', 'ambient', 'sensor')"),
      mounting: z.string().optional().describe("New mounting (e.g. 'ceiling', 'wall', 'desk')"),
      features: z.array(z.string()).optional().describe("New feature list (replaces existing)"),
    },
    async (args) => {
      // Read current property to merge
      const caps = habitat.engine.capabilities();
      let currentProp: { role: string; mounting?: string; features: string[] } | undefined;
      for (const space of caps.spaces) {
        for (const prop of space.properties) {
          if (prop.property === args.property) {
            const src = prop.sources.find((s) => s.source === args.sourceId);
            if (src) {
              currentProp = { role: src.role, mounting: src.mounting, features: src.features };
              break;
            }
          }
        }
        if (currentProp) break;
      }

      if (!currentProp) {
        return { content: [{ type: "text" as const, text: `No "${args.property}" property found on source "${args.sourceId}".` }] };
      }

      habitat.configStore.setSourceProperty({
        sourceId: args.sourceId,
        property: args.property as PropertyName,
        role: args.role ?? currentProp.role,
        mounting: args.mounting ?? currentProp.mounting,
        features: args.features ?? currentProp.features,
      });
      habitat.reload();
      return { content: [{ type: "text" as const, text: `Property "${args.property}" on source "${args.sourceId}" updated.` }] };
    },
  );

  const sourcesRemoveProperty = tool(
    "sources_remove_property",
    `Remove a property mapping from a source. The source remains assigned to its space but loses this property.`,
    {
      sourceId: z.string().describe("Source ID"),
      property: z.enum(PROPERTY_NAMES).describe("Property to remove"),
    },
    async (args) => {
      habitat.configStore.deleteSourceProperty(args.sourceId, args.property as PropertyName);
      habitat.reload();
      return { content: [{ type: "text" as const, text: `Property "${args.property}" removed from source "${args.sourceId}".` }] };
    },
  );

  return createSdkMcpServer({
    name: "habitat",
    version: "1.0.0",
    tools: [
      observe, influence, capabilities, query, events,
      adaptersList, adaptersConfigure, adaptersDiscover, adaptersStatus, adaptersRemove,
      adaptersDiscoverGateways, adaptersPair,
      spacesList, spacesCreate, spacesUpdate, spacesDelete, spacesAssign, spacesUnassign,
      sourcesUpdateProperty, sourcesRemoveProperty,
    ],
  });
}
