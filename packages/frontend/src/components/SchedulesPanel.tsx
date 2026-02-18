import { trpc } from "../trpc";

const RECURRENCE_LABELS: Record<string, string> = {
  once: "Once",
  daily: "Daily",
  weekdays: "Weekdays",
  weekends: "Weekends",
  weekly: "Weekly",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatNextFire(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = ts - now.getTime();
  const diffMins = Math.round(diffMs / 60_000);

  if (diffMins < 1) return "any moment";
  if (diffMins < 60) return `in ${diffMins}m`;
  if (diffMins < 1440) {
    const h = Math.floor(diffMins / 60);
    const m = diffMins % 60;
    return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
  }
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function SchedulesPanel() {
  const { data: schedules } = trpc.schedule.list.useQuery(undefined, {
    refetchInterval: 5000,
  });

  return (
    <div className="h-full flex flex-col p-6" style={{ background: "var(--void)" }}>
      <div className="mb-5">
        <span className="section-label">Schedules</span>
        <p
          className="text-[12px] mt-2"
          style={{ color: "var(--steel)", maxWidth: "500px", lineHeight: "1.6" }}
        >
          Time-based tasks managed by the assistant. Schedules fire at their set time and the
          assistant decides what to do.
        </p>
      </div>

      <div className="flex-1 overflow-auto space-y-2">
        {!schedules || schedules.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.3" />
                <path
                  d="M9 5v4.5l3 1.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="empty-state-text">
              No scheduled tasks yet. Ask the assistant to schedule things like "turn off lights at
              22:30 every day."
            </div>
          </div>
        ) : (
          schedules.map((schedule, i) => (
            <div
              key={schedule.id}
              className="rounded-xl p-4 animate-fade-in"
              style={{
                background: schedule.enabled ? "var(--obsidian)" : "var(--abyss)",
                border: "1px solid var(--graphite)",
                opacity: schedule.enabled ? 1 : 0.5,
                animationDelay: `${i * 40}ms`,
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  {/* Time + recurrence */}
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <span
                      className="text-[18px] font-semibold tabular-nums"
                      style={{ color: "var(--frost)", letterSpacing: "-0.02em" }}
                    >
                      {formatTime(schedule.hour, schedule.minute)}
                    </span>
                    <span
                      className="badge"
                      style={{ background: "var(--glow-wash)", color: "var(--glow)", border: "1px solid var(--glow-border)" }}
                    >
                      {RECURRENCE_LABELS[schedule.recurrence] ?? schedule.recurrence}
                      {schedule.recurrence === "weekly" && schedule.dayOfWeek != null
                        ? ` (${DAY_NAMES[schedule.dayOfWeek]})`
                        : ""}
                    </span>
                    {!schedule.enabled && (
                      <span
                        className="badge"
                        style={{ background: "var(--err-dim)", color: "var(--err)" }}
                      >
                        Disabled
                      </span>
                    )}
                  </div>

                  {/* Instruction */}
                  <div
                    className="text-[13px] leading-relaxed"
                    style={{ color: "var(--mist)" }}
                  >
                    {schedule.instruction}
                  </div>

                  {/* Meta */}
                  <div
                    className="flex items-center gap-3 mt-3 text-[10px]"
                    style={{ color: "var(--pewter)" }}
                  >
                    {schedule.enabled && (
                      <>
                        <span>Next: {formatNextFire(schedule.nextFireAt)}</span>
                        <span>·</span>
                      </>
                    )}
                    {schedule.lastFiredAt && (
                      <>
                        <span>
                          Last: {new Date(schedule.lastFiredAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span>·</span>
                      </>
                    )}
                    <span>
                      Created{" "}
                      {new Date(schedule.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
