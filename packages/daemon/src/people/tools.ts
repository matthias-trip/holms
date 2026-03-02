import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { PeopleStore } from "./store.js";

export function createPeopleToolsServer(store: PeopleStore) {
  const listPeople = tool(
    "list_people",
    "List all household members with their linked channels.",
    {},
    async () => {
      const people = store.getAll();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(people, null, 2) }],
      };
    },
  );

  const createPerson = tool(
    "create_person",
    "Register a new household member. Use primary_channel to set their preferred notification channel (a conversationId like 'whatsapp:31612345678@s.whatsapp.net').",
    {
      name: z.string().describe("Person's name"),
      primary_channel: z.string().optional().describe("ConversationId for notifications"),
    },
    async (args) => {
      const person = store.create(args.name, args.primary_channel);
      return {
        content: [{ type: "text" as const, text: `Created person "${person.name}" (${person.id})` }],
      };
    },
  );

  const updatePerson = tool(
    "update_person",
    "Update a person's identity fields (name or primary notification channel).",
    {
      person_id: z.string().describe("Person ID"),
      name: z.string().optional().describe("New name"),
      primary_channel: z.string().optional().describe("New primary notification channel"),
    },
    async (args) => {
      const person = store.update(args.person_id, {
        name: args.name,
        primaryChannel: args.primary_channel,
      });
      if (!person) {
        return { content: [{ type: "text" as const, text: `Person ${args.person_id} not found` }] };
      }
      return {
        content: [{ type: "text" as const, text: `Updated person "${person.name}" (${person.id})` }],
      };
    },
  );

  const removePerson = tool(
    "remove_person",
    "Unregister a household member. Cascades to remove their channel links.",
    {
      person_id: z.string().describe("Person ID"),
    },
    async (args) => {
      const removed = store.remove(args.person_id);
      return {
        content: [{
          type: "text" as const,
          text: removed ? `Removed person ${args.person_id}` : `Person ${args.person_id} not found`,
        }],
      };
    },
  );

  const linkPersonChannel = tool(
    "link_person_channel",
    "Associate a channel (conversation) with a person for auto-identification. When a message arrives on this channel or from this sender, the system will identify the person automatically.",
    {
      person_id: z.string().describe("Person ID"),
      channel_id: z.string().describe("ConversationId to link (e.g. 'whatsapp:31612345678@s.whatsapp.net')"),
      sender_id: z.string().optional().describe("Raw senderId from the channel provider (for multi-user channels)"),
    },
    async (args) => {
      const person = store.get(args.person_id);
      if (!person) {
        return { content: [{ type: "text" as const, text: `Person ${args.person_id} not found` }] };
      }
      store.linkChannel(args.person_id, args.channel_id, args.sender_id);
      return {
        content: [{ type: "text" as const, text: `Linked channel ${args.channel_id} to "${person.name}"` }],
      };
    },
  );

  const unlinkPersonChannel = tool(
    "unlink_person_channel",
    "Remove a channel association from a person. The channel will no longer auto-identify this person.",
    {
      person_id: z.string().describe("Person ID"),
      channel_id: z.string().describe("ConversationId to unlink"),
    },
    async (args) => {
      const person = store.get(args.person_id);
      if (!person) {
        return { content: [{ type: "text" as const, text: `Person ${args.person_id} not found` }] };
      }
      store.unlinkChannel(args.person_id, args.channel_id);
      return {
        content: [{ type: "text" as const, text: `Unlinked channel ${args.channel_id} from "${person.name}"` }],
      };
    },
  );

  // ── Zone Tools ──────────────────────────────────────────────────────

  const listZones = tool(
    "list_zones",
    "List all known location zones (e.g. Home, Work). These are geofenced areas tracked by household members' devices. Zone enter/exit events update each person's location.",
    {},
    async () => {
      const zones = store.getZones();
      return { content: [{ type: "text" as const, text: JSON.stringify(zones, null, 2) }] };
    },
  );

  const createZone = tool(
    "create_zone",
    "Define a new geofenced location zone. The user's devices will automatically monitor this zone and report enter/exit events. Use when a user mentions a new place they want tracked (e.g. 'add my office as a zone').",
    {
      name: z.string().describe("Zone name (e.g. 'Home', 'Work', 'Gym')"),
      latitude: z.number().describe("Latitude of the zone center"),
      longitude: z.number().describe("Longitude of the zone center"),
      radius_meters: z.number().optional().describe("Geofence radius in meters (default 100)"),
    },
    async (args) => {
      const zone = store.createZone(args.name, args.latitude, args.longitude, args.radius_meters);
      return { content: [{ type: "text" as const, text: `Created zone "${zone.name}" (${zone.id})` }] };
    },
  );

  const updateZone = tool(
    "update_zone",
    "Update an existing location zone's name, coordinates, or radius.",
    {
      zone_id: z.string().describe("Zone ID"),
      name: z.string().optional().describe("New name"),
      latitude: z.number().optional().describe("New latitude"),
      longitude: z.number().optional().describe("New longitude"),
      radius_meters: z.number().optional().describe("New radius in meters"),
    },
    async (args) => {
      const zone = store.updateZone(args.zone_id, {
        name: args.name,
        latitude: args.latitude,
        longitude: args.longitude,
        radiusMeters: args.radius_meters,
      });
      if (!zone) return { content: [{ type: "text" as const, text: `Zone ${args.zone_id} not found` }] };
      return { content: [{ type: "text" as const, text: `Updated zone "${zone.name}" (${zone.id})` }] };
    },
  );

  const removeZone = tool(
    "remove_zone",
    "Delete a location zone. Devices will stop monitoring this zone.",
    {
      zone_id: z.string().describe("Zone ID"),
    },
    async (args) => {
      const removed = store.removeZone(args.zone_id);
      return {
        content: [{
          type: "text" as const,
          text: removed ? `Removed zone ${args.zone_id}` : `Zone ${args.zone_id} not found`,
        }],
      };
    },
  );

  // ── Location Tools ─────────────────────────────────────────────────

  const personLocation = tool(
    "person_location",
    "Get a person's current location zone and recent transition history. Returns which known zone they're in (or 'Unknown' if outside all zones), plus the last N transitions with timestamps. Use this to answer questions like 'where is [person]?' or 'when did [person] get home?'",
    {
      person_id: z.string().describe("Person ID"),
      history_limit: z.number().optional().describe("Number of recent transitions to include (default 10)"),
    },
    async (args) => {
      const person = store.get(args.person_id);
      if (!person) return { content: [{ type: "text" as const, text: `Person ${args.person_id} not found` }] };
      const current = store.getCurrentLocation(args.person_id);
      const history = store.getLocationHistory(args.person_id, { limit: args.history_limit ?? 10 });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ person: person.name, current, recentHistory: history }, null, 2),
        }],
      };
    },
  );

  const personLocationHistory = tool(
    "person_location_history",
    "Query detailed zone transition history for a person. Supports time-range filtering. Use for questions like 'how often was [person] at work this week?' or 'what time did [person] leave home yesterday?'",
    {
      person_id: z.string().describe("Person ID"),
      limit: z.number().optional().describe("Max results (default 50)"),
      since: z.number().optional().describe("Start timestamp (epoch ms)"),
      until: z.number().optional().describe("End timestamp (epoch ms)"),
    },
    async (args) => {
      const history = store.getLocationHistory(args.person_id, {
        limit: args.limit,
        since: args.since,
        until: args.until,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(history, null, 2) }] };
    },
  );

  return createSdkMcpServer({
    name: "people",
    version: "2.0.0",
    tools: [
      listPeople, createPerson, updatePerson, removePerson,
      linkPersonChannel, unlinkPersonChannel,
      listZones, createZone, updateZone, removeZone,
      personLocation, personLocationHistory,
    ],
  });
}
