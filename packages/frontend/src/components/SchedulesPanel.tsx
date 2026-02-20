import { Clock } from "lucide-react";
import { Card, CardBody, Chip } from "@heroui/react";
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
    <div className="h-full flex flex-col p-6" style={{ background: "var(--gray-2)" }}>
      <div className="mb-5">
        <h3 className="text-base font-bold mb-2" style={{ color: "var(--gray-12)" }}>Schedules</h3>
        <p className="text-xs" style={{ color: "var(--gray-9)", maxWidth: "500px", lineHeight: "1.6" }}>
          Time-based tasks managed by the assistant. Schedules fire at their set time and the
          assistant decides what to do.
        </p>
      </div>

      <div className="flex-1 overflow-auto space-y-2">
        {!schedules || schedules.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Clock size={18} />
            </div>
            <div className="empty-state-text">
              No scheduled tasks yet. Ask the assistant to schedule things like "turn off lights at
              22:30 every day."
            </div>
          </div>
        ) : (
          schedules.map((schedule, i) => (
            <Card
              key={schedule.id}
              className="animate-fade-in"
              style={{
                opacity: schedule.enabled ? 1 : 0.5,
                animationDelay: `${i * 40}ms`,
                background: "var(--gray-3)",
                border: "1px solid var(--gray-a5)",
              }}
            >
              <CardBody>
                <div className="flex justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg font-bold tabular-nums" style={{ letterSpacing: "-0.02em", color: "var(--gray-12)" }}>
                        {formatTime(schedule.hour, schedule.minute)}
                      </span>
                      <Chip variant="flat" color="primary" size="sm">
                        {RECURRENCE_LABELS[schedule.recurrence] ?? schedule.recurrence}
                        {schedule.recurrence === "weekly" && schedule.dayOfWeek != null
                          ? ` (${DAY_NAMES[schedule.dayOfWeek]})`
                          : ""}
                      </Chip>
                      {!schedule.enabled && (
                        <Chip variant="flat" color="danger" size="sm">
                          Disabled
                        </Chip>
                      )}
                    </div>

                    <p className="text-sm" style={{ lineHeight: "1.6", color: "var(--gray-12)" }}>
                      {schedule.instruction}
                    </p>

                    <div className="flex items-center gap-3 mt-3">
                      <span className="text-xs tabular-nums" style={{ color: "var(--gray-9)" }}>
                        {schedule.enabled && (
                          <>
                            Next: {formatNextFire(schedule.nextFireAt)}
                            {" \u00b7 "}
                          </>
                        )}
                        {schedule.lastFiredAt && (
                          <>
                            Last: {new Date(schedule.lastFiredAt).toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            {" \u00b7 "}
                          </>
                        )}
                        Created{" "}
                        {new Date(schedule.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
