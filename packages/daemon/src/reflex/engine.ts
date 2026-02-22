import type { DeviceEvent, DeviceCommand, Automation } from "@holms/shared";
import type { ReflexStore } from "./store.js";
import type { DeviceManager } from "../devices/manager.js";
import type { EventBus } from "../event-bus.js";

export class ReflexEngine {
  constructor(
    private store: ReflexStore,
    private deviceManager: DeviceManager,
    private eventBus: EventBus,
  ) {}

  async processEvent(event: DeviceEvent): Promise<void> {
    const rules = this.store.getEnabled();

    for (const rule of rules) {
      if (!this.matchesTrigger(rule.trigger, event)) continue;

      const command: DeviceCommand = {
        deviceId: rule.action.deviceId,
        command: rule.action.command,
        params: rule.action.params,
      };

      const result = await this.deviceManager.executeCommand(
        command.deviceId,
        command.command,
        command.params,
      );

      if (result.success) {
        this.eventBus.emit("reflex:triggered", {
          rule,
          event,
          action: command,
        });
        console.log(
          `[ReflexEngine] Triggered rule "${rule.reason}" → ${command.command} on ${command.deviceId}`,
        );
      } else {
        console.warn(
          `[ReflexEngine] Rule "${rule.reason}" failed: ${result.error}`,
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

      const command: DeviceCommand = {
        deviceId: rule.action.deviceId,
        command: rule.action.command,
        params: rule.action.params,
      };

      const result = await this.deviceManager.executeCommand(
        command.deviceId,
        command.command,
        command.params,
      );

      if (result.success) {
        this.eventBus.emit("reflex:triggered", {
          rule,
          event: {
            deviceId: "automation",
            type: "automation:fired",
            data: { automationId: automation.id, instruction: automation.instruction },
            timestamp: Date.now(),
          },
          action: command,
        });
        console.log(
          `[ReflexEngine] Automation-triggered rule "${rule.reason}" → ${command.command} on ${command.deviceId}`,
        );
        matched = true;
      } else {
        console.warn(
          `[ReflexEngine] Automation-triggered rule "${rule.reason}" failed: ${result.error}`,
        );
      }
    }

    return matched;
  }

  private matchesTrigger(
    trigger: { deviceId?: string; eventType?: string; condition?: Record<string, unknown> },
    event: DeviceEvent,
  ): boolean {
    if (trigger.deviceId && trigger.deviceId !== event.deviceId) return false;
    if (trigger.eventType && trigger.eventType !== event.type) return false;

    if (trigger.condition) {
      for (const [key, value] of Object.entries(trigger.condition)) {
        if (event.data[key] !== value) return false;
      }
    }

    return true;
  }
}
