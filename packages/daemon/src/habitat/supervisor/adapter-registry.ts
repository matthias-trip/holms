export interface AdapterSetup {
  discover?: { description: string };
  pair?: { description: string };
}

interface AdapterEntry {
  modulePath: string;
  setup?: AdapterSetup;
}

/**
 * Maps adapter type names to absolute module paths and setup capabilities.
 * Builtins are registered at startup; plugins add entries at discovery time.
 */
export class AdapterRegistry {
  private types = new Map<string, AdapterEntry>();

  register(type: string, modulePath: string, setup?: AdapterSetup): void {
    if (this.types.has(type)) {
      console.warn(
        `[AdapterRegistry] Overwriting adapter type "${type}" (was: ${this.types.get(type)!.modulePath}, now: ${modulePath})`,
      );
    }
    this.types.set(type, { modulePath, setup });
  }

  resolve(type: string): string {
    const entry = this.types.get(type);
    if (!entry) {
      const available = Array.from(this.types.keys()).join(", ") || "(none)";
      throw new Error(
        `Unknown adapter type "${type}". Available types: ${available}`,
      );
    }
    return entry.modulePath;
  }

  getSetup(type: string): AdapterSetup | undefined {
    return this.types.get(type)?.setup;
  }

  listTypes(): string[] {
    return Array.from(this.types.keys());
  }

  listAll(): Array<{ type: string; modulePath: string; setup?: AdapterSetup }> {
    return Array.from(this.types.entries()).map(([type, entry]) => ({
      type,
      modulePath: entry.modulePath,
      setup: entry.setup,
    }));
  }
}
