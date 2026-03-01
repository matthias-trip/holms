import type { PropertyDomain } from "./index.js";

export const schedule: PropertyDomain = {
  name: "schedule",
  displayName: "Schedule",
  stateFields: {
    active: { type: "boolean", description: "Whether any event is happening right now" },
    current_event: { type: "object", description: "Currently active event (if any)" },
    next_event: { type: "object", description: "Next upcoming event" },
    event_count: { type: "number", description: "Total number of events in the calendar" },
  },
  commandFields: {
    create_event: { type: "object", description: "Create a new event: { summary, start, end, description?, location?, all_day? }" },
    update_event: { type: "object", description: "Update an event: { uid, summary?, start?, end?, description?, location? }" },
    delete_event: { type: "object", description: "Delete an event: { uid }" },
  },
  features: [
    "events",
    "recurring",
    "reminders",
    "create",
    "update",
    "delete",
  ],
  roles: ["calendar", "booking", "availability"],
  queryable: {
    params: {
      from: { type: "number", description: "Start of time range (epoch ms)" },
      to: { type: "number", description: "End of time range (epoch ms)" },
    },
    itemFields: {
      uid: { type: "string", description: "Unique event identifier" },
      summary: { type: "string", description: "Event title" },
      description: { type: "string", description: "Event description" },
      location: { type: "string", description: "Event location" },
      start: { type: "number", description: "Start time (epoch ms)" },
      end: { type: "number", description: "End time (epoch ms)" },
      all_day: { type: "boolean", description: "Whether this is an all-day event" },
      recurring: { type: "boolean", description: "Whether this is a recurring event" },
    },
    description: "Query calendar events within a time range",
  },
};
