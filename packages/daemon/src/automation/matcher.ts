import type { DeviceEvent, Automation } from "@holms/shared";
import type { AutomationStore } from "./store.js";

const DEBOUNCE_MS = 60_000; // 60 seconds

export class AutomationMatcher {
  private lastFired = new Map<string, number>();

  constructor(private store: AutomationStore) {}

  matchEvent(event: DeviceEvent): Automation[] {
    const matched: Automation[] = [];

    // Check device_event automations
    const deviceEventAutomations = this.store.getDeviceEventAutomations();
    for (const automation of deviceEventAutomations) {
      if (automation.trigger.type !== "device_event") continue;
      const t = automation.trigger;

      if (t.deviceId !== event.deviceId) continue;
      if (t.eventType && t.eventType !== event.type) continue;

      if (t.condition) {
        let conditionMatch = true;
        for (const [key, value] of Object.entries(t.condition)) {
          if (event.data[key] !== value) {
            conditionMatch = false;
            break;
          }
        }
        if (!conditionMatch) continue;
      }

      if (this.isDebounced(automation.id)) continue;
      matched.push(automation);
    }

    // Check state_threshold automations
    const thresholdAutomations = this.store.getStateThresholdAutomations();
    for (const automation of thresholdAutomations) {
      if (automation.trigger.type !== "state_threshold") continue;
      const t = automation.trigger;

      if (t.deviceId !== event.deviceId) continue;

      const value = event.data[t.stateKey];
      if (typeof value !== "number") continue;

      let passes = false;
      switch (t.operator) {
        case "gt":  passes = value > t.value; break;
        case "lt":  passes = value < t.value; break;
        case "eq":  passes = value === t.value; break;
        case "gte": passes = value >= t.value; break;
        case "lte": passes = value <= t.value; break;
      }

      if (!passes) continue;
      if (this.isDebounced(automation.id)) continue;
      matched.push(automation);
    }

    if (matched.length > 0) {
      console.log(`[AutomationMatcher] Event ${event.deviceId}:${event.type} → ${matched.length} automation(s) matched`);
    }

    // Mark matched automations as fired
    const now = Date.now();
    for (const automation of matched) {
      this.lastFired.set(automation.id, now);
      this.store.markFired(automation.id);
    }

    return matched;
  }

  private isDebounced(automationId: string): boolean {
    const last = this.lastFired.get(automationId);
    if (!last) return false;
    return Date.now() - last < DEBOUNCE_MS;
  }
}
