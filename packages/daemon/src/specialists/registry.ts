import type { SpecialistDomain } from "@holms/shared";

export interface SpecialistDefinition {
  name: SpecialistDomain;
  description: string;
}

export class SpecialistRegistry {
  private specialists = new Map<SpecialistDomain, SpecialistDefinition>();

  register(specialist: SpecialistDefinition): void {
    this.specialists.set(specialist.name, specialist);
    console.log(`[SpecialistRegistry] Registered specialist: ${specialist.name}`);
  }

  get(name: SpecialistDomain): SpecialistDefinition | undefined {
    return this.specialists.get(name);
  }

  getAll(): SpecialistDefinition[] {
    return Array.from(this.specialists.values());
  }

  getDomains(): SpecialistDomain[] {
    return Array.from(this.specialists.keys());
  }

  toPromptDescription(): string {
    return this.getAll()
      .map((s) => `- **${s.name}**: ${s.description}`)
      .join("\n");
  }
}

export function registerDefaultSpecialists(registry: SpecialistRegistry): void {
  registry.register({
    name: "lighting",
    description:
      "Manages lighting decisions: brightness, scenes, color temperature, time-of-day adjustments, energy-efficient light usage.",
  });

  registry.register({
    name: "presence",
    description:
      "Handles occupancy detection, security, motion patterns, lock management, arrival/departure routines.",
  });

  registry.register({
    name: "electricity",
    description:
      "Optimizes energy efficiency, thermostat scheduling, cost optimization, power management for switches and appliances.",
  });
}
