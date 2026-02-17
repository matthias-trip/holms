import type { Coordinator } from "../coordinator/coordinator.js";
import type { DeviceManager } from "../devices/manager.js";
import type { MemoryStore } from "../memory/store.js";
import type { HolmsConfig } from "../config.js";

interface WakeupConfig {
  type: string;
  interval: number;
  lastRun: number;
}

export class ProactiveScheduler {
  private wakeups: WakeupConfig[];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private coordinator: Coordinator,
    private deviceManager: DeviceManager,
    private memoryStore: MemoryStore,
    private config: HolmsConfig,
  ) {
    this.wakeups = [
      {
        type: "situational",
        interval: config.proactive.situationalCheckInterval,
        lastRun: 0,
      },
      {
        type: "reflection",
        interval: config.proactive.reflectionInterval,
        lastRun: 0,
      },
      {
        type: "goal_review",
        interval: config.proactive.goalReviewInterval,
        lastRun: 0,
      },
    ];
  }

  start(): void {
    // Check every 30 seconds which wakeups are due
    this.timer = setInterval(() => this.tick(), 30_000);
    console.log("[ProactiveScheduler] Started");
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("[ProactiveScheduler] Stopped");
  }

  private async tick(): Promise<void> {
    if (this.coordinator.isProcessing()) return;

    const now = Date.now();

    for (const wakeup of this.wakeups) {
      if (now - wakeup.lastRun < wakeup.interval) continue;

      wakeup.lastRun = now;

      try {
        console.log(`[ProactiveScheduler] Triggering ${wakeup.type} wakeup`);

        let extraContext = "";
        if (wakeup.type === "reflection") {
          const recentMemories = this.memoryStore
            .getAll()
            .slice(0, 5)
            .map((m) => `[${m.type}] ${m.key}: ${m.content}`)
            .join("\n");
          extraContext = `Recent memories:\n${recentMemories}`;
        }

        await this.coordinator.handleProactiveWakeup(
          wakeup.type,
          extraContext,
        );
      } catch (error) {
        console.error(
          `[ProactiveScheduler] Error in ${wakeup.type} wakeup:`,
          error,
        );
      }

      // Only one wakeup per tick to avoid overwhelming the coordinator
      break;
    }

    // Check for daily summary
    const hour = new Date().getHours();
    const todayKey = new Date().toISOString().split("T")[0];
    const dailyWakeup = this.wakeups.find((w) => w.type === "daily_summary");

    if (
      hour === this.config.proactive.dailySummaryHour &&
      (!dailyWakeup || dailyWakeup.lastRun < Date.now() - 23 * 60 * 60 * 1000)
    ) {
      if (!dailyWakeup) {
        this.wakeups.push({
          type: "daily_summary",
          interval: 24 * 60 * 60 * 1000,
          lastRun: Date.now(),
        });
      } else {
        dailyWakeup.lastRun = Date.now();
      }

      try {
        await this.coordinator.handleProactiveWakeup("daily_summary");
      } catch (error) {
        console.error("[ProactiveScheduler] Daily summary error:", error);
      }
    }
  }
}
