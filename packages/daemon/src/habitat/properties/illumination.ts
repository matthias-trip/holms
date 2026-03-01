import type { PropertyDomain } from "./index.js";

export const illumination: PropertyDomain = {
  name: "illumination",
  displayName: "Illumination",
  stateFields: {
    on: { type: "boolean", description: "Whether the light is on" },
    brightness: {
      type: "number",
      description: "Brightness level 0-100",
      min: 0,
      max: 100,
    },
    color_temp: {
      type: "number",
      description: "Color temperature in mireds",
      min: 153,
      max: 500,
    },
    color: {
      type: "object",
      description: "Color as {h, s} (hue 0-360, saturation 0-100)",
    },
  },
  commandFields: {
    on: { type: "boolean" },
    brightness: { type: "number", min: 0, max: 100 },
    color_temp: { type: "number", min: 153, max: 500 },
    color: { type: "object" },
    transition: {
      type: "number",
      description: "Transition time in seconds",
      min: 0,
    },
  },
  features: [
    "dimmable",
    "color_temp",
    "color",
    "effect",
  ],
  roles: ["primary", "ambient", "accent", "task", "night_light"],
};
