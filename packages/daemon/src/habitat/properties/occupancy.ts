import type { PropertyDomain } from "./index.js";

export const occupancy: PropertyDomain = {
  name: "occupancy",
  displayName: "Occupancy",
  stateFields: {
    occupied: { type: "boolean", description: "Whether space is occupied" },
    count: { type: "number", description: "Number of people detected" },
    last_motion: { type: "number", description: "Timestamp of last motion" },
  },
  commandFields: {},
  features: ["motion", "presence", "count", "face_recognition"],
  roles: ["detector", "camera", "pressure_mat"],
};
