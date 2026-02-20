import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Brain, Eye, Target, FileText, Sparkles, ChevronRight, Zap } from "lucide-react";
import { Tabs, Tab, Card, CardBody, Chip } from "@heroui/react";
import { trpc } from "../trpc";
import { humanizeToolUse, isWriteAction, relativeTime } from "../utils/humanize";
import MarkdownMessage from "./MarkdownMessage";
import CycleMenu from "./CycleMenu";
import type { AgentActivity } from "@holms/shared";

// ── Cycle type config ──

type CycleType = "reflection" | "situational" | "goal_review" | "daily_summary" | "unknown";

interface CycleConfig {
  label: string;
  color: string;
  icon: React.ReactNode;
}

const CYCLE_CONFIG: Record<CycleType, CycleConfig> = {
  reflection: {
    label: "Reflection",
    color: "#a855f7",
    icon: <Brain size={14} />,
  },
  situational: {
    label: "Situational check",
    color: "var(--info)",
    icon: <Eye size={14} />,
  },
  goal_review: {
    label: "Goal review",
    color: "var(--ok)",
    icon: <Target size={14} />,
  },
  daily_summary: {
    label: "Daily summary",
    color: "var(--warm)",
    icon: <FileText size={14} />,
  },
  unknown: {
    label: "Proactive",
    color: "var(--gray-9)",
    icon: <Sparkles size={14} />,
  },
};

// ── Helpers ──

interface Turn {
  turnId: string;
  activities: AgentActivity[];
}

function parseCycleType(turn: Turn): CycleType {
  const turnStart = turn.activities.find((a) => a.type === "turn_start");
  if (!turnStart) return "unknown";
  const summary = String((turnStart.data as Record<string, unknown>).summary ?? "");
  const suffix = summary.replace(/^Proactive:\s*/i, "").trim().toLowerCase();
  if (suffix.includes("reflection")) return "reflection";
  if (suffix.includes("situational")) return "situational";
  if (suffix.includes("goal")) return "goal_review";
  if (suffix.includes("daily") || suffix.includes("summary")) return "daily_summary";
  return "unknown";
}

function getResultData(turn: Turn) {
  const resultActivity = turn.activities.find((a) => a.type === "result");
  if (!resultActivity) return null;
  const d = resultActivity.data as Record<string, unknown>;
  return {
    text: String(d.result ?? ""),
    summary: (d.summary as string | null) ?? null,
    costUsd: d.costUsd as number | undefined,
    inputTokens: d.inputTokens as number | undefined,
    outputTokens: d.outputTokens as number | undefined,
    model: d.model as string | undefined,
    durationMs: d.durationMs as number | undefined,
    timestamp: resultActivity.timestamp,
  };
}

function getWriteActions(turn: Turn): { tool: string; label: string }[] {
  return turn.activities
    .filter((a) => a.type === "tool_use")
    .filter((a) => {
      const d = a.data as Record<string, unknown>;
      return isWriteAction(String(d.tool ?? ""));
    })
    .map((a) => {
      const d = a.data as Record<string, unknown>;
      const tool = String(d.tool ?? "");
      return { tool, label: humanizeToolUse(tool, d.input) };
    });
}

// ── Main component ──

