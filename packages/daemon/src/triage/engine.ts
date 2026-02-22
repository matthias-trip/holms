import type { DeviceEvent, TriageLane, TriageRule, TriageCondition } from "@holms/shared";
import type { TriageStore } from "./store.js";
import type { EventBus } from "../event-bus.js";
import type { DeviceManager } from "../devices/manager.js";
import type { HolmsConfig } from "../config.js";

interface PendingEcho {
  command: string;
  timestamp: number;
}

export class TriageEngine {
  private pendingEchoes = new Map<string, PendingEcho>();
  private batchBuffer: DeviceEvent[] = [];
  private batchInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private store: TriageStore,
    private eventBus: EventBus,
    private deviceManager: DeviceManager,
    private config: HolmsConfig,
  ) {}

  classify(event: DeviceEvent): TriageLane {
    // 1. Command echo filter — silence events that match a command we just issued
    if (this.isCommandEcho(event)) {
      this.emitClassification(event, "silent", null, "command echo");
      return "silent";
    }

    // 2. Match triage rules (first match wins, ordered by specificity)
    const rules = this.store.getEnabled();
    const sorted = this.sortBySpecificity(rules);

    for (const rule of sorted) {
      if (this.matchesCondition(rule.condition, event)) {
        const lane = rule.lane;

        if (lane === "batched") {
          this.batchBuffer.push(event);
        }

        this.emitClassification(event, lane, rule.id, rule.reason);
        return lane;
      }
    }

    // 3. Built-in defaults
    const lane = this.defaultClassify(event);

    if (lane === "batched") {
      this.batchBuffer.push(event);
    }

    this.emitClassification(event, lane, null, "default");
    return lane;
  }

  expectCommandEcho(deviceId: string, command: string): void {
    this.pendingEchoes.set(deviceId, {
      command,
      timestamp: Date.now(),
    });
  }

  startBatchTicker(forwardCallback: (events: DeviceEvent[]) => void): void {
    const intervalMs = this.config.triage.batchIntervalMs;

    this.batchInterval = setInterval(() => {
      if (this.batchBuffer.length === 0) return;

      const events = this.batchBuffer.splice(0);

      this.eventBus.emit("agent:triage_batch", {
        eventCount: events.length,
        timestamp: Date.now(),
      });

      console.log(`[Triage] Flushing ${events.length} batched event(s) to coordinator`);
      forwardCallback(events);
    }, intervalMs);

    console.log(`[Triage] Batch ticker started (interval: ${intervalMs}ms)`);
  }

  stopBatchTicker(): void {
    if (this.batchInterval) {
      clearInterval(this.batchInterval);
      this.batchInterval = null;
    }
  }

  private isCommandEcho(event: DeviceEvent): boolean {
    if (event.type !== "state_changed") return false;

    const pending = this.pendingEchoes.get(event.deviceId);
    if (!pending) return false;

    const age = Date.now() - pending.timestamp;
    if (age > this.config.triage.echoWindowMs) {
      // Expired — clean up
      this.pendingEchoes.delete(event.deviceId);
      return false;
    }

    // Consume the echo
    this.pendingEchoes.delete(event.deviceId);
    console.log(`[Triage] silent: command echo for ${event.deviceId} (${pending.command})`);
    return true;
  }

  private matchesCondition(condition: TriageCondition, event: DeviceEvent): boolean {
    if (condition.deviceId && condition.deviceId !== event.deviceId) return false;
    if (condition.eventType && condition.eventType !== event.type) return false;

    // For deviceDomain and area matching, use event fields or fall back to event data
    if (condition.deviceDomain || condition.area) {
      const domain = event.domain ?? (event.data.domain as string | undefined);
      const area = event.area ?? (event.data.area as string | undefined);

      if (condition.deviceDomain && domain !== condition.deviceDomain) return false;
      if (condition.area && area !== condition.area) return false;
    }

    // Delta threshold matching
    if (condition.stateKey && condition.deltaThreshold != null) {
      const delta = event.data.delta as number | undefined;
      const value = event.data[condition.stateKey];

      // If there's an explicit delta field, use it
      if (delta != null && Math.abs(delta) <= condition.deltaThreshold) {
        return false; // Delta too small — doesn't match this rule
      }

      // If no delta but we have the value, we can't determine change — skip threshold check
      if (delta == null && value != null) {
        return true; // Condition matches on other fields, can't check delta
      }
    }

    return true;
  }

  private defaultClassify(event: DeviceEvent): TriageLane {
    // Motion events are always immediate
    if (event.type === "motion_detected" || event.type === "motion_cleared") {
      return "immediate";
    }

    // Contact sensor changes (door/window open/close) are immediate
    if (event.type === "contact_changed") {
      return "immediate";
    }

    // Lock state changes are immediate (security)
    if (event.type === "lock_changed") {
      return "immediate";
    }

    // State changes with an explicit external/manual change indicator
    if (event.type === "state_changed") {
      // If the event carries a "source" indicating manual/external change
      if (event.data.source === "manual" || event.data.source === "external") {
        return "immediate";
      }

      // Small numeric sensor changes → silent
      if (typeof event.data.delta === "number" && Math.abs(event.data.delta) < 1) {
        return "silent";
      }
    }

    // Heartbeat / periodic telemetry → silent
    if (event.type === "heartbeat" || event.type === "telemetry") {
      return "silent";
    }

    // Everything else → batched
    return "batched";
  }

  private sortBySpecificity(rules: TriageRule[]): TriageRule[] {
    return [...rules].sort((a, b) => {
      return this.specificityScore(b.condition) - this.specificityScore(a.condition);
    });
  }

  private specificityScore(condition: TriageCondition): number {
    let score = 0;
    if (condition.deviceId) score += 8;
    if (condition.eventType) score += 4;
    if (condition.deviceDomain) score += 2;
    if (condition.area) score += 1;
    if (condition.stateKey) score += 1;
    return score;
  }

  private emitClassification(
    event: DeviceEvent,
    lane: TriageLane,
    ruleId: string | null,
    reason: string,
  ): void {
    const device = this.deviceManager.getCachedDevice(event.deviceId);
    this.eventBus.emit("agent:triage_classify", {
      deviceId: event.deviceId,
      eventType: event.type,
      lane,
      ruleId,
      reason,
      deviceName: device?.name,
      area: device?.area.name,
      timestamp: Date.now(),
    });
  }
}
