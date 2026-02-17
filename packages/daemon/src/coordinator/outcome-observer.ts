import type { DeviceEvent } from "@holms/shared";
import type { EventBus } from "../event-bus.js";

interface PendingObservation {
  actionId: string;
  deviceId: string;
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

  processEvent(event: DeviceEvent): string | null {
    this.cleanExpired();

    for (const [id, obs] of this.observations) {
      if (obs.deviceId !== event.deviceId) continue;
      if (event.type !== "state_changed") continue;

      // Check if this is a user reversal (command came from device, not from agent)
      const eventCommand = event.data.command as string | undefined;
      if (!eventCommand) continue;

      // Detect reversal patterns
      const isReversal = this.isReversal(obs.command, eventCommand);
      if (!isReversal) continue;

      this.observations.delete(id);

      const feedback = `You executed "${obs.command}" on ${obs.deviceId} at ${new Date(obs.timestamp).toLocaleTimeString()} because: "${obs.agentReason}". The user reversed this at ${new Date(event.timestamp).toLocaleTimeString()} by executing "${eventCommand}". Consider why the user disagreed and whether to adjust your behavior.`;

      this.eventBus.emit("agent:outcome", {
        action: obs.command,
        feedback,
        timestamp: Date.now(),
      });

      return feedback;
    }

    return null;
  }

  private isReversal(agentCommand: string, userCommand: string): boolean {
    const reversals: Record<string, string[]> = {
      turn_on: ["turn_off"],
      turn_off: ["turn_on"],
      lock: ["unlock"],
      unlock: ["lock"],
    };
    return reversals[agentCommand]?.includes(userCommand) ?? false;
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
