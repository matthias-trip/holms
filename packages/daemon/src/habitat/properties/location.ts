import type { PropertyDomain } from "./index.js";

export const location: PropertyDomain = {
  name: "location",
  displayName: "Location",
  stateFields: {
    zone_id: { type: "string", description: "Current zone ID (null if outside all known zones)" },
    zone_name: { type: "string", description: "Current zone name ('Unknown' if outside all zones)" },
    event: { type: "string", description: "Last transition type", values: ["enter", "exit"] },
    since: { type: "number", description: "Timestamp of last transition" },
  },
  commandFields: {},
  features: ["geofence"],
  roles: ["primary"],
};
