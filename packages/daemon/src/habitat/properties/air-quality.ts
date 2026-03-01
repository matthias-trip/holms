import type { PropertyDomain } from "./index.js";

export const airQuality: PropertyDomain = {
  name: "air_quality",
  displayName: "Air Quality",
  stateFields: {
    co2: { type: "number", description: "CO2 level in ppm" },
    pm25: { type: "number", description: "PM2.5 in ug/m3" },
    pm10: { type: "number", description: "PM10 in ug/m3" },
    voc: { type: "number", description: "VOC index" },
    aqi: { type: "number", description: "Air quality index" },
    fan_on: { type: "boolean", description: "Whether the purifier fan is on" },
    fan_speed: { type: "number", description: "Fan speed 0-100", min: 0, max: 100 },
  },
  commandFields: {
    fan_on: { type: "boolean" },
    fan_speed: { type: "number", min: 0, max: 100 },
    mode: { type: "string", description: "auto, manual, sleep" },
  },
  features: ["co2_sensing", "pm_sensing", "voc_sensing", "purification"],
  roles: ["sensor", "purifier", "ventilation"],
};
