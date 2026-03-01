import type { HabitatEvent } from "../habitat/types.js";
import type { EventBus } from "../event-bus.js";

interface PendingObservation {
  actionId: string;
  sourceId: string;
  command: string;
  timestamp: number;
  expiresAt: number;
  agentReason: string;
}

export class OutcomeObserver {
  private observations = new Map<string, PendingObservation>();
  private observationWindowMs: number;

  constructor(
    private eventBus: EventBus,
    observationWindowMs = 5 * 60 * 1000,
  ) {
    this.observationWindowMs = observationWindowMs;
  }

  observe(observation: Omit<PendingObservation, "expiresAt">): void {
    const entry: PendingObservation = {
      ...observation,
      expiresAt: observation.timestamp + this.observationWindowMs,
    };
    this.observations.set(observation.actionId, entry);
  }

  processEvent(event: HabitatEvent): string | null {
    this.cleanExpired();

    for (const [id, obs] of this.observations) {
      if (obs.sourceId !== event.source) continue;

      // Check if this is a user reversal
      const stateKeys = Object.keys(event.state);
      if (stateKeys.length === 0) continue;

      // Detect reversal patterns via state values
      const isReversal = this.detectReversal(obs.command, event.state);
      if (!isReversal) continue;

      this.observations.delete(id);

      const feedback = `You executed "${obs.command}" on ${obs.sourceId} at ${new Date(obs.timestamp).toLocaleTimeString()} because: "${obs.agentReason}". The user reversed this at ${new Date(event.timestamp).toLocaleTimeString()} in space "${event.space}". Consider why the user disagreed and whether to adjust your behavior.`;

      this.eventBus.emit("agent:outcome", {
        action: obs.command,
        feedback,
        timestamp: Date.now(),
      });

      return feedback;
    }

    return null;
  }

  private detectReversal(agentCommand: string, newState: Record<string, unknown>): boolean {
    // If agent turned something on and it's now off, or vice versa
    if (agentCommand.includes("on") && newState.on === false) return true;
    if (agentCommand.includes("off") && newState.on === true) return true;
    if (agentCommand.includes("lock") && newState.locked === false) return true;
    if (agentCommand.includes("unlock") && newState.locked === true) return true;
    return false;
  }

  private cleanExpired(): void {
    const now = Date.now();
    for (const [id, obs] of this.observations) {
      if (obs.expiresAt < now) {
        this.observations.delete(id);
      }
    }
  }
}
