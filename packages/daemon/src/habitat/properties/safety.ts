import type { PropertyDomain } from "./index.js";

export const safety: PropertyDomain = {
  name: "safety",
  displayName: "Safety",
  stateFields: {
    triggered: { type: "boolean", description: "Whether the alarm is triggered" },
    smoke_detected: { type: "boolean", description: "Smoke sensor status" },
    co_detected: { type: "boolean", description: "Carbon monoxide detected" },
    battery_level: { type: "number", description: "Battery level 0-100", min: 0, max: 100 },
  },
  commandFields: {
    silence: { type: "boolean", description: "Silence the alarm" },
    test: { type: "boolean", description: "Trigger a test alarm" },
  },
  features: ["smoke", "co", "heat", "siren", "battery_monitoring"],
  roles: ["smoke_detector", "co_detector", "siren", "combined"],
};
