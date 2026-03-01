import type { PropertyDomain } from "./index.js";

export const access: PropertyDomain = {
  name: "access",
  displayName: "Access",
  stateFields: {
    locked: { type: "boolean", description: "Whether the lock is engaged" },
    open: { type: "boolean", description: "Whether the door/window is open" },
    position: { type: "number", description: "Cover position 0-100", min: 0, max: 100 },
  },
  commandFields: {
    locked: { type: "boolean" },
    open: { type: "boolean" },
    position: { type: "number", min: 0, max: 100 },
  },
  features: ["lock", "contact", "cover", "tilt"],
  roles: ["door", "window", "gate", "blind", "curtain"],
};
