import type { PropertyDomain } from "./index.js";

export const water: PropertyDomain = {
  name: "water",
  displayName: "Water",
  stateFields: {
    flow_rate: { type: "number", description: "Current flow in liters/min" },
    total_consumption: { type: "number", description: "Total consumption in liters" },
    leak_detected: { type: "boolean", description: "Whether a leak is detected" },
    valve_open: { type: "boolean", description: "Whether the valve is open" },
    temperature: { type: "number", description: "Water temperature in C" },
  },
  commandFields: {
    valve_open: { type: "boolean" },
  },
  features: ["flow_sensing", "leak_detection", "valve_control", "temp_sensing"],
  roles: ["main_valve", "irrigation", "sensor", "heater"],
};
