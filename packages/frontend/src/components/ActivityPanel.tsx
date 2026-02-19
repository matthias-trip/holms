import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { trpc } from "../trpc";
import type { AgentActivity, TurnTrigger, TriageLane } from "@holms/shared";
import { humanizeToolUse, relativeTime } from "../utils/humanize";
import MarkdownMessage from "./MarkdownMessage";

// ── Types ──

interface Turn {
  turnId: string;
  activities: AgentActivity[];
}

type TimelineEntry =
  | { kind: "turn"; turn: Turn }
  | { kind: "reflex"; activity: AgentActivity }
  | { kind: "triage"; activity: AgentActivity }
  | { kind: "triage_classify"; activity: AgentActivity };

// ── Describe current action (for processing indicator) ──

function describeCurrentAction(activity: AgentActivity): string {
  const d = activity.data as Record<string, unknown>;
  switch (activity.type) {
    case "thinking":
      return "Thinking...";
    case "tool_use":
      return humanizeToolUse(String(d.tool ?? ""), d.input);
    case "deep_reason_start":
      return "Deep reasoning...";
    case "deep_reason_result":
      return "Deep reasoning complete";
    case "approval_pending":
      return "Waiting for approval...";
    case "reflection":
      return "Reflecting...";
    default:
      return "Processing...";
  }
}

// ── Trigger config ──

