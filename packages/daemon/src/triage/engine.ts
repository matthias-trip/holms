import type { DeviceEvent, TriageLane, TriageRule, TriageCondition } from "@holms/shared";
import type { TriageStore } from "./store.js";
import type { EventBus } from "../event-bus.js";
import type { DeviceManager } from "../devices/manager.js";
import type { HolmsConfig } from "../config.js";

interface PendingEcho {
  command: string;
  timestamp: number;
}

interface DeviceBatchBuffer {
  events: DeviceEvent[];
  holdMinutes: number;
  firstEventAt: number;
}

export class TriageEngine {
  private pendingEchoes = new Map<string, PendingEcho>();
  private batchBuffers = new Map<string, DeviceBatchBuffer>();
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
      if (!this.matchesBaseCondition(rule.condition, event)) continue;

      // deltaThreshold acts as noise floor
      if (rule.condition.deltaThreshold != null) {
        const delta = event.data.delta as number | undefined;
        if (delta != null && Math.abs(delta) < rule.condition.deltaThreshold) {
          this.emitClassification(event, "silent", rule.id, `delta ${Math.abs(delta).toFixed(0)} below threshold ${rule.condition.deltaThreshold}`);
          return "silent";
        }
      }

      // Rule matches — use its lane
      const lane = rule.lane;

      if (lane === "batched") {
        this.addToBatchBuffer(event, rule);
      }

      this.emitClassification(event, lane, rule.id, rule.reason);
      return lane;
    }

    // 3. Built-in defaults
    const lane = this.defaultClassify(event);

    if (lane === "batched") {
      this.addToBatchBuffer(event, null);
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
    // Tick every 30 seconds to check per-device buffers
    const tickMs = 30_000;

    this.batchInterval = setInterval(() => {
      this.flushReadyBuffers(forwardCallback);
    }, tickMs);

    console.log(`[Triage] Batch ticker started (tick: ${tickMs}ms)`);
  }

  stopBatchTicker(): void {
    if (this.batchInterval) {
      clearInterval(this.batchInterval);
      this.batchInterval = null;
    }
  }

  private addToBatchBuffer(event: DeviceEvent, rule: TriageRule | null): void {
    const deviceId = event.deviceId;
    const holdMinutes = rule?.holdMinutes ?? (this.config.triage.batchIntervalMs / 60_000);
    const existing = this.batchBuffers.get(deviceId);

    if (existing) {
      existing.events.push(event);
      // Update hold time if a rule specifies a different one
      if (rule?.holdMinutes != null) {
        existing.holdMinutes = rule.holdMinutes;
      }
    } else {
      this.batchBuffers.set(deviceId, {
        events: [event],
        holdMinutes,
        firstEventAt: Date.now(),
      });
    }
  }

  private flushReadyBuffers(forwardCallback: (events: DeviceEvent[]) => void): void {
    const now = Date.now();
    const allFlushed: DeviceEvent[] = [];
    const deviceDetails: Array<{
      deviceId: string;
      deviceName?: string;
      eventCount: number;
      latestValue?: number;
      unit?: string;
      avgDelta?: number;
      maxDelta?: number;
    }> = [];

    for (const [deviceId, buffer] of this.batchBuffers) {
      const elapsedMs = now - buffer.firstEventAt;
      if (elapsedMs < buffer.holdMinutes * 60_000) continue;

      // Ready to flush this device's buffer
      const events = buffer.events;
      this.batchBuffers.delete(deviceId);

      if (events.length === 0) continue;

      const aggregated = this.aggregateEvents(deviceId, events);
      allFlushed.push(aggregated);

      // Collect per-device details for the activity event
      const device = this.deviceManager.getCachedDevice(deviceId);
      const detail: typeof deviceDetails[number] = {
        deviceId,
        deviceName: device?.name,
        eventCount: events.length,
      };
      const aggData = aggregated.data;
      if (typeof aggData.value === "number") detail.latestValue = aggData.value;
      if (typeof aggData.unit === "string") detail.unit = aggData.unit;
      if (typeof aggData.avgDelta === "number") detail.avgDelta = aggData.avgDelta;
      if (typeof aggData.maxDelta === "number") detail.maxDelta = aggData.maxDelta;
      deviceDetails.push(detail);
    }

    if (allFlushed.length === 0) return;

    const totalRawEvents = deviceDetails.reduce((sum, d) => sum + d.eventCount, 0);

    this.eventBus.emit("agent:triage_batch", {
      eventCount: totalRawEvents,
      devices: deviceDetails,
      timestamp: now,
    });

    console.log(`[Triage] Flushing ${allFlushed.length} device(s), ${totalRawEvents} raw event(s) to coordinator`);
    forwardCallback(allFlushed);
  }

  private aggregateEvents(deviceId: string, events: DeviceEvent[]): DeviceEvent {
    if (events.length === 1) return events[0]!;

    const latest = events[events.length - 1]!;
    const first = events[0]!;

    const deltas: number[] = [];
    const values: number[] = [];

    for (const e of events) {
      if (typeof e.data.delta === "number") deltas.push(e.data.delta);
      if (typeof e.data.value === "number") values.push(e.data.value);
    }

    const aggregatedData: Record<string, unknown> = {
      ...latest.data,
      aggregated: true,
      eventCount: events.length,
      timeSpanMs: latest.timestamp - first.timestamp,
    };

    if (deltas.length > 0) {
      aggregatedData.avgDelta = Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length);
      aggregatedData.minDelta = Math.min(...deltas);
      aggregatedData.maxDelta = Math.max(...deltas);
    }

    if (values.length > 0) {
      aggregatedData.minValue = Math.min(...values);
      aggregatedData.maxValue = Math.max(...values);
    }

    return {
      deviceId,
      type: latest.type,
      data: aggregatedData,
      timestamp: latest.timestamp,
      domain: latest.domain,
      area: latest.area,
      previousState: first.previousState,
    };
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

  /** Match base conditions (deviceId, domain, eventType, area) without deltaThreshold logic */
  private matchesBaseCondition(condition: TriageCondition, event: DeviceEvent): boolean {
    if (condition.deviceId && condition.deviceId !== event.deviceId) return false;
    if (condition.eventType && condition.eventType !== event.type) return false;

    // For deviceDomain and area matching, use event fields or fall back to event data
    if (condition.deviceDomain || condition.area) {
      const domain = event.domain ?? (event.data.domain as string | undefined);
      const area = event.area ?? (event.data.area as string | undefined);

      if (condition.deviceDomain && domain !== condition.deviceDomain) return false;
      if (condition.area && area !== condition.area) return false;
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
    return score;
  }

  private emitClassification(
    event: DeviceEvent,
    lane: TriageLane,
    ruleId: string | null,
    reason: string,
  ): void {
    const device = this.deviceManager.getCachedDevice(event.deviceId);
    const delta = typeof event.data.delta === "number" ? event.data.delta : undefined;
    this.eventBus.emit("agent:triage_classify", {
      deviceId: event.deviceId,
      eventType: event.type,
      lane,
      ruleId,
      reason,
      deviceName: device?.name,
      area: device?.area.name,
      delta,
      timestamp: Date.now(),
    });
  }
}
