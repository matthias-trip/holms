import type { TriageLane, TriageRule, TriageCondition } from "@holms/shared";
import type { HabitatEvent } from "../habitat/types.js";
import type { TriageStore } from "./store.js";
import type { EventBus } from "../event-bus.js";
import type { HolmsConfig } from "../config.js";

interface PendingEcho {
  sourceId: string;
  timestamp: number;
}

interface BatchBuffer {
  events: HabitatEvent[];
  holdMinutes: number;
  firstEventAt: number;
}

export class TriageEngine {
  private pendingEchoes = new Map<string, PendingEcho>();
  private batchBuffers = new Map<string, BatchBuffer>();
  private batchInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private store: TriageStore,
    private eventBus: EventBus,
    private config: HolmsConfig,
  ) {}

  classify(event: HabitatEvent): TriageLane {
    // 1. Command echo filter — silence events that match a command we just issued
    if (this.isCommandEcho(event)) {
      this.emitClassification(event, "silent", null, "command echo");
      return "silent";
    }

    // 2. Match triage rules (first match wins, ordered by specificity)
    const rules = this.store.getEnabled();
    const sorted = this.sortBySpecificity(rules);

    for (const rule of sorted) {
      if (!this.matchesCondition(rule.condition, event)) continue;

      // deltaThreshold acts as noise floor
      if (rule.condition.deltaThreshold != null && event.previousState) {
        const delta = this.computeMaxDelta(event);
        if (delta != null && Math.abs(delta) < rule.condition.deltaThreshold) {
          this.emitClassification(event, "silent", rule.id, `delta ${Math.abs(delta).toFixed(1)} below threshold ${rule.condition.deltaThreshold}`);
          return "silent";
        }
      }

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

  expectCommandEcho(sourceId: string): void {
    this.pendingEchoes.set(sourceId, {
      sourceId,
      timestamp: Date.now(),
    });
  }

  startBatchTicker(forwardCallback: (events: HabitatEvent[]) => void): void {
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

  private addToBatchBuffer(event: HabitatEvent, rule: TriageRule | null): void {
    const key = `${event.space}:${event.source}`;
    const holdMinutes = rule?.holdMinutes ?? (this.config.triage.batchIntervalMs / 60_000);
    const existing = this.batchBuffers.get(key);

    if (existing) {
      existing.events.push(event);
      if (rule?.holdMinutes != null) {
        existing.holdMinutes = rule.holdMinutes;
      }
    } else {
      this.batchBuffers.set(key, {
        events: [event],
        holdMinutes,
        firstEventAt: Date.now(),
      });
    }
  }

  private flushReadyBuffers(forwardCallback: (events: HabitatEvent[]) => void): void {
    const now = Date.now();
    const allFlushed: HabitatEvent[] = [];

    for (const [key, buffer] of this.batchBuffers) {
      const elapsedMs = now - buffer.firstEventAt;
      if (elapsedMs < buffer.holdMinutes * 60_000) continue;

      const events = buffer.events;
      this.batchBuffers.delete(key);
      if (events.length === 0) continue;

      // Use the latest event as representative
      const latest = events[events.length - 1]!;
      allFlushed.push(latest);
    }

    if (allFlushed.length === 0) return;

    this.eventBus.emit("agent:triage_batch", {
      eventCount: allFlushed.length,
      devices: allFlushed.map((e) => ({
        deviceId: e.source,
        deviceName: `${e.space}/${e.property}`,
        eventCount: 1,
      })),
      timestamp: now,
    });

    console.log(`[Triage] Flushing ${allFlushed.length} event(s) to coordinator`);
    forwardCallback(allFlushed);
  }

  private isCommandEcho(event: HabitatEvent): boolean {
    const pending = this.pendingEchoes.get(event.source);
    if (!pending) return false;

    const age = Date.now() - pending.timestamp;
    if (age > this.config.triage.echoWindowMs) {
      this.pendingEchoes.delete(event.source);
      return false;
    }

    this.pendingEchoes.delete(event.source);
    console.log(`[Triage] silent: command echo for ${event.source}`);
    return true;
  }

  private matchesCondition(condition: TriageCondition, event: HabitatEvent): boolean {
    // Map habitat event fields to triage condition fields
    if (condition.deviceId && condition.deviceId !== event.source) return false;
    if (condition.deviceDomain && condition.deviceDomain !== event.property) return false;
    if (condition.area && condition.area !== event.space) return false;
    return true;
  }

  private defaultClassify(event: HabitatEvent): TriageLane {
    // Occupancy and access events are always immediate
    if (event.property === "occupancy" || event.property === "access" || event.property === "safety") {
      return "immediate";
    }

    // Small numeric sensor changes → silent
    if (event.previousState) {
      const delta = this.computeMaxDelta(event);
      if (delta != null && Math.abs(delta) < 1) {
        return "silent";
      }
    }

    // Everything else → batched
    return "batched";
  }

  private computeMaxDelta(event: HabitatEvent): number | null {
    if (!event.previousState) return null;
    let maxDelta: number | null = null;
    for (const [key, value] of Object.entries(event.state)) {
      if (typeof value !== "number") continue;
      const prev = event.previousState[key];
      if (typeof prev !== "number") continue;
      const d = Math.abs(value - prev);
      if (maxDelta === null || d > maxDelta) maxDelta = d;
    }
    return maxDelta;
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
    event: HabitatEvent,
    lane: TriageLane,
    ruleId: string | null,
    reason: string,
  ): void {
    this.eventBus.emit("agent:triage_classify", {
      deviceId: event.source,
      eventType: "state_changed",
      lane,
      ruleId,
      reason,
      deviceName: `${event.space}/${event.property}`,
      area: event.space,
      timestamp: Date.now(),
    });
  }
}
