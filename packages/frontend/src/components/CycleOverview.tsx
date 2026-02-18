import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { trpc } from "../trpc";
import { humanizeToolUse, isWriteAction, relativeTime } from "../utils/humanize";
import MarkdownMessage from "./MarkdownMessage";
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
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="8" cy="8" r="2" fill="currentColor" opacity="0.4" />
      </svg>
    ),
  },
  situational: {
    label: "Situational check",
    color: "var(--info)",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4 8a4 4 0 018 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.5" />
      </svg>
    ),
  },
  goal_review: {
    label: "Goal review",
    color: "var(--ok)",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  daily_summary: {
    label: "Daily summary",
    color: "var(--warm)",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <rect x="3" y="2" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M6 6h4M6 9h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  unknown: {
    label: "Proactive",
    color: "var(--steel)",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="8" cy="8" r="2" fill="currentColor" opacity="0.4" />
      </svg>
    ),
  },
};

const FILTER_TABS: { id: CycleType | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "reflection", label: "Reflections" },
  { id: "situational", label: "Situational" },
  { id: "goal_review", label: "Goals" },
  { id: "daily_summary", label: "Daily" },
];

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
  const [filter, setFilter] = useState<CycleType | "all">("all");
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [liveTurns, setLiveTurns] = useState<Map<string, Turn>>(new Map());
  const initialExpandSet = useRef(false);

  const { data: historicalCycles } = trpc.agents.proactiveCycles.useQuery({ limit: 20 });

  // Live activity subscription — pick up new proactive turns in real time
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

  // Merge historical + live, filter for proactive
  const cycles = useMemo(() => {
    const turnMap = new Map<string, Turn>();

    if (historicalCycles) {
      for (const t of historicalCycles) {
        turnMap.set(t.turnId, t);
      }
    }

    // Overlay live turns (only keep proactive ones)
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

    // Sort newest first
    all.sort((a, b) => {
      const tsA = a.activities[0]?.timestamp ?? 0;
      const tsB = b.activities[0]?.timestamp ?? 0;
      return tsB - tsA;
    });

    return all;
  }, [historicalCycles, liveTurns]);

  // Auto-expand the most recent card
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
    <div className="h-full flex flex-col" style={{ background: "var(--void)" }}>
      {/* Header */}
      <div
        className="px-6 py-4 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: "1px solid var(--graphite)" }}
      >
        <div>
          <div className="text-[15px] font-medium" style={{ color: "var(--white)" }}>
            Overview
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: "var(--steel)" }}>
            What your home assistant has been up to
          </div>
        </div>
        <CycleMenu onTrigger={(type) => triggerCycle.mutate({ type })} disabled={triggerCycle.isPending} />
      </div>

      {/* Filter tabs */}
      <div
        className="px-6 py-2.5 flex gap-1 flex-shrink-0 overflow-x-auto"
        style={{ borderBottom: "1px solid var(--graphite)", background: "var(--abyss)" }}
      >
        {FILTER_TABS.map((tab) => {
          const isActive = filter === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150 flex-shrink-0"
              style={{
                background: isActive ? "var(--obsidian)" : "transparent",
                border: isActive ? "1px solid var(--graphite)" : "1px solid transparent",
                color: isActive ? "var(--white)" : "var(--steel)",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Cycle list */}
      <div className="flex-1 overflow-auto">
        {filteredCycles.length === 0 ? (
          <div className="empty-state" style={{ paddingTop: "100px" }}>
            <div className="empty-state-icon">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.3" />
                <circle cx="10" cy="10" r="3" fill="currentColor" opacity="0.2" />
                <path d="M10 2v3M10 15v3M2 10h3M15 10h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </div>
            <div className="text-[13px] font-medium" style={{ color: "var(--mist)" }}>
              No proactive cycles yet
            </div>
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

  // Compute duration from turn_start to result
  const durationSec = result
    ? (result.timestamp - firstTs) / 1000
    : undefined;

  return (
    <div
      className="rounded-xl transition-all duration-200 animate-fade-in"
      style={{
        background: "var(--obsidian)",
        border: `1px solid ${isProcessing ? "var(--glow-border)" : "var(--graphite)"}`,
        boxShadow: isProcessing
          ? "0 0 0 1px var(--glow-border), 0 2px 8px rgba(79,110,247,0.06)"
          : "0 1px 2px rgba(0,0,0,0.03)",
      }}
    >
      {/* Header (always visible) */}
      <button
        onClick={onToggle}
        className="w-full text-left flex items-center gap-3 px-4 py-3 transition-colors"
        style={{ borderRadius: "var(--radius-xl)" }}
      >
        {/* Cycle type icon */}
        <span
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
          style={{
            color: config.color,
            background: `color-mix(in srgb, ${config.color} 8%, transparent)`,
          }}
        >
          {config.icon}
        </span>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="text-[11px] font-medium px-2 py-0.5 rounded-md"
              style={{
                color: config.color,
                background: `color-mix(in srgb, ${config.color} 10%, transparent)`,
              }}
            >
              {config.label}
            </span>
          </div>

          {/* Processing state */}
          {isProcessing && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <span
                className="w-[5px] h-[5px] rounded-full flex-shrink-0"
                style={{
                  background: "var(--glow)",
                  animation: "pulse-dot 1.5s ease-in-out infinite",
                }}
              />
              <span className="text-[11px]" style={{ color: "var(--glow-bright)" }}>
                Processing...
              </span>
            </div>
          )}

          {/* Result preview (collapsed) */}
          {!isProcessing && result && !expanded && (
            <div className="text-[12px] mt-1 truncate" style={{ color: "var(--steel)" }}>
              {result.text.slice(0, 140)}
            </div>
          )}
        </div>

        {/* Time */}
        <span
          className="text-[11px] tabular-nums flex-shrink-0"
          style={{ color: "var(--pewter)", fontFamily: "var(--font-mono)" }}
        >
          {relativeTime(firstTs)}
        </span>

        {/* Chevron */}
        <svg
          width="12" height="12" viewBox="0 0 12 12" fill="none"
          className="flex-shrink-0 transition-transform duration-200"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          <path d="M4 2.5l4 3.5-4 3.5" stroke="var(--pewter)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Expanded content */}
      {expanded && result && (
        <div className="px-4 pb-4" style={{ marginLeft: "14px" }}>
          {/* Full result text (markdown) */}
          <div
            className="pl-5 text-[13px] leading-relaxed"
            style={{ color: "var(--silver)" }}
          >
            <MarkdownMessage content={result.text} />
          </div>

          {/* Actions taken */}
          {actions.length > 0 && (
            <div className="pl-5 mt-4">
              <div
                className="text-[10px] font-medium uppercase tracking-wider mb-2"
                style={{ color: "var(--pewter)" }}
              >
                Actions taken
              </div>
              <div className="space-y-1">
                {actions.map((action, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span style={{ color: "var(--glow-bright)" }}>
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                        <path d="M7 2L4 6h3L5 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span className="text-[12px]" style={{ color: "var(--steel)" }}>
                      {action.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Meta line */}
          <div
            className="pl-5 mt-3 pt-3 flex items-center gap-2 text-[10px] tabular-nums flex-wrap"
            style={{
              borderTop: "1px solid var(--graphite)",
              color: "var(--pewter)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {result.model && <span>{result.model}</span>}
            {result.costUsd != null && result.costUsd > 0 && (
              <>
                <span>&middot;</span>
                <span>${result.costUsd.toFixed(4)}</span>
              </>
            )}
            {(result.inputTokens != null || result.outputTokens != null) && (
              <>
                <span>&middot;</span>
                <span>
                  {((result.inputTokens ?? 0) + (result.outputTokens ?? 0)).toLocaleString()} tok
                </span>
              </>
            )}
            {durationSec != null && durationSec > 0 && (
              <>
                <span>&middot;</span>
                <span>
                  {durationSec < 60
                    ? `${durationSec.toFixed(1)}s`
                    : `${Math.floor(durationSec / 60)}m ${Math.round(durationSec % 60)}s`}
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cycle Trigger Menu ──

const CYCLE_OPTIONS: Array<{
  type: "situational" | "reflection" | "goal_review" | "daily_summary";
  label: string;
  description: string;
}> = [
  { type: "situational", label: "Situational check", description: "Assess current home state" },
  { type: "reflection", label: "Reflection", description: "Review actions and triage rules" },
  { type: "goal_review", label: "Goal review", description: "Check progress on active goals" },
  { type: "daily_summary", label: "Daily summary", description: "Summarize today's activity" },
];

function CycleMenu({
  onTrigger,
  disabled,
}: {
  onTrigger: (type: "situational" | "reflection" | "goal_review" | "daily_summary") => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-150"
        style={{
          background: open ? "var(--obsidian)" : "transparent",
          border: "1px solid var(--graphite)",
          color: disabled ? "var(--pewter)" : "var(--silver)",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M6 1v2M6 9v2M1 6h2M9 6h2M2.8 2.8l1.4 1.4M7.8 7.8l1.4 1.4M2.8 9.2l1.4-1.4M7.8 4.2l1.4-1.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        Trigger cycle
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms" }}>
          <path d="M1.5 3L4 5.5L6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 py-1 rounded-lg z-50 min-w-[200px]"
          style={{
            background: "var(--obsidian)",
            border: "1px solid var(--graphite)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          }}
        >
          {CYCLE_OPTIONS.map((opt) => (
            <button
              key={opt.type}
              onClick={() => { onTrigger(opt.type); setOpen(false); }}
              className="w-full text-left px-3 py-2 transition-colors hover:bg-[var(--abyss)]"
            >
              <div className="text-[12px] font-medium" style={{ color: "var(--silver)" }}>
                {opt.label}
              </div>
              <div className="text-[10px] mt-0.5" style={{ color: "var(--pewter)" }}>
                {opt.description}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
