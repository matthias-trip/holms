import { Brain, Eye, Target, FileText, Sparkles } from "lucide-react";
import { trpc } from "../../trpc";
import { relativeTime } from "../../utils/humanize";
import type { AgentActivity } from "@holms/shared";

interface Turn {
  turnId: string;
  activities: AgentActivity[];
}

type CycleType = "reflection" | "situational" | "goal_review" | "daily_summary" | "unknown";

const TYPE_CONFIG: Record<CycleType, { icon: typeof Brain; color: string; label: string }> = {
  reflection: { icon: Brain, color: "var(--info)", label: "Reflection" },
  situational: { icon: Eye, color: "var(--accent-9)", label: "Situational" },
  goal_review: { icon: Target, color: "var(--warm)", label: "Goal Review" },
  daily_summary: { icon: FileText, color: "var(--ok)", label: "Daily Summary" },
  unknown: { icon: Sparkles, color: "var(--gray-9)", label: "Proactive" },
};

function parseCycleType(turn: Turn): CycleType {
  const turnStart = turn.activities.find((a) => a.type === "turn_start");
  if (!turnStart) return "unknown";
  const data = turnStart.data as Record<string, unknown>;
  const proactiveType = String(data.proactiveType ?? "").toLowerCase();
  if (proactiveType === "reflection") return "reflection";
  if (proactiveType === "situational") return "situational";
  if (proactiveType === "goal_review") return "goal_review";
  if (proactiveType === "daily_summary") return "daily_summary";
  return "unknown";
}

function getSummary(turn: Turn): string {
  const resultActivity = turn.activities.find((a) => a.type === "result");
  if (!resultActivity) return "Processing...";
  const d = resultActivity.data as Record<string, unknown>;
  return String(d.summary ?? d.result ?? "No summary").slice(0, 120);
}

function getTimestamp(turn: Turn): number {
  const first = turn.activities[0];
  return first?.timestamp ?? Date.now();
}

export default function CompactCycleList() {
  const { data: cycles } = trpc.agents.proactiveCycles.useQuery({ limit: 5 });

  if (!cycles || cycles.length === 0) {
    return (
      <div className="text-xs py-4 text-center" style={{ color: "var(--gray-8)" }}>
        No recent agent activity
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {cycles.map((cycle: Turn, i: number) => {
        const cycleType = parseCycleType(cycle);
        const config = TYPE_CONFIG[cycleType];
        const Icon = config.icon;
        const summary = getSummary(cycle);
        const timestamp = getTimestamp(cycle);

        return (
          <div
            key={cycle.turnId}
            className="flex items-start gap-3 px-3 py-2.5 rounded-xl transition-colors duration-150 animate-fade-in"
            style={{
              animationDelay: `${i * 40}ms`,
              background: "var(--gray-3)",
              border: "1px solid var(--gray-a5)",
            }}
          >
            {/* Icon */}
            <div
              className="flex-shrink-0 flex items-center justify-center rounded-full mt-0.5"
              style={{
                width: 22,
                height: 22,
                background: `color-mix(in srgb, ${config.color} 12%, transparent)`,
              }}
            >
              <Icon size={11} style={{ color: config.color }} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: config.color }}
                >
                  {config.label}
                </span>
                <span
                  className="text-[10px] tabular-nums"
                  style={{ color: "var(--gray-8)", fontFamily: "var(--font-mono)" }}
                >
                  {relativeTime(timestamp)}
                </span>
              </div>
              <p
                className="text-xs truncate"
                style={{ color: "var(--gray-11)" }}
              >
                {summary}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
