import type { PropertyDomain } from "./index.js";

export const media: PropertyDomain = {
  name: "media",
  displayName: "Media",
  stateFields: {
    playing: { type: "boolean", description: "Whether media is playing" },
    volume: { type: "number", description: "Volume 0-100", min: 0, max: 100 },
    muted: { type: "boolean", description: "Whether audio is muted" },
    source: { type: "string", description: "Current media source" },
    title: { type: "string", description: "Current media title" },
    artist: { type: "string", description: "Current artist" },
  },
  commandFields: {
    playing: { type: "boolean" },
    volume: { type: "number", min: 0, max: 100 },
    muted: { type: "boolean" },
    source: { type: "string" },
  },
  features: ["playback", "volume", "source_select", "grouping"],
  roles: ["speaker", "tv", "receiver", "soundbar"],
};
