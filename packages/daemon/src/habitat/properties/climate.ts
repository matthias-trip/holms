import type { PropertyDomain } from "./index.js";

export const climate: PropertyDomain = {
  name: "climate",
  displayName: "Climate",
  stateFields: {
    current_temp: { type: "number", description: "Current temperature in C" },
    target_temp: { type: "number", description: "Target temperature in C" },
    humidity: { type: "number", description: "Relative humidity %", min: 0, max: 100 },
    mode: { type: "string", description: "HVAC mode: heat, cool, auto, off" },
    fan_mode: { type: "string", description: "Fan speed: auto, low, medium, high" },
  },
  commandFields: {
    target_temp: { type: "number" },
    mode: { type: "string" },
    fan_mode: { type: "string" },
  },
  features: ["heating", "cooling", "fan", "humidity_sensing", "thermostat"],
  roles: ["primary", "supplementary", "sensor"],
};
