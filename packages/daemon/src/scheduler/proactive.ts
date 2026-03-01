import type { CoordinatorHub } from "../coordinator/coordinator-hub.js";
import type { MemoryStore } from "../memory/store.js";
import type { AutomationStore } from "../automation/store.js";
import type { EventBus } from "../event-bus.js";
import type { HolmsConfig } from "../config.js";

interface WakeupConfig {
  type: string;
  interval: number;
  lastRun: number;
}

const MEMORY_MAINTENANCE_THRESHOLD = 150;
const MEMORY_MAINTENANCE_COOLDOWN = 2 * 60 * 60 * 1000; // 2 hours

export class ProactiveScheduler {
  private wakeups: WakeupConfig[];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastMemoryMaintenance = 0;

  constructor(
    private hub: CoordinatorHub,
    private memoryStore: MemoryStore,
    private config: HolmsConfig,
    private automationStore?: AutomationStore,
    private eventBus?: EventBus,
  ) {
    // Initialize lastRun to now so wakeups don't fire immediately on boot
    const now = Date.now();
    this.wakeups = [
      {
        type: "situational",
        interval: config.proactive.situationalCheckInterval,
        lastRun: now,
      },
      {
        type: "reflection",
        interval: config.proactive.reflectionInterval,
        lastRun: now,
      },
      {
        type: "goal_review",
        interval: config.proactive.goalReviewInterval,
        lastRun: now,
      },
      {
        type: "daily_summary",
        interval: 24 * 60 * 60 * 1000,
        lastRun: now,
      },
    ];
  }

  start(): void {
    // Check every 30 seconds which wakeups are due
    this.timer = setInterval(() => this.tick(), 30_000);
    console.log("[ProactiveScheduler] Started");
  }

  async triggerWakeup(type: string, channel?: string): Promise<void> {
    let extraContext = "";
    if (type === "reflection") {
      const recentMemories = this.memoryStore
        .getAll()
        .slice(0, 5)
        .map((m) => `[#${m.id}] [${m.tags.join(", ")}] ${m.content}`)
        .join("\n");
      extraContext = `Recent memories:\n${recentMemories}`;
    }

    console.log(`[ProactiveScheduler] Manual trigger: ${type}${channel ? ` (channel: ${channel})` : ""}`);
    await this.hub.handleProactiveWakeup(type, extraContext, channel);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("[ProactiveScheduler] Stopped");
  }

  private async tick(): Promise<void> {
    // Check due cron-triggered automations first — these are user commitments
    if (this.automationStore && this.eventBus) {
      const dueAutomations = this.automationStore.getDueCronTriggers(Date.now());
      for (const automation of dueAutomations) {
        console.log(`[ProactiveScheduler] Automation fired: "${automation.summary}" (${automation.id})`);
        this.eventBus.emit("automation:time_fired", { automation, timestamp: Date.now() });
        this.automationStore.markFired(automation.id);
      }
    }

    const now = Date.now();

    for (const wakeup of this.wakeups) {
      if (now - wakeup.lastRun < wakeup.interval) continue;

      wakeup.lastRun = now;

      try {
        await this.triggerWakeup(wakeup.type);
      } catch (error) {
        console.error(
          `[ProactiveScheduler] Error in ${wakeup.type} wakeup:`,
          error,
        );
      }

      // Only one wakeup per tick to avoid overwhelming the coordinator
      break;
    }

    // Check for daily summary — only fire once per day
    const hour = new Date().getHours();
    const dailyWakeup = this.wakeups.find((w) => w.type === "daily_summary")!;

    if (
      hour === this.config.proactive.dailySummaryHour &&
      dailyWakeup.lastRun < Date.now() - 23 * 60 * 60 * 1000
    ) {
      dailyWakeup.lastRun = Date.now();

      try {
        await this.hub.handleProactiveWakeup("daily_summary");
      } catch (error) {
        console.error("[ProactiveScheduler] Daily summary error:", error);
      }
    }

    // Check if memory store needs maintenance (throttled to once per 2h)
    if (Date.now() - this.lastMemoryMaintenance >= MEMORY_MAINTENANCE_COOLDOWN) {
      const memoryCount = this.memoryStore.getCount();
      if (memoryCount >= MEMORY_MAINTENANCE_THRESHOLD) {
        this.lastMemoryMaintenance = Date.now();
        console.log(`[ProactiveScheduler] Memory maintenance triggered: ${memoryCount} memories (threshold: ${MEMORY_MAINTENANCE_THRESHOLD})`);
        try {
          await this.hub.handleProactiveWakeup("memory_maintenance");
        } catch (error) {
          console.error("[ProactiveScheduler] Memory maintenance error:", error);
        }
      }
    }
  }
}
