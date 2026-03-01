import type { DeviceCommand, Automation } from "@holms/shared";
import type { HabitatEvent } from "../habitat/types.js";
import type { ReflexStore } from "./store.js";
import type { Habitat } from "../habitat/habitat.js";
import type { EventBus } from "../event-bus.js";

export class ReflexEngine {
  constructor(
    private store: ReflexStore,
    private habitat: Habitat,
    private eventBus: EventBus,
  ) {}

  async processEvent(event: HabitatEvent): Promise<void> {
    const rules = this.store.getEnabled();

    for (const rule of rules) {
      if (!this.matchesTrigger(rule.trigger, event)) continue;

      // Execute via habitat influence
      const result = await this.habitat.engine.influence(
        event.space,
        { source: rule.action.deviceId },
        rule.action.params,
      );

      const success = result.results.every((r) => r.success);
      if (success) {
        const command: DeviceCommand = {
          deviceId: rule.action.deviceId,
          command: rule.action.command,
          params: rule.action.params,
        };
        this.eventBus.emit("reflex:triggered", {
          rule,
          event,
          action: command,
        });
        console.log(
          `[ReflexEngine] Triggered rule "${rule.reason}" → ${rule.action.command} on ${rule.action.deviceId}`,
        );
      } else {
        const errors = result.results.filter((r) => !r.success).map((r) => r.error).join(", ");
        console.warn(
          `[ReflexEngine] Rule "${rule.reason}" failed: ${errors}`,
        );
      }
    }
  }

  async processAutomationEvent(automation: Automation): Promise<boolean> {
    const rules = this.store.getEnabled();
    let matched = false;

    for (const rule of rules) {
      if (!rule.trigger.automationId) continue;
      if (rule.trigger.automationId !== automation.id) continue;

      const result = await this.habitat.engine.influence(
        "", // space unknown for automation-triggered reflexes; action targets a specific source
        { source: rule.action.deviceId },
        rule.action.params,
      );

      const success = result.results.every((r) => r.success);
      if (success) {
        const command: DeviceCommand = {
          deviceId: rule.action.deviceId,
          command: rule.action.command,
          params: rule.action.params,
        };
        this.eventBus.emit("reflex:triggered", {
          rule,
          event: {
            space: "automation",
            source: "automation",
            property: "power" as const,
            state: { automationId: automation.id, instruction: automation.instruction },
            timestamp: Date.now(),
          },
          action: command,
        });
        console.log(
          `[ReflexEngine] Automation-triggered rule "${rule.reason}" → ${rule.action.command} on ${rule.action.deviceId}`,
        );
        matched = true;
      } else {
        const errors = result.results.filter((r) => !r.success).map((r) => r.error).join(", ");
        console.warn(
          `[ReflexEngine] Automation-triggered rule "${rule.reason}" failed: ${errors}`,
        );
      }
    }

    return matched;
  }

  private matchesTrigger(
    trigger: { deviceId?: string; eventType?: string; condition?: Record<string, unknown> },
    event: HabitatEvent,
  ): boolean {
    // Match trigger.deviceId against source ID
    if (trigger.deviceId && trigger.deviceId !== event.source) return false;
    // Match trigger.eventType against property
    if (trigger.eventType && trigger.eventType !== event.property) return false;

    if (trigger.condition) {
      for (const [key, value] of Object.entries(trigger.condition)) {
        if (event.state[key] !== value) return false;
      }
    }

    return true;
  }
}
