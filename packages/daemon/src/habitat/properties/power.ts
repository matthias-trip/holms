import type { PropertyDomain } from "./index.js";

export const power: PropertyDomain = {
  name: "power",
  displayName: "Power",
  stateFields: {
    on: { type: "boolean", description: "Whether the outlet/switch is on" },
    watts: { type: "number", description: "Current power draw in watts" },
    kwh: { type: "number", description: "Total energy consumed in kWh" },
    voltage: { type: "number", description: "Current voltage" },
    current: { type: "number", description: "Current amperage" },
  },
  commandFields: {
    on: { type: "boolean" },
  },
  features: ["switch", "power_monitoring", "energy_tracking"],
  roles: ["outlet", "switch", "meter", "circuit"],
};