const TRIGGER_CONFIG: Record<TurnTrigger, { icon: React.ReactNode; label: string; color: string }> = {
  user_message: {
    label: "User message",
    color: "var(--glow)",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M2.5 3C2.5 2.17 3.17 1.5 4 1.5h8c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5H6l-3 2.5V3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    ),
  },
  device_events: {
    label: "Device event",
    color: "var(--warn)",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4 8a4 4 0 018 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.5" />
        <path d="M2 8a6 6 0 0112 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.3" />
      </svg>
    ),
  },
  schedule: {
    label: "Schedule",
    color: "var(--info)",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8 4v4.5l3 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  proactive: {
    label: "Proactive check",
    color: "var(--steel)",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="8" cy="8" r="2" fill="currentColor" opacity="0.4" />
      </svg>
    ),
  },
  approval_result: {
    label: "Approval result",
    color: "var(--ok)",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M4 8.5l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  outcome_feedback: {
    label: "Outcome feedback",
    color: "#a855f7",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
};

// ── Main component ──

export default function ActivityPanel() {
  const [expandedTurns, setExpandedTurns] = useState<Set<string>>(new Set());
  const [rawView, setRawView] = useState<Set<string>>(new Set());
  const [liveTurns, setLiveTurns] = useState<Map<string, Turn>>(new Map);
  const [liveOrphans, setLiveOrphans] = useState<AgentActivity[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: historicalTurns } = trpc.agents.turns.useQuery({ limit: 50 });
  const { data: historicalOrphans } = trpc.agents.orphanActivities.useQuery({ limit: 100 });

  // Live activity subscription
  const onActivity = useCallback((activity: AgentActivity) => {
    if (activity.turnId) {
      setLiveTurns((prev) => {
        const next = new Map(prev);
        const existing = next.get(activity.turnId!);
        if (existing) {
          // Deduplicate
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
    } else {
      setLiveOrphans((prev) => {
        if (prev.some((a) => a.id === activity.id)) return prev;
        return [...prev.slice(-99), activity];
      });
    }
  }, []);

  trpc.chat.onActivity.useSubscription(undefined, { onData: onActivity });

  // Build merged timeline
  const timeline = useMemo((): TimelineEntry[] => {
    // Merge historical + live turns
    const turnMap = new Map<string, Turn>();

    // Historical first
    if (historicalTurns) {
      for (const t of historicalTurns) {
        turnMap.set(t.turnId, t);
      }
    }

    // Overlay live turns
    for (const [turnId, liveTurn] of liveTurns) {
      const existing = turnMap.get(turnId);
      if (existing) {
        // Merge activities, deduplicate
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

    // Create entries
    const entries: TimelineEntry[] = [];

    for (const turn of turnMap.values()) {
      entries.push({ kind: "turn", turn });
    }

    // Merge historical + live orphans (dedup by id)
    const orphanMap = new Map<string, AgentActivity>();
    if (historicalOrphans) {
      for (const a of historicalOrphans) orphanMap.set(a.id, a);
    }
    for (const a of liveOrphans) orphanMap.set(a.id, a);

    for (const activity of orphanMap.values()) {
      if (activity.type === "triage") {
        entries.push({ kind: "triage", activity });
      } else if (activity.type === "triage_classify") {
        entries.push({ kind: "triage_classify", activity });
      } else {
        entries.push({ kind: "reflex", activity });
      }
    }

    // Sort by timestamp (newest first)
    entries.sort((a, b) => {
      const tsA = a.kind === "turn"
        ? (a.turn.activities[0]?.timestamp ?? 0)
        : a.activity.timestamp;
      const tsB = b.kind === "turn"
        ? (b.turn.activities[0]?.timestamp ?? 0)
        : b.activity.timestamp;
      return tsB - tsA;
    });

    return entries;
  }, [historicalTurns, liveTurns, liveOrphans, historicalOrphans]);

  const toggleTurn = (turnId: string) => {
    setExpandedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(turnId)) next.delete(turnId);
      else next.add(turnId);
      return next;
    });
  };

  const toggleRaw = (id: string) => {
    setRawView((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
            Activity
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: "var(--steel)" }}>
            AI reasoning and decision history
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CycleMenu onTrigger={(type) => triggerCycle.mutate({ type })} disabled={triggerCycle.isPending} />
          <div className="text-[11px] tabular-nums" style={{ color: "var(--pewter)", fontFamily: "var(--font-mono)" }}>
            {timeline.filter((e) => e.kind === "turn").length} turns
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-auto" ref={scrollRef}>
        {timeline.length === 0 ? (
          <div className="empty-state" style={{ paddingTop: "100px" }}>
            <div className="empty-state-icon">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="4" r="2.5" stroke="currentColor" strokeWidth="1.3" />
                <circle cx="4" cy="14" r="2" stroke="currentColor" strokeWidth="1.3" />
                <circle cx="16" cy="14" r="2" stroke="currentColor" strokeWidth="1.3" />
                <path d="M8 6l-2.5 6M12 6l2.5 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </div>
            <div className="text-[13px] font-medium" style={{ color: "var(--mist)" }}>
              No agent activity yet
            </div>
            <div className="empty-state-text">
              Send a message or wait for events. The agent's reasoning turns will appear here as a timeline.
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-2">
            {timeline.map((entry) => {
              if (entry.kind === "reflex") {
                return <ReflexRow key={entry.activity.id} activity={entry.activity} />;
              }
              if (entry.kind === "triage") {
                return <TriageBatchRow key={entry.activity.id} activity={entry.activity} />;
              }
              if (entry.kind === "triage_classify") {
                return <TriageClassifyRow key={entry.activity.id} activity={entry.activity} />;
              }
              return (
                <TurnCard
                  key={entry.turn.turnId}
                  turn={entry.turn}
                  expanded={expandedTurns.has(entry.turn.turnId)}
                  onToggle={() => toggleTurn(entry.turn.turnId)}
                  showRaw={rawView.has(entry.turn.turnId)}
                  onToggleRaw={() => toggleRaw(entry.turn.turnId)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Cycle Menu ──

const CYCLE_OPTIONS: Array<{ type: "situational" | "reflection" | "goal_review" | "daily_summary"; label: string; description: string }> = [
  { type: "situational", label: "Situational check", description: "Assess current home state" },
  { type: "reflection", label: "Reflection", description: "Review actions and triage rules" },
  { type: "goal_review", label: "Goal review", description: "Check progress on active goals" },
  { type: "daily_summary", label: "Daily summary", description: "Summarize today's activity" },
];

function CycleMenu({ onTrigger, disabled }: { onTrigger: (type: "situational" | "reflection" | "goal_review" | "daily_summary") => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
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

// ── Turn Card ──

function TurnCard({
  turn,
  expanded,
  onToggle,
  showRaw,
  onToggleRaw,
}: {
  turn: Turn;
  expanded: boolean;
  onToggle: () => void;
  showRaw: boolean;
  onToggleRaw: () => void;
}) {
  const turnStart = turn.activities.find((a) => a.type === "turn_start");
  const data = (turnStart?.data ?? {}) as Record<string, unknown>;
  const trigger = (data.trigger as TurnTrigger) ?? "proactive";
  const summary = (data.summary as string) ?? "Agent processing";
  const config = TRIGGER_CONFIG[trigger] ?? TRIGGER_CONFIG.proactive;
  const firstTs = turn.activities[0]?.timestamp ?? Date.now();
  const resultActivity = turn.activities.find((a) => a.type === "result");
  const resultData = resultActivity ? (resultActivity.data as Record<string, unknown>) : undefined;
  const resultText = resultData ? String(resultData.result ?? "") : "";
  const costUsd = resultData ? (resultData.costUsd as number | undefined) : undefined;
  const inputTokens = resultData ? (resultData.inputTokens as number | undefined) : undefined;
  const outputTokens = resultData ? (resultData.outputTokens as number | undefined) : undefined;
  const lastTs = resultActivity?.timestamp ?? turn.activities[turn.activities.length - 1]?.timestamp;
  const durationSec = lastTs && firstTs ? (lastTs - firstTs) / 1000 : undefined;
  const isProcessing = !resultActivity && turn.activities.length > 0;

  // Figure out what the agent is currently doing (last non-turn_start activity)
  const lastActivity = [...turn.activities].reverse().find((a) => a.type !== "turn_start");
  const currentAction = isProcessing && lastActivity ? describeCurrentAction(lastActivity) : null;

  // Steps: everything except turn_start, thinking, and deep_reason:* tool calls (those are shown nested in deep_reason_result)
  const steps = turn.activities.filter((a) => {
    if (a.type === "turn_start" || a.type === "thinking") return false;
    if (a.type === "tool_use") {
      const td = a.data as Record<string, unknown>;
      if (String(td.tool ?? "").startsWith("deep_reason:")) return false;
    }
    return true;
  });

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
      {/* Collapsed header */}
      <button
        onClick={onToggle}
        className="w-full text-left flex items-center gap-3 px-4 py-3 transition-colors"
        style={{ borderRadius: "var(--radius-xl)" }}
      >
        {/* Trigger icon */}
        <span
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
          style={{
            color: config.color,
            background: `color-mix(in srgb, ${config.color} 8%, transparent)`,
          }}
        >
          {config.icon}
        </span>

        {/* Summary + outcome preview */}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] truncate" style={{ color: "var(--white)" }}>
            {summary}
          </div>

          {/* When processing: show what the agent is currently doing */}
          {isProcessing && currentAction && (
            <div className="flex items-center gap-1.5 mt-1">
              <span
                className="w-[5px] h-[5px] rounded-full flex-shrink-0"
                style={{
                  background: "var(--glow)",
                  animation: "pulse-dot 1.5s ease-in-out infinite",
                }}
              />
              <span className="text-[11px] truncate animate-fade-in" style={{ color: "var(--glow-bright)" }}>
                {currentAction}
              </span>
            </div>
          )}

          {/* When processing but no specific action yet: shimmer */}
          {isProcessing && !currentAction && (
            <div className="mt-1.5 shimmer rounded" style={{ height: "6px", width: "120px", borderRadius: "3px" }} />
          )}

          {/* When done: show result preview */}
          {!isProcessing && resultText && (
            <div className="text-[11px] mt-0.5 truncate" style={{ color: "var(--steel)" }}>
              {resultText.slice(0, 120)}
            </div>
          )}

          {/* Always-visible meta line: trigger, steps, cost/tokens */}
          {!isProcessing && (
            <div className="flex items-center gap-1 text-[10px] mt-1 flex-wrap" style={{ color: "var(--pewter)", fontFamily: "var(--font-mono)" }}>
              <span>{config.label}</span>
              <span>&middot;</span>
              <span className="tabular-nums">{steps.length} step{steps.length !== 1 ? "s" : ""}</span>
              {costUsd != null && costUsd > 0 && (
                <>
                  <span>&middot;</span>
                  <span className="tabular-nums">${costUsd.toFixed(4)}</span>
                </>
              )}
              {(inputTokens != null && inputTokens > 0 || outputTokens != null && outputTokens > 0) && (
                <>
                  <span>&middot;</span>
                  <span className="tabular-nums">
                    {((inputTokens ?? 0) + (outputTokens ?? 0)).toLocaleString()} tok
                  </span>
                </>
              )}
              {durationSec != null && durationSec > 0 && (
                <>
                  <span>&middot;</span>
                  <span className="tabular-nums">
                    {durationSec < 60
                      ? `${durationSec.toFixed(1)}s`
                      : `${Math.floor(durationSec / 60)}m ${Math.round(durationSec % 60)}s`}
                  </span>
                </>
              )}
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

      {/* Expanded steps */}
      {expanded && steps.length > 0 && (
        <div
          className="px-4 pb-3"
          style={{ marginLeft: "14px", borderLeft: "2px solid var(--graphite)" }}
        >
          <div className="pl-5 space-y-0.5">
            {steps.map((activity) => (
              <StepRow key={activity.id} activity={activity} allActivities={turn.activities} />
            ))}
          </div>

          {/* Raw toggle */}
          <div className="pl-5 mt-2 pt-2" style={{ borderTop: "1px solid var(--graphite)" }}>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleRaw(); }}
              className="text-[10px] font-medium transition-colors"
              style={{ color: "var(--pewter)", fontFamily: "var(--font-mono)" }}
            >
              {showRaw ? "Hide raw" : "Show raw"}
            </button>
            {showRaw && (
              <pre
                className="mt-2 p-3 rounded-lg overflow-x-auto text-[10px]"
                style={{
                  fontFamily: "var(--font-mono)",
                  background: "var(--abyss)",
                  border: "1px solid var(--graphite)",
                  color: "var(--silver)",
                  maxHeight: "300px",
                }}
              >
                {JSON.stringify(turn.activities, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step Row ──

function StepRow({ activity, allActivities }: { activity: AgentActivity; allActivities?: AgentActivity[] }) {
  const [expanded, setExpanded] = useState(false);
  const d = activity.data as Record<string, unknown>;

  switch (activity.type) {
    case "tool_use": {
      const tool = String(d.tool ?? "");
      const label = humanizeToolUse(tool, d.input);
      return (
        <div className="flex items-start gap-2 py-1.5">
          <span className="flex-shrink-0 mt-0.5" style={{ color: "var(--glow-bright)" }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M7 2L4 6h3L5 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-[12px]" style={{ color: "var(--silver)" }}>{label}</span>
        </div>
      );
    }

    case "deep_reason_start": {
      const problem = String(d.problem ?? "");
      return (
        <div className="flex items-start gap-2 py-1.5">
          <span className="flex-shrink-0 mt-0.5" style={{ color: "var(--info)" }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="6" cy="6" r="1.5" fill="currentColor" opacity="0.4" />
              <path d="M6 1.5v1M6 9.5v1M1.5 6h1M9.5 6h1" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
            </svg>
          </span>
          <span className="text-[12px]" style={{ color: "var(--silver)" }}>
            Deep reasoning:{" "}
            <span style={{ color: "var(--steel)" }}>
              {problem.slice(0, 120)}{problem.length > 120 ? "..." : ""}
            </span>
          </span>
        </div>
      );
    }

    case "deep_reason_result": {
      const analysis = String(d.analysis ?? "");
      const model = d.model as string | undefined;
      const costUsd = d.costUsd as number | undefined;
      const inTok = d.inputTokens as number | undefined;
      const outTok = d.outputTokens as number | undefined;
      const numTurns = d.numTurns as number | undefined;

      // Collect deep_reason:* tool calls from this turn
      const deepReasonTools = (allActivities ?? []).filter((s) => {
        if (s.type !== "tool_use") return false;
        const td = s.data as Record<string, unknown>;
        return String(td.tool ?? "").startsWith("deep_reason:");
      });

      return (
        <div className="py-1.5">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full text-left flex items-start gap-2"
          >
            <span className="flex-shrink-0 mt-0.5" style={{ color: "var(--info)" }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
                <circle cx="6" cy="6" r="1.5" fill="currentColor" opacity="0.4" />
                <path d="M6 1.5v1M6 9.5v1M1.5 6h1M9.5 6h1" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
              </svg>
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] flex items-center gap-1.5" style={{ color: "var(--silver)" }}>
                <span className="font-medium" style={{ color: "var(--mist)" }}>
                  Deep reasoning result
                </span>
                <svg
                  width="10" height="10" viewBox="0 0 10 10" fill="none"
                  className="flex-shrink-0 transition-transform duration-150"
                  style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
                >
                  <path d="M3.5 2l3 3-3 3" stroke="var(--pewter)" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </div>
              {!expanded && analysis && (
                <div className="mt-0.5 text-[11px]" style={{ color: "var(--steel)" }}>
                  {analysis.slice(0, 200)}{analysis.length > 200 ? "..." : ""}
                </div>
              )}
              <div className="flex items-center gap-2 mt-0.5 text-[10px] tabular-nums" style={{ color: "var(--pewter)", fontFamily: "var(--font-mono)" }}>
                {model && <span>{model}</span>}
                {costUsd != null && costUsd > 0 && <span>${costUsd.toFixed(4)}</span>}
                {(inTok != null && inTok > 0 || outTok != null && outTok > 0) && (
                  <span>{((inTok ?? 0) + (outTok ?? 0)).toLocaleString()} tok</span>
                )}
                {numTurns != null && numTurns > 0 && <span>{numTurns} turn{numTurns !== 1 ? "s" : ""}</span>}
              </div>
            </div>
          </button>

          {expanded && (
            <div
              className="mt-2 ml-5 rounded-lg overflow-hidden"
              style={{ border: "1px solid var(--graphite)", background: "var(--abyss)" }}
            >
              {/* Nested tool calls */}
              {deepReasonTools.length > 0 && (
                <div className="px-3 pt-2 pb-1 space-y-0.5" style={{ borderBottom: "1px solid var(--graphite)" }}>
                  <div className="text-[10px] font-medium mb-1" style={{ color: "var(--pewter)" }}>
                    Tools used
                  </div>
                  {deepReasonTools.map((step) => {
                    const td = step.data as Record<string, unknown>;
                    const toolName = String(td.tool ?? "").replace(/^deep_reason:/, "");
                    const label = humanizeToolUse(toolName, td.input);
                    return (
                      <div key={step.id} className="flex items-center gap-1.5 text-[11px] py-0.5">
                        <span style={{ color: "var(--glow-bright)" }}>
                          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                            <path d="M7 2L4 6h3L5 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                        <span style={{ color: "var(--silver)" }}>{label}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Full analysis */}
              <div
                className="p-3 text-[11px] overflow-auto"
                style={{ color: "var(--silver)", maxHeight: "400px", lineHeight: 1.5 }}
              >
                <MarkdownMessage content={analysis} />
              </div>
            </div>
          )}
        </div>
      );
    }

    case "approval_pending": {
      const reason = String(d.reason ?? "");
      return (
        <div className="flex items-start gap-2 py-1.5">
          <span className="flex-shrink-0 mt-0.5" style={{ color: "var(--warn)" }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M6 3.5v3M6 8h.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="text-[12px]" style={{ color: "var(--silver)" }}>
            Requested approval:{" "}
            <span
              className="badge"
              style={{ background: "var(--warn-dim)", color: "var(--warn)" }}
            >
              pending
            </span>
            {reason && <span className="ml-1" style={{ color: "var(--steel)" }}>{reason.slice(0, 80)}</span>}
          </span>
        </div>
      );
    }

    case "approval_resolved": {
      const approved = d.approved === true;
      return (
        <div className="flex items-start gap-2 py-1.5">
          <span className="flex-shrink-0 mt-0.5" style={{ color: approved ? "var(--ok)" : "var(--err)" }}>
            {approved ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            )}
          </span>
          <span className="text-[12px]" style={{ color: "var(--silver)" }}>
            <span
              className="badge"
              style={{
                background: approved ? "var(--ok-dim)" : "var(--err-dim)",
                color: approved ? "var(--ok)" : "var(--err)",
              }}
            >
              {approved ? "Approved" : "Denied"}
            </span>
            {d.reason != null && <span className="ml-1" style={{ color: "var(--steel)" }}>{String(d.reason).slice(0, 80)}</span>}
          </span>
        </div>
      );
    }

    case "result": {
      const result = String(d.result ?? "");
      const costUsd = d.costUsd as number | undefined;
      const inTok = d.inputTokens as number | undefined;
      const outTok = d.outputTokens as number | undefined;
      const model = d.model as string | undefined;
      return (
        <div className="flex items-start gap-2 py-1.5">
          <span className="flex-shrink-0 mt-0.5" style={{ color: "var(--ok)" }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M4 6l1.5 1.5L8 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="flex-1 min-w-0">
            <span className="text-[12px]" style={{ color: "var(--steel)" }}>
              {result.slice(0, 120) || "Completed"}
              {result.length > 120 ? "..." : ""}
            </span>
            <div className="flex items-center gap-2 mt-0.5 text-[10px] tabular-nums" style={{ color: "var(--pewter)", fontFamily: "var(--font-mono)" }}>
              {model && <span>{model}</span>}
              {costUsd != null && costUsd > 0 && <span>${costUsd.toFixed(4)}</span>}
              {(inTok != null && inTok > 0 || outTok != null && outTok > 0) && (
                <span>{(inTok ?? 0).toLocaleString()}↑ {(outTok ?? 0).toLocaleString()}↓</span>
              )}
            </div>
          </div>
        </div>
      );
    }

    case "reflection": {
      const insight = String(d.insight ?? "");
      return (
        <div className="flex items-start gap-2 py-1.5">
          <span className="flex-shrink-0 mt-0.5" style={{ color: "#a855f7" }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="6" cy="6" r="1.5" fill="currentColor" opacity="0.3" />
            </svg>
          </span>
          <span className="text-[12px]" style={{ color: "var(--silver)" }}>
            {insight.slice(0, 120)}{insight.length > 120 ? "..." : ""}
          </span>
        </div>
      );
    }

    case "outcome": {
      return (
        <div className="flex items-start gap-2 py-1.5">
          <span className="flex-shrink-0 mt-0.5" style={{ color: "#a855f7" }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="text-[12px]" style={{ color: "var(--silver)" }}>
            Feedback: {String(d.feedback ?? "").slice(0, 100)}
          </span>
        </div>
      );
    }

    default:
      return (
        <div className="flex items-start gap-2 py-1.5">
          <span className="flex-shrink-0 w-3 h-3 mt-0.5 rounded-full" style={{ background: "var(--graphite)" }} />
          <span className="text-[12px]" style={{ color: "var(--steel)" }}>
            {activity.type}: {JSON.stringify(d).slice(0, 80)}
          </span>
        </div>
      );
  }
}

// ── Triage Classify Row ──

const LANE_CONFIG: Record<TriageLane, { color: string; icon: React.ReactNode; label: string }> = {
  immediate: {
    color: "var(--warn)",
    label: "immediate",
    icon: (
      <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
        <path d="M7 1.5L4 6h3L5 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  batched: {
    color: "var(--info)",
    label: "batched",
    icon: (
      <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
        <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.1" />
        <path d="M6 3v3.5l2.5 1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  silent: {
    color: "var(--pewter)",
    label: "silent",
    icon: (
      <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
        <path d="M2.5 4.5l7-2v7l-7-2v-3z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
        <path d="M1.5 8.5l9-9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
};

function TriageClassifyRow({ activity }: { activity: AgentActivity }) {
  const d = activity.data as Record<string, unknown>;
  const lane = (d.lane as TriageLane) ?? "batched";
  const deviceId = String(d.deviceId ?? "");
  const eventType = String(d.eventType ?? "");
  const reason = String(d.reason ?? "");
  const ruleId = d.ruleId as string | null | undefined;
  const deviceName = d.deviceName ? String(d.deviceName) : undefined;
  const room = d.room ? String(d.room) : undefined;
  const config = LANE_CONFIG[lane];

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 rounded-lg animate-fade-in"
      style={{
        background: `color-mix(in srgb, ${config.color} 2%, var(--obsidian))`,
        border: `1px solid color-mix(in srgb, ${config.color} 6%, var(--graphite))`,
      }}
    >
      <span className="flex-shrink-0" style={{ color: config.color }}>
        {config.icon}
      </span>

      <span
        className="badge flex-shrink-0"
        style={{
          background: `color-mix(in srgb, ${config.color} 12%, transparent)`,
          color: config.color,
          fontSize: "9px",
          padding: "1px 6px",
          minWidth: "52px",
          textAlign: "center",
        }}
      >
        {config.label}
      </span>

      <span className="flex-1 text-[12px] truncate" style={{ color: "var(--silver)" }}>
        {room && (
          <>
            <span style={{ color: "var(--steel)" }}>{room}</span>
            <span className="mx-1" style={{ color: "var(--pewter)" }}>&middot;</span>
          </>
        )}
        <span style={{ color: "var(--mist)", fontFamily: "var(--font-mono)", fontSize: "11px" }}>
          {deviceName ?? deviceId}
        </span>
        <span className="mx-1" style={{ color: "var(--pewter)" }}>&middot;</span>
        <span style={{ color: "var(--steel)" }}>{eventType}</span>
        {reason && reason !== "default" && (
          <>
            <span className="mx-1" style={{ color: "var(--pewter)" }}>&middot;</span>
            <span style={{ color: "var(--pewter)" }}>{reason}</span>
          </>
        )}
      </span>

      {ruleId ? (
        <span
          className="badge flex-shrink-0"
          style={{
            background: "color-mix(in srgb, var(--info) 10%, transparent)",
            color: "var(--info)",
            fontSize: "9px",
            padding: "1px 5px",
          }}
        >
          rule
        </span>
      ) : (
        <span
          className="badge flex-shrink-0"
          style={{
            background: "color-mix(in srgb, var(--pewter) 10%, transparent)",
            color: "var(--pewter)",
            fontSize: "9px",
            padding: "1px 5px",
          }}
        >
          default
        </span>
      )}

      <span
        className="text-[11px] tabular-nums flex-shrink-0"
        style={{ color: "var(--pewter)", fontFamily: "var(--font-mono)" }}
      >
        {relativeTime(activity.timestamp)}
      </span>
    </div>
  );
}

// ── Triage Batch Row ──

function TriageBatchRow({ activity }: { activity: AgentActivity }) {
  const d = activity.data as Record<string, unknown>;
  const eventCount = d.eventCount as number ?? 0;

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 rounded-lg animate-fade-in"
      style={{
        background: "color-mix(in srgb, var(--info) 3%, var(--obsidian))",
        border: "1px solid color-mix(in srgb, var(--info) 10%, var(--graphite))",
      }}
    >
      <span style={{ color: "var(--info)" }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </span>

      <span className="flex-1 text-[12px] truncate" style={{ color: "var(--silver)" }}>
        <span className="font-medium" style={{ color: "var(--info)" }}>Triage</span>
        <span className="mx-1.5" style={{ color: "var(--pewter)" }}>&middot;</span>
        Flushed {eventCount} batched event{eventCount !== 1 ? "s" : ""} to coordinator
      </span>

      <span
        className="text-[11px] tabular-nums flex-shrink-0"
        style={{ color: "var(--pewter)", fontFamily: "var(--font-mono)" }}
      >
        {relativeTime(activity.timestamp)}
      </span>
    </div>
  );
}

// ── Reflex Row ──

function ReflexRow({ activity }: { activity: AgentActivity }) {
  const d = activity.data as Record<string, unknown>;

  const reason = String(d.reason ?? d.actionCommand ?? "Automation triggered");
  const triggerDevice = d.triggerDevice ? String(d.triggerDevice) : undefined;
  const actionCommand = d.actionCommand ? String(d.actionCommand) : undefined;

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 rounded-lg animate-fade-in"
      style={{
        background: "color-mix(in srgb, var(--warn) 3%, var(--obsidian))",
        border: "1px solid color-mix(in srgb, var(--warn) 10%, var(--graphite))",
      }}
    >
      {/* Lightning icon */}
      <span style={{ color: "var(--warn)" }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path d="M9.5 1.5L5 9h4l-2 5.5L12 7H8l1.5-5.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      </span>

      <span className="flex-1 text-[12px] truncate" style={{ color: "var(--silver)" }}>
        <span className="font-medium" style={{ color: "var(--warn)" }}>Reflex</span>
        <span className="mx-1.5" style={{ color: "var(--pewter)" }}>&middot;</span>
        {reason}
        {triggerDevice && actionCommand && (
          <span style={{ color: "var(--steel)" }}>
            {" "}({triggerDevice} &rarr; {actionCommand})
          </span>
        )}
      </span>

      <span
        className="text-[11px] tabular-nums flex-shrink-0"
        style={{ color: "var(--pewter)", fontFamily: "var(--font-mono)" }}
      >
        {relativeTime(activity.timestamp)}
      </span>
    </div>
  );
}
