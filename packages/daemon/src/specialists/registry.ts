export interface SpecialistDefinition {
  name: string;
  description: string;
  systemPrompt: string;
}

export class SpecialistRegistry {
  private specialists = new Map<string, SpecialistDefinition>();

  register(specialist: SpecialistDefinition): void {
    this.specialists.set(specialist.name, specialist);
    console.log(`[SpecialistRegistry] Registered specialist: ${specialist.name}`);
  }

  get(name: string): SpecialistDefinition | undefined {
    return this.specialists.get(name);
  }

  getAll(): SpecialistDefinition[] {
    return Array.from(this.specialists.values());
  }

  toAgentDefinitions(): Array<{
    name: string;
    description: string;
    instructions: string;
  }> {
    return this.getAll().map((s) => ({
      name: s.name,
      description: s.description,
      instructions: s.systemPrompt,
    }));
  }
}
