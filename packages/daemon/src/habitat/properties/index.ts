import type { PropertyName } from "../types.js";
import { illumination } from "./illumination.js";
import { climate } from "./climate.js";
import { occupancy } from "./occupancy.js";
import { access } from "./access.js";
import { media } from "./media.js";
import { power } from "./power.js";
import { water } from "./water.js";
import { safety } from "./safety.js";
import { airQuality } from "./air-quality.js";
import { schedule } from "./schedule.js";
import { weather } from "./weather.js";

export interface FieldDef {
  type: "boolean" | "number" | "string" | "object";
  description?: string;
  values?: (number | string)[];
  min?: number;
  max?: number;
}

export interface QueryableDef {
  params: Record<string, FieldDef>;
  itemFields: Record<string, FieldDef>;
  description?: string;
}

export interface PropertyDomain {
  name: PropertyName;
  displayName: string;
  stateFields: Record<string, FieldDef>;
  commandFields: Record<string, FieldDef>;
  features: string[];
  roles: string[];
  queryable?: QueryableDef;
}

const domains: Record<PropertyName, PropertyDomain> = {
  illumination,
  climate,
  occupancy,
  access,
  media,
  power,
  water,
  safety,
  air_quality: airQuality,
  schedule,
  weather,
};

export function getPropertyDomain(name: PropertyName): PropertyDomain | undefined {
  return domains[name];
}

export function getAllPropertyDomains(): PropertyDomain[] {
  return Object.values(domains);
}

export { illumination, climate, occupancy, access, media, power, water, safety, airQuality, schedule, weather };