export default function CycleOverview() {
  const [filter, setFilter] = useState<string>("all");
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [liveTurns, setLiveTurns] = useState<Map<string, Turn>>(new Map());
  const initialExpandSet = useRef(false);

  const { data: historicalCycles } = trpc.agents.proactiveCycles.useQuery({ limit: 20 });

  const onActivity = useCallback((activity: AgentActivity) => {
    if (!activity.turnId) return;
    setLiveTurns((prev) => {
      const next = new Map(prev);
      const existing = next.get(activity.turnId!);
      if (existing) {
        if (existing.activities.some((a) => a.id === activity.id)) return prev;
        next.set(activity.turnId!, {
          ...existing,
          activities: [...existing.activities, activity],
        });
      } else {
        next.set(activity.turnId!, { turnId: activity.turnId!, activities: [activity] });
      }
      return next;
    });
  }, []);

  trpc.chat.onActivity.useSubscription(undefined, { onData: onActivity });

  const cycles = useMemo(() => {
    const turnMap = new Map<string, Turn>();

    if (historicalCycles) {
      for (const t of historicalCycles) {
        turnMap.set(t.turnId, t);
      }
    }

    for (const [turnId, liveTurn] of liveTurns) {
      const isProactive = liveTurn.activities.some((a) => {
        if (a.type !== "turn_start") return false;
        return (a.data as Record<string, unknown>).trigger === "proactive";
      });
      if (!isProactive) continue;

      const existing = turnMap.get(turnId);
      if (existing) {
        const existingIds = new Set(existing.activities.map((a) => a.id));
        const newActivities = liveTurn.activities.filter((a) => !existingIds.has(a.id));
        turnMap.set(turnId, {
          turnId,
          activities: [...existing.activities, ...newActivities],
        });
      } else {
        turnMap.set(turnId, liveTurn);
      }
    }

    const all = Array.from(turnMap.values());

    all.sort((a, b) => {
      const tsA = a.activities[0]?.timestamp ?? 0;
      const tsB = b.activities[0]?.timestamp ?? 0;
      return tsB - tsA;
    });

    return all;
  }, [historicalCycles, liveTurns]);

  useEffect(() => {
    if (cycles.length > 0 && !initialExpandSet.current) {
      initialExpandSet.current = true;
      setExpandedCards(new Set([cycles[0].turnId]));
    }
  }, [cycles]);

  const filteredCycles = useMemo(() => {
    if (filter === "all") return cycles;
    return cycles.filter((turn) => parseCycleType(turn) === filter);
  }, [cycles, filter]);

  const toggleCard = (turnId: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(turnId)) next.delete(turnId);
      else next.add(turnId);
      return next;
    });
  };

  const triggerCycle = trpc.agents.triggerCycle.useMutation();

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--gray-2)" }}>
      {/* Header */}
      <div
        className="flex justify-between items-center flex-shrink-0 px-6 py-4"
        style={{ borderBottom: "1px solid var(--gray-a3)" }}
      >
        <div>
          <h3 className="text-base font-medium" style={{ color: "var(--gray-12)" }}>Overview</h3>
          <p className="text-xs mt-1" style={{ color: "var(--gray-9)" }}>
            What your home assistant has been up to
          </p>
        </div>
        <CycleMenu onTrigger={(type) => triggerCycle.mutate({ type })} disabled={triggerCycle.isPending} />
      </div>

      {/* Filter tabs */}
      <div
        className="px-6 py-2.5 flex-shrink-0 overflow-x-auto"
        style={{ borderBottom: "1px solid var(--gray-a3)", background: "var(--gray-1)" }}
      >
        <Tabs
          selectedKey={filter}
          onSelectionChange={(key) => setFilter(key as string)}
          size="sm"
          variant="light"
        >
          <Tab key="all" title="All" />
          <Tab key="reflection" title="Reflections" />
          <Tab key="situational" title="Situational" />
          <Tab key="goal_review" title="Goals" />
          <Tab key="daily_summary" title="Daily" />
        </Tabs>
      </div>

      {/* Cycle list */}
      <div className="flex-1 overflow-auto">
        {filteredCycles.length === 0 ? (
          <div className="empty-state" style={{ paddingTop: "100px" }}>
            <div className="empty-state-icon">
              <Target size={20} />
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: "var(--gray-12)" }}>
              No proactive cycles yet
            </p>
            <div className="empty-state-text">
              Trigger one manually or wait for the scheduler.
              The AI's autonomous reflections, checks, and summaries will appear here.
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-3">
            {filteredCycles.map((turn) => (
              <CycleCard
                key={turn.turnId}
                turn={turn}
                expanded={expandedCards.has(turn.turnId)}
                onToggle={() => toggleCard(turn.turnId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Cycle Card ──

function CycleCard({
  turn,
  expanded,
  onToggle,
}: {
  turn: Turn;
  expanded: boolean;
  onToggle: () => void;
}) {
  const cycleType = parseCycleType(turn);
  const config = CYCLE_CONFIG[cycleType];
  const result = getResultData(turn);
  const actions = getWriteActions(turn);
  const firstTs = turn.activities[0]?.timestamp ?? Date.now();
  const isProcessing = !result;

  const durationSec = result
    ? (result.timestamp - firstTs) / 1000
    : undefined;

  return (
    <Card
      className="animate-fade-in"
      style={{
        padding: 0,
        border: `1px solid ${isProcessing ? "var(--accent-a5)" : "var(--gray-a5)"}`,
        boxShadow: isProcessing
          ? "0 0 0 1px var(--accent-a5), 0 2px 8px rgba(79,110,247,0.06)"
          : "0 1px 2px rgba(0,0,0,0.03)",
        background: "var(--gray-3)",
      }}
    >
      {/* Header (always visible) */}
      <button
        onClick={onToggle}
        className="w-full text-left flex items-center gap-3 px-4 py-3 transition-colors rounded-xl"
      >
        <span
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
          style={{
            color: config.color,
            background: `color-mix(in srgb, ${config.color} 8%, transparent)`,
          }}
        >
          {config.icon}
        </span>

        <div className="flex-1 min-w-0">
          <Chip
            variant="flat"
            size="sm"
            style={{
              color: config.color,
              background: `color-mix(in srgb, ${config.color} 10%, transparent)`,
            }}
          >
            {config.label}
          </Chip>

          {isProcessing && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <span
                className="w-[5px] h-[5px] rounded-full flex-shrink-0"
                style={{
                  background: "var(--accent-9)",
                  animation: "pulse-dot 1.5s ease-in-out infinite",
                }}
              />
              <span className="text-xs" style={{ color: "var(--accent-10)" }}>Processing...</span>
            </div>
          )}

          {!isProcessing && result && !expanded && (
            <p className="text-xs mt-1 truncate" style={{ color: "var(--gray-9)" }}>
              {result.summary ?? result.text.slice(0, 140)}
            </p>
          )}
        </div>

        <span
          className="text-xs tabular-nums flex-shrink-0"
          style={{ fontFamily: "var(--font-mono)", color: "var(--gray-9)" }}
        >
          {relativeTime(firstTs)}
        </span>

        <ChevronRight
          size={12}
          className="flex-shrink-0 transition-transform duration-200"
          style={{
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            color: "var(--gray-8)",
          }}
        />
      </button>

      {/* Expanded content */}
      {expanded && result && (
        <div className="px-4 pb-4" style={{ marginLeft: "14px" }}>
          <div
            className="pl-5 text-[13px] leading-relaxed"
            style={{ color: "var(--gray-11)" }}
          >
            <MarkdownMessage content={result.text} />
          </div>

          {actions.length > 0 && (
            <div className="pl-5 mt-4">
              <span className="text-xs font-medium mb-2 block" style={{ color: "var(--gray-9)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Actions taken
              </span>
              <div className="space-y-1">
                {actions.map((action, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span style={{ color: "var(--accent-10)" }}>
                      <Zap size={10} />
                    </span>
                    <span className="text-xs" style={{ color: "var(--gray-9)" }}>{action.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div
            className="flex items-center gap-2 flex-wrap pl-5 mt-3 pt-3 tabular-nums"
            style={{
              borderTop: "1px solid var(--gray-a3)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {result.model && <span className="text-xs" style={{ color: "var(--gray-9)" }}>{result.model}</span>}
            {result.costUsd != null && result.costUsd > 0 && (
              <>
                <span className="text-xs" style={{ color: "var(--gray-9)" }}>&middot;</span>
                <span className="text-xs" style={{ color: "var(--gray-9)" }}>${result.costUsd.toFixed(4)}</span>
              </>
            )}
            {(result.inputTokens != null || result.outputTokens != null) && (
              <>
                <span className="text-xs" style={{ color: "var(--gray-9)" }}>&middot;</span>
                <span className="text-xs" style={{ color: "var(--gray-9)" }}>
                  {((result.inputTokens ?? 0) + (result.outputTokens ?? 0)).toLocaleString()} tok
                </span>
              </>
            )}
            {durationSec != null && durationSec > 0 && (
              <>
                <span className="text-xs" style={{ color: "var(--gray-9)" }}>&middot;</span>
                <span className="text-xs" style={{ color: "var(--gray-9)" }}>
                  {durationSec < 60
                    ? `${durationSec.toFixed(1)}s`
                    : `${Math.floor(durationSec / 60)}m ${Math.round(durationSec % 60)}s`}
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
