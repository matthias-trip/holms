import { useState, useCallback, useMemo, useRef } from "react";
import {
  MessageCircle, Radar, Clock, Eye, CheckCircle2, XCircle, Zap,
  ListFilter, Check, X, Brain, ChevronRight, ChevronDown, AlertCircle, Crosshair, Database,
} from "lucide-react";
import { Card, CardBody, Chip } from "@heroui/react";
import { trpc } from "../trpc";
import type { AgentActivity, TurnTrigger, TriageLane } from "@holms/shared";
import { humanizeToolUse, relativeTime } from "../utils/humanize";
import MarkdownMessage from "./MarkdownMessage";
import CycleMenu from "./CycleMenu";

// ── Types ──

interface Turn {
  turnId: string;
  activities: AgentActivity[];
}

type TimelineEntry =
  | { kind: "turn"; turn: Turn }
  | { kind: "reflex"; activity: AgentActivity }
  | { kind: "triage"; activity: AgentActivity }
  | { kind: "triage_classify"; activity: AgentActivity }
  | { kind: "history"; activity: AgentActivity };

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
    case "analyze_history_start":
      return "Analyzing history...";
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
    color: "var(--accent-9)",
    icon: <MessageCircle size={14} />,
  },
  device_events: {
    label: "Device event",
    color: "var(--warn)",
    icon: <Radar size={14} />,
  },
  automation: {
    label: "Automation",
    color: "var(--info)",
    icon: <Clock size={14} />,
  },
  proactive: {
    label: "Proactive check",
    color: "var(--gray-9)",
    icon: <Eye size={14} />,
  },
  approval_result: {
    label: "Approval result",
    color: "var(--ok)",
    icon: <CheckCircle2 size={14} />,
  },
  outcome_feedback: {
    label: "Outcome feedback",
    color: "#a855f7",
    icon: <XCircle size={14} />,
  },
  suggestions: {
    label: "Suggestions",
    color: "#94a3b8",
    icon: <Zap size={14} />,
  },
  onboarding: {
    label: "Onboarding",
    color: "var(--accent-9)",
    icon: <Eye size={14} />,
  },
};

// ── Activity filters ──

type ActivityFilter =
  | "chat" | "events" | "automation" | "proactive" | "approval" | "feedback"
  | "reflexes" | "triage" | "history";

const FILTER_GROUPS: { label: string; filters: { key: ActivityFilter; label: string; icon: React.ReactNode }[] }[] = [
  {
    label: "Turns",
    filters: [
      { key: "chat", label: "Chat", icon: <MessageCircle size={11} /> },
      { key: "events", label: "Events", icon: <Radar size={11} /> },
      { key: "automation", label: "Automations", icon: <Clock size={11} /> },
      { key: "proactive", label: "Proactive", icon: <Eye size={11} /> },
      { key: "approval", label: "Approvals", icon: <CheckCircle2 size={11} /> },
      { key: "feedback", label: "Feedback", icon: <XCircle size={11} /> },
    ],
  },
  {
    label: "System",
    filters: [
      { key: "reflexes", label: "Reflexes", icon: <Zap size={11} /> },
      { key: "triage", label: "Triage", icon: <ListFilter size={11} /> },
      { key: "history", label: "History", icon: <Database size={11} /> },
    ],
  },
];

const DEFAULT_FILTERS = new Set<ActivityFilter>([
  "chat", "events", "automation", "proactive", "approval", "feedback", "reflexes",
]);

/** Map turn trigger → filter key */
function triggerToFilter(trigger: TurnTrigger): ActivityFilter {
  switch (trigger) {
    case "user_message": return "chat";
    case "device_events": return "events";
    case "automation": return "automation";
    case "proactive": return "proactive";
    case "approval_result": return "approval";
    case "outcome_feedback": return "feedback";
    case "suggestions": return "chat";
    case "onboarding": return "chat";
    default: return "chat";
  }
}

function getTurnTrigger(turn: Turn): TurnTrigger {
  const turnStart = turn.activities.find((a) => a.type === "turn_start");
  if (!turnStart) return "user_message";
  return ((turnStart.data as Record<string, unknown>).trigger as TurnTrigger) ?? "user_message";
}

// ── Main component ──

export default function ActivityPanel() {
  const [expandedTurns, setExpandedTurns] = useState<Set<string>>(new Set());
  const [rawView, setRawView] = useState<Set<string>>(new Set());
  const [liveTurns, setLiveTurns] = useState<Map<string, Turn>>(new Map);
  const [liveOrphans, setLiveOrphans] = useState<AgentActivity[]>([]);
  const [activeFilters, setActiveFilters] = useState<Set<ActivityFilter>>(new Set(DEFAULT_FILTERS));
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: historicalTurns } = trpc.agents.turns.useQuery({ limit: 50 });
  const { data: historicalOrphans } = trpc.agents.orphanActivities.useQuery({ limit: 100 });

  const onActivity = useCallback((activity: AgentActivity) => {
    if (activity.turnId) {
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
    } else {
      setLiveOrphans((prev) => {
        if (prev.some((a) => a.id === activity.id)) return prev;
        return [...prev.slice(-99), activity];
      });
    }
  }, []);

  trpc.chat.onActivity.useSubscription(undefined, { onData: onActivity });

  const timeline = useMemo((): TimelineEntry[] => {
    const turnMap = new Map<string, Turn>();

    if (historicalTurns) {
      for (const t of historicalTurns) {
        turnMap.set(t.turnId, t);
      }
    }

    for (const [turnId, liveTurn] of liveTurns) {
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

    const entries: TimelineEntry[] = [];

    for (const turn of turnMap.values()) {
      entries.push({ kind: "turn", turn });
    }

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
      } else if (activity.type === "history_flush" || activity.type === "history_entity_discovered" || activity.type === "history_import") {
        entries.push({ kind: "history", activity });
      } else {
        entries.push({ kind: "reflex", activity });
      }
    }

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

  const toggleFilter = (filter: ActivityFilter) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      return next;
    });
  };

  const toggleGroup = (group: typeof FILTER_GROUPS[number]) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      const allActive = group.filters.every((f) => next.has(f.key));
      for (const f of group.filters) {
        if (allActive) next.delete(f.key);
        else next.add(f.key);
      }
      return next;
    });
  };

  const filteredTimeline = useMemo(() => {
    return timeline.filter((entry) => {
      if (entry.kind === "turn") {
        const trigger = getTurnTrigger(entry.turn);
        return activeFilters.has(triggerToFilter(trigger));
      }
      if (entry.kind === "reflex") return activeFilters.has("reflexes");
      if (entry.kind === "triage" || entry.kind === "triage_classify") return activeFilters.has("triage");
      if (entry.kind === "history") return activeFilters.has("history");
      return true;
    });
  }, [timeline, activeFilters]);

  const triggerCycle = trpc.agents.triggerCycle.useMutation();

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--gray-2)" }}>
      {/* Header */}
      <div
        className="flex justify-between items-center flex-shrink-0 px-6 py-4"
        style={{ borderBottom: "1px solid var(--gray-a3)" }}
      >
        <div>
          <h3 className="text-base font-medium" style={{ color: "var(--gray-12)" }}>Activity</h3>
          <p className="text-xs mt-1" style={{ color: "var(--gray-9)" }}>AI reasoning and decision history</p>
        </div>
        <div className="flex items-center gap-2">
          <CycleMenu onTrigger={(type) => triggerCycle.mutate({ type })} disabled={triggerCycle.isPending} />
          <span className="text-xs tabular-nums" style={{ fontFamily: "var(--font-mono)", color: "var(--gray-9)" }}>
            {timeline.filter((e) => e.kind === "turn").length} turns
          </span>
        </div>
      </div>

      {/* Filters */}
      <div
        className="flex items-center gap-1 px-6 py-2 flex-shrink-0 overflow-x-auto"
        style={{ borderBottom: "1px solid var(--gray-a3)", background: "var(--gray-1)" }}
      >
        {FILTER_GROUPS.map((group, gi) => (
          <div key={group.label} className="flex items-center gap-1">
            {gi > 0 && (
              <div
                className="mx-1.5 self-stretch"
                style={{ width: "1px", background: "var(--gray-a5)" }}
              />
            )}
            <button
              onClick={() => toggleGroup(group)}
              className="px-1.5 py-1 rounded-md text-[11px] font-medium transition-colors duration-150 whitespace-nowrap"
              style={{
                color: group.filters.every((f) => activeFilters.has(f.key))
                  ? "var(--gray-11)"
                  : "var(--gray-8)",
                background: "none",
                border: "none",
                cursor: "pointer",
              }}
              title={`Toggle all ${group.label.toLowerCase()}`}
            >
              {group.label}
            </button>
            {group.filters.map(({ key, label, icon }) => {
              const active = activeFilters.has(key);
              return (
                <button
                  key={key}
                  onClick={() => toggleFilter(key)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[12px] transition-all duration-150 whitespace-nowrap"
                  style={{
                    color: active ? "var(--gray-12)" : "var(--gray-8)",
                    background: active ? "var(--gray-3)" : "transparent",
                    border: `1px solid ${active ? "var(--gray-a5)" : "transparent"}`,
                  }}
                >
                  <span style={{ opacity: active ? 1 : 0.5 }}>{icon}</span>
                  {label}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-auto" ref={scrollRef}>
        {filteredTimeline.length === 0 ? (
          <div className="empty-state" style={{ paddingTop: "100px" }}>
            <div className="empty-state-icon">
              <Crosshair size={20} />
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: "var(--gray-12)" }}>
              No agent activity yet
            </p>
            <div className="empty-state-text">
              Send a message or wait for events. The agent's reasoning turns will appear here as a timeline.
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-2">
            {filteredTimeline.map((entry) => {
              if (entry.kind === "history") {
                return <HistoryRow key={entry.activity.id} activity={entry.activity} />;
              }
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
  const channel = data.channel as string | undefined;
  const channelDisplayName = data.channelDisplayName as string | undefined;
  const channelLabel = channelDisplayName ?? (channel && channel !== "web:default" ? channel : undefined);
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

  const lastActivity = [...turn.activities].reverse().find((a) => a.type !== "turn_start");
  const currentAction = isProcessing && lastActivity ? describeCurrentAction(lastActivity) : null;

  const steps = turn.activities.filter((a) => {
    if (a.type === "turn_start" || a.type === "thinking") return false;
    if (a.type === "tool_use") {
      const td = a.data as Record<string, unknown>;
      const toolName = String(td.tool ?? "");
      if (toolName.startsWith("deep_reason:") || toolName.startsWith("analyze_history:")) return false;
    }
    return true;
  });

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
      {/* Collapsed header */}
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
          <p className="text-sm truncate" style={{ color: "var(--gray-12)" }}>
            {channelLabel && (
              <span className="text-xs font-normal mr-1.5" style={{ color: "var(--gray-9)", fontFamily: "var(--font-mono)" }}>{channelLabel}</span>
            )}
            {config.label}
          </p>

          {isProcessing && currentAction && (
            <div className="flex items-center gap-1 mt-1">
              <span
                className="w-[5px] h-[5px] rounded-full flex-shrink-0"
                style={{
                  background: "var(--accent-9)",
                  animation: "pulse-dot 1.5s ease-in-out infinite",
                }}
              />
              <span className="text-xs truncate animate-fade-in" style={{ color: "var(--accent-10)" }}>
                {currentAction}
              </span>
            </div>
          )}

          {isProcessing && !currentAction && (
            <div className="mt-1.5 shimmer rounded" style={{ height: "6px", width: "120px", borderRadius: "3px" }} />
          )}

          {!isProcessing && resultText && (
            <p className="text-xs mt-1 truncate" style={{ color: "var(--gray-9)" }}>
              {resultText.slice(0, 120)}
            </p>
          )}

          {!isProcessing && (
            <div className="flex items-center gap-1 mt-1 flex-wrap" style={{ fontFamily: "var(--font-mono)" }}>
              <span className="text-xs" style={{ color: "var(--gray-9)" }}>{config.label}</span>
              <span className="text-xs" style={{ color: "var(--gray-9)" }}>&middot;</span>
              <span className="text-xs tabular-nums" style={{ color: "var(--gray-9)" }}>{steps.length} step{steps.length !== 1 ? "s" : ""}</span>
              {costUsd != null && costUsd > 0 && (
                <>
                  <span className="text-xs" style={{ color: "var(--gray-9)" }}>&middot;</span>
                  <span className="text-xs tabular-nums" style={{ color: "var(--gray-9)" }}>${costUsd.toFixed(4)}</span>
                </>
              )}
              {(inputTokens != null && inputTokens > 0 || outputTokens != null && outputTokens > 0) && (
                <>
                  <span className="text-xs" style={{ color: "var(--gray-9)" }}>&middot;</span>
                  <span className="text-xs tabular-nums" style={{ color: "var(--gray-9)" }}>
                    {((inputTokens ?? 0) + (outputTokens ?? 0)).toLocaleString()} tok
                  </span>
                </>
              )}
              {durationSec != null && durationSec > 0 && (
                <>
                  <span className="text-xs" style={{ color: "var(--gray-9)" }}>&middot;</span>
                  <span className="text-xs tabular-nums" style={{ color: "var(--gray-9)" }}>
                    {durationSec < 60
                      ? `${durationSec.toFixed(1)}s`
                      : `${Math.floor(durationSec / 60)}m ${Math.round(durationSec % 60)}s`}
                  </span>
                </>
              )}
            </div>
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

      {/* Expanded steps */}
      {expanded && steps.length > 0 && (
        <div
          className="px-4 pb-3"
          style={{ marginLeft: "14px", borderLeft: "2px solid var(--gray-a5)" }}
        >
          <div className="pl-5 space-y-0.5">
            {steps.map((activity) => (
              <StepRow key={activity.id} activity={activity} allActivities={turn.activities} />
            ))}
          </div>

          <div className="pl-5 mt-2 pt-2" style={{ borderTop: "1px solid var(--gray-a3)" }}>
            <button
              onClick={() => onToggleRaw()}
              className="flex items-center gap-1 text-xs cursor-pointer"
              style={{ color: "var(--gray-9)", background: "none", border: "none", padding: 0 }}
            >
              {showRaw ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {showRaw ? "Hide raw" : "Show raw"}
            </button>
            {showRaw && (
              <pre
                className="mt-2 p-3 rounded-lg overflow-x-auto text-[10px]"
                style={{
                  fontFamily: "var(--font-mono)",
                  background: "var(--gray-a3)",
                  border: "1px solid var(--gray-a5)",
                  color: "var(--gray-11)",
                  maxHeight: "300px",
                }}
              >
                {JSON.stringify(turn.activities, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </Card>
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
          <span className="flex-shrink-0 mt-0.5" style={{ color: "var(--accent-10)" }}>
            <Zap size={12} />
          </span>
          <span className="text-xs" style={{ color: "var(--gray-12)" }}>{label}</span>
        </div>
      );
    }

    case "deep_reason_start": {
      const problem = String(d.problem ?? "");
      return (
        <div className="flex items-start gap-2 py-1.5">
          <span className="flex-shrink-0 mt-0.5" style={{ color: "var(--info)" }}>
            <Brain size={12} />
          </span>
          <span className="text-xs" style={{ color: "var(--gray-12)" }}>
            Deep reasoning:{" "}
            <span style={{ color: "var(--gray-9)" }}>
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
              <Brain size={12} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium" style={{ color: "var(--gray-12)" }}>Deep reasoning result</span>
                <ChevronRight
                  size={10}
                  className="flex-shrink-0 transition-transform duration-150"
                  style={{
                    transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
                    color: "var(--gray-8)",
                  }}
                />
              </div>
              {!expanded && analysis && (
                <p className="text-xs mt-1" style={{ color: "var(--gray-9)" }}>
                  {analysis.slice(0, 200)}{analysis.length > 200 ? "..." : ""}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1 tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
                {model && <span className="text-xs" style={{ color: "var(--gray-9)" }}>{model}</span>}
                {costUsd != null && costUsd > 0 && <span className="text-xs" style={{ color: "var(--gray-9)" }}>${costUsd.toFixed(4)}</span>}
                {(inTok != null && inTok > 0 || outTok != null && outTok > 0) && (
                  <span className="text-xs" style={{ color: "var(--gray-9)" }}>{((inTok ?? 0) + (outTok ?? 0)).toLocaleString()} tok</span>
                )}
                {numTurns != null && numTurns > 0 && <span className="text-xs" style={{ color: "var(--gray-9)" }}>{numTurns} turn{numTurns !== 1 ? "s" : ""}</span>}
              </div>
            </div>
          </button>

          {expanded && (
            <div
              className="mt-2 ml-5 rounded-lg overflow-hidden"
              style={{ border: "1px solid var(--gray-a5)", background: "var(--gray-a3)" }}
            >
              {deepReasonTools.length > 0 && (
                <div className="px-3 pt-2 pb-1 space-y-0.5" style={{ borderBottom: "1px solid var(--gray-a5)" }}>
                  <p className="text-xs font-medium mb-1" style={{ color: "var(--gray-9)" }}>Tools used</p>
                  {deepReasonTools.map((step) => {
                    const td = step.data as Record<string, unknown>;
                    const toolName = String(td.tool ?? "").replace(/^deep_reason:/, "");
                    const label = humanizeToolUse(toolName, td.input);
                    return (
                      <div key={step.id} className="flex items-center gap-1 py-0.5">
                        <span style={{ color: "var(--accent-10)" }}>
                          <Zap size={10} />
                        </span>
                        <span className="text-xs" style={{ color: "var(--gray-12)" }}>{label}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div
                className="p-3 text-[11px] overflow-auto"
                style={{ color: "var(--gray-11)", maxHeight: "400px", lineHeight: 1.5 }}
              >
                <MarkdownMessage content={analysis} />
              </div>
            </div>
          )}
        </div>
      );
    }

    case "analyze_history_start": {
      const question = String(d.question ?? "");
      return (
        <div className="flex items-start gap-2 py-1.5">
          <span className="flex-shrink-0 mt-0.5" style={{ color: "var(--info)" }}>
            <Database size={12} />
          </span>
          <span className="text-xs" style={{ color: "var(--gray-12)" }}>
            Analyzing history:{" "}
            <span style={{ color: "var(--gray-9)" }}>
              {question.slice(0, 120)}{question.length > 120 ? "..." : ""}
            </span>
          </span>
        </div>
      );
    }

    case "analyze_history_result": {
      const question = String(d.question ?? "");
      const analysis = String(d.analysis ?? "");
      const model = d.model as string | undefined;
      const durationMs = d.durationMs as number | undefined;

      const analyzeHistoryTools = (allActivities ?? []).filter((s) => {
        if (s.type !== "tool_use") return false;
        const td = s.data as Record<string, unknown>;
        return String(td.tool ?? "").startsWith("analyze_history:");
      });

      return (
        <div className="py-1.5">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full text-left flex items-start gap-2"
          >
            <span className="flex-shrink-0 mt-0.5" style={{ color: "var(--info)" }}>
              <Database size={12} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium" style={{ color: "var(--gray-12)" }}>History analysis result</span>
                <ChevronRight
                  size={10}
                  className="flex-shrink-0 transition-transform duration-150"
                  style={{
                    transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
                    color: "var(--gray-8)",
                  }}
                />
              </div>
              {!expanded && analysis && (
                <p className="text-xs mt-1" style={{ color: "var(--gray-9)" }}>
                  {analysis.slice(0, 200)}{analysis.length > 200 ? "..." : ""}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1 tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
                {model && <span className="text-xs" style={{ color: "var(--gray-9)" }}>{model}</span>}
                {durationMs != null && durationMs > 0 && (
                  <span className="text-xs" style={{ color: "var(--gray-9)" }}>
                    {durationMs < 60000
                      ? `${(durationMs / 1000).toFixed(1)}s`
                      : `${Math.floor(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`}
                  </span>
                )}
                {question && <span className="text-xs" style={{ color: "var(--gray-9)" }}>{question.slice(0, 60)}</span>}
              </div>
            </div>
          </button>

          {expanded && (
            <div
              className="mt-2 ml-5 rounded-lg overflow-hidden"
              style={{ border: "1px solid var(--gray-a5)", background: "var(--gray-a3)" }}
            >
              {analyzeHistoryTools.length > 0 && (
                <div className="px-3 pt-2 pb-1 space-y-0.5" style={{ borderBottom: "1px solid var(--gray-a5)" }}>
                  <p className="text-xs font-medium mb-1" style={{ color: "var(--gray-9)" }}>Tools used</p>
                  {analyzeHistoryTools.map((step) => {
                    const td = step.data as Record<string, unknown>;
                    const toolName = String(td.tool ?? "").replace(/^analyze_history:/, "");
                    const label = humanizeToolUse(toolName, td.input);
                    return (
                      <div key={step.id} className="flex items-center gap-1 py-0.5">
                        <span style={{ color: "var(--accent-10)" }}>
                          <Zap size={10} />
                        </span>
                        <span className="text-xs" style={{ color: "var(--gray-12)" }}>{label}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div
                className="p-3 text-[11px] overflow-auto"
                style={{ color: "var(--gray-11)", maxHeight: "400px", lineHeight: 1.5 }}
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
            <AlertCircle size={12} />
          </span>
          <span className="text-xs" style={{ color: "var(--gray-12)" }}>
            Requested approval:{" "}
            <Chip variant="flat" color="warning" size="sm">pending</Chip>
            {reason && <span className="ml-1" style={{ color: "var(--gray-9)" }}>{reason.slice(0, 80)}</span>}
          </span>
        </div>
      );
    }

    case "approval_resolved": {
      const approved = d.approved === true;
      return (
        <div className="flex items-start gap-2 py-1.5">
          <span className="flex-shrink-0 mt-0.5" style={{ color: approved ? "var(--ok)" : "var(--err)" }}>
            {approved ? <Check size={12} /> : <X size={12} />}
          </span>
          <span className="text-xs" style={{ color: "var(--gray-12)" }}>
            <Chip variant="flat" color={approved ? "success" : "danger"} size="sm">
              {approved ? "Approved" : "Denied"}
            </Chip>
            {d.reason != null && <span className="ml-1" style={{ color: "var(--gray-9)" }}>{String(d.reason).slice(0, 80)}</span>}
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
            <CheckCircle2 size={12} />
          </span>
          <div className="flex-1 min-w-0">
            <span className="text-xs" style={{ color: "var(--gray-9)" }}>
              {result.slice(0, 120) || "Completed"}
              {result.length > 120 ? "..." : ""}
            </span>
            <div className="flex items-center gap-2 mt-1 tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
              {model && <span className="text-xs" style={{ color: "var(--gray-9)" }}>{model}</span>}
              {costUsd != null && costUsd > 0 && <span className="text-xs" style={{ color: "var(--gray-9)" }}>${costUsd.toFixed(4)}</span>}
              {(inTok != null && inTok > 0 || outTok != null && outTok > 0) && (
                <span className="text-xs" style={{ color: "var(--gray-9)" }}>{(inTok ?? 0).toLocaleString()}&uarr; {(outTok ?? 0).toLocaleString()}&darr;</span>
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
            <Brain size={12} />
          </span>
          <span className="text-xs" style={{ color: "var(--gray-12)" }}>
            {insight.slice(0, 120)}{insight.length > 120 ? "..." : ""}
          </span>
        </div>
      );
    }

    case "outcome": {
      return (
        <div className="flex items-start gap-2 py-1.5">
          <span className="flex-shrink-0 mt-0.5" style={{ color: "#a855f7" }}>
            <XCircle size={12} />
          </span>
          <span className="text-xs" style={{ color: "var(--gray-12)" }}>
            Feedback: {String(d.feedback ?? "").slice(0, 100)}
          </span>
        </div>
      );
    }

    default:
      return (
        <div className="flex items-start gap-2 py-1.5">
          <span className="flex-shrink-0 w-3 h-3 mt-0.5 rounded-full" style={{ background: "var(--gray-a5)" }} />
          <span className="text-xs" style={{ color: "var(--gray-9)" }}>
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
    icon: <Zap size={13} />,
  },
  batched: {
    color: "var(--info)",
    label: "batched",
    icon: <Clock size={13} />,
  },
  silent: {
    color: "var(--gray-8)",
    label: "silent",
    icon: <Eye size={13} />,
  },
};

function TriageClassifyRow({ activity }: { activity: AgentActivity }) {
  const [expanded, setExpanded] = useState(false);
  const d = activity.data as Record<string, unknown>;
  const lane = (d.lane as TriageLane) ?? "batched";
  const deviceId = String(d.deviceId ?? "");
  const eventType = String(d.eventType ?? "");
  const reason = String(d.reason ?? "");
  const ruleId = d.ruleId as string | null | undefined;
  const deviceName = d.deviceName ? String(d.deviceName) : undefined;
  const room = d.area ? String(d.area) : undefined;
  const config = LANE_CONFIG[lane];

  return (
    <div
      className="rounded-xl animate-fade-in"
      style={{
        background: `color-mix(in srgb, ${config.color} 2%, var(--color-background))`,
        border: `1px solid color-mix(in srgb, ${config.color} 6%, var(--gray-a5))`,
      }}
    >
      <div
        className="flex items-center gap-3 px-4 py-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex-shrink-0" style={{ color: config.color }}>
          {config.icon}
        </span>

        <Chip
          variant="flat"
          size="sm"
          style={{
            background: `color-mix(in srgb, ${config.color} 12%, transparent)`,
            color: config.color,
            minWidth: "52px",
            textAlign: "center",
            justifyContent: "center",
          }}
        >
          {config.label}
        </Chip>

        <span className="text-xs flex-1 truncate" style={{ color: "var(--gray-12)" }}>
          {room && (
            <>
              <span style={{ color: "var(--gray-9)" }}>{room}</span>
              <span style={{ color: "var(--gray-9)", margin: "0 4px" }}>&middot;</span>
            </>
          )}
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>
            {deviceName ?? deviceId}
          </span>
          <span style={{ color: "var(--gray-9)", margin: "0 4px" }}>&middot;</span>
          <span style={{ color: "var(--gray-9)" }}>{eventType}</span>
          {reason && reason !== "default" && (
            <>
              <span style={{ color: "var(--gray-9)", margin: "0 4px" }}>&middot;</span>
              <span style={{ color: "var(--gray-9)" }}>{reason}</span>
            </>
          )}
        </span>

        {ruleId ? (
          <Chip variant="flat" color="primary" size="sm">rule</Chip>
        ) : (
          <Chip variant="flat" size="sm">default</Chip>
        )}

        <span
          className="text-xs tabular-nums flex-shrink-0"
          style={{ fontFamily: "var(--font-mono)", color: "var(--gray-9)" }}
        >
          {relativeTime(activity.timestamp)}
        </span>

        <ChevronRight
          size={14}
          className="flex-shrink-0 transition-transform duration-200"
          style={{
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            color: "var(--gray-8)",
          }}
        />
      </div>

      <div data-collapse={expanded ? "open" : "closed"}>
        <div
          className="px-4 pb-3 pt-2"
          style={{ borderTop: "1px solid var(--gray-a3)" }}
        >
          <p className="text-xs leading-relaxed" style={{ color: "var(--gray-11)" }}>
            {reason || "No reason provided"}
          </p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {ruleId ? (
              <Chip variant="flat" color="primary" size="sm">Matched rule</Chip>
            ) : (
              <Chip variant="flat" size="sm">Default</Chip>
            )}
            <span
              className="text-xs"
              style={{ fontFamily: "var(--font-mono)", color: "var(--gray-9)" }}
            >
              {deviceId}
            </span>
            {room && (
              <span className="text-xs" style={{ color: "var(--gray-9)" }}>
                {room}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Triage Batch Row ──

function TriageBatchRow({ activity }: { activity: AgentActivity }) {
  const [expanded, setExpanded] = useState(false);
  const d = activity.data as Record<string, unknown>;
  const eventCount = d.eventCount as number ?? 0;
  const devices = (d.devices ?? []) as Array<{
    deviceId: string;
    deviceName?: string;
    eventCount: number;
    latestValue?: number;
    unit?: string;
    avgDelta?: number;
    maxDelta?: number;
  }>;
  const deviceCount = devices.length;

  return (
    <div
      className="rounded-xl animate-fade-in"
      style={{
        background: "color-mix(in srgb, var(--info) 3%, var(--color-background))",
        border: "1px solid color-mix(in srgb, var(--info) 10%, var(--gray-a5))",
      }}
    >
      <div
        className="flex items-center gap-3 px-4 py-2 cursor-pointer"
        onClick={() => devices.length > 0 && setExpanded(!expanded)}
      >
        <span style={{ color: "var(--info)" }}>
          <ListFilter size={13} />
        </span>

        <span className="text-xs flex-1 truncate" style={{ color: "var(--gray-12)" }}>
          <span className="font-medium" style={{ color: "var(--info)" }}>Triage</span>
          <span style={{ color: "var(--gray-9)", margin: "0 4px" }}>&middot;</span>
          {deviceCount > 0
            ? `Flushed ${deviceCount} device${deviceCount !== 1 ? "s" : ""} (${eventCount} event${eventCount !== 1 ? "s" : ""})`
            : `Flushed ${eventCount} batched event${eventCount !== 1 ? "s" : ""}`}
        </span>

        <span
          className="text-xs tabular-nums flex-shrink-0"
          style={{ fontFamily: "var(--font-mono)", color: "var(--gray-9)" }}
        >
          {relativeTime(activity.timestamp)}
        </span>

        {devices.length > 0 && (
          <ChevronRight
            size={14}
            className="flex-shrink-0 transition-transform duration-200"
            style={{
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
              color: "var(--gray-8)",
            }}
          />
        )}
      </div>

      {expanded && devices.length > 0 && (
        <div
          className="px-4 pb-3 pt-1 space-y-1"
          style={{ borderTop: "1px solid var(--gray-a3)" }}
        >
          {devices.map((dev) => (
            <div
              key={dev.deviceId}
              className="flex items-center gap-2 text-xs py-0.5"
              style={{ fontFamily: "var(--font-mono)", color: "var(--gray-11)" }}
            >
              <span className="truncate" style={{ color: "var(--gray-12)" }}>
                {dev.deviceName ?? dev.deviceId}
              </span>
              <span style={{ color: "var(--gray-9)" }}>&mdash;</span>
              <span className="tabular-nums" style={{ color: "var(--gray-9)" }}>
                {dev.eventCount} event{dev.eventCount !== 1 ? "s" : ""}
              </span>
              {dev.latestValue != null && (
                <>
                  <span style={{ color: "var(--gray-9)" }}>&middot;</span>
                  <span className="tabular-nums" style={{ color: "var(--gray-9)" }}>
                    latest: {dev.latestValue}{dev.unit ? ` ${dev.unit}` : ""}
                  </span>
                </>
              )}
              {dev.avgDelta != null && (
                <>
                  <span style={{ color: "var(--gray-9)" }}>&middot;</span>
                  <span className="tabular-nums" style={{ color: "var(--gray-9)" }}>
                    avg &Delta;{dev.avgDelta}{dev.unit ? ` ${dev.unit}` : ""}
                  </span>
                </>
              )}
              {dev.maxDelta != null && (
                <>
                  <span style={{ color: "var(--gray-9)" }}>&middot;</span>
                  <span className="tabular-nums" style={{ color: "var(--gray-9)" }}>
                    max &Delta;{dev.maxDelta}{dev.unit ? ` ${dev.unit}` : ""}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── History Row ──

function HistoryRow({ activity }: { activity: AgentActivity }) {
  const [expanded, setExpanded] = useState(false);
  const d = activity.data as Record<string, unknown>;

  let color: string;
  let chipLabel: string;
  let heading: string;
  let subtitle: string;
  let metaParts: string[];
  let expandedContent: React.ReactNode;

  if (activity.type === "history_flush") {
    const rowCount = d.rowCount as number ?? 0;
    const entityCount = d.entityCount as number ?? 0;
    const bufferSize = d.bufferSize as number | undefined;
    color = "var(--info)";
    chipLabel = "flush";
    heading = "History flush";
    subtitle = `${rowCount.toLocaleString()} row${rowCount !== 1 ? "s" : ""} · ${entityCount} entit${entityCount !== 1 ? "ies" : "y"} tracked`;
    metaParts = [`${rowCount.toLocaleString()} rows`, `${entityCount} entities`];
    if (bufferSize != null) metaParts.push(`buffer: ${bufferSize}`);
    expandedContent = (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--gray-9)" }}>
          {rowCount.toLocaleString()} rows
        </span>
        <span className="text-xs" style={{ color: "var(--gray-9)" }}>&middot;</span>
        <span className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--gray-9)" }}>
          {entityCount} entities
        </span>
        {bufferSize != null && (
          <>
            <span className="text-xs" style={{ color: "var(--gray-9)" }}>&middot;</span>
            <span className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--gray-9)" }}>
              buffer: {bufferSize}
            </span>
          </>
        )}
      </div>
    );
  } else if (activity.type === "history_entity_discovered") {
    const entityId = String(d.entityId ?? "");
    const friendlyName = String(d.friendlyName ?? entityId);
    const domain = String(d.domain ?? "");
    const valueType = String(d.valueType ?? "");
    const area = d.area ? String(d.area) : undefined;
    color = "var(--ok)";
    chipLabel = "discovered";
    heading = "New entity";
    subtitle = [area, friendlyName, domain, valueType].filter(Boolean).join(" · ");
    metaParts = [domain, valueType, area].filter(Boolean) as string[];
    expandedContent = (
      <>
        <span
          className="text-xs block mb-1"
          style={{ fontFamily: "var(--font-mono)", color: "var(--gray-11)" }}
        >
          {entityId}
        </span>
        <div className="flex items-center gap-1 flex-wrap" style={{ fontFamily: "var(--font-mono)" }}>
          {domain && <span className="text-xs" style={{ color: "var(--gray-9)" }}>{domain}</span>}
          {domain && area && <span className="text-xs" style={{ color: "var(--gray-9)" }}>&middot;</span>}
          {area && <span className="text-xs" style={{ color: "var(--gray-9)" }}>{area}</span>}
          {(domain || area) && valueType && <span className="text-xs" style={{ color: "var(--gray-9)" }}>&middot;</span>}
          {valueType && <span className="text-xs" style={{ color: "var(--gray-9)" }}>{valueType}</span>}
        </div>
      </>
    );
  } else {
    // history_import
    const rowCount = d.rowCount as number ?? 0;
    const deviceId = String(d.deviceId ?? "");
    const phase = String(d.phase ?? "done");
    const message = d.message as string | undefined;
    const isError = phase === "error";
    color = isError ? "var(--err)" : "var(--ok)";
    chipLabel = isError ? "import error" : "import done";
    heading = isError ? "Import failed" : "Import complete";
    subtitle = isError
      ? (message ?? "Import failed")
      : `${deviceId} · ${rowCount.toLocaleString()} row${rowCount !== 1 ? "s" : ""}`;
    metaParts = [deviceId, `${rowCount.toLocaleString()} rows`];
    expandedContent = (
      <>
        <div className="flex items-center gap-1 flex-wrap" style={{ fontFamily: "var(--font-mono)" }}>
          <span className="text-xs" style={{ color: "var(--gray-9)" }}>{deviceId}</span>
          <span className="text-xs" style={{ color: "var(--gray-9)" }}>&middot;</span>
          <span className="text-xs" style={{ color: "var(--gray-9)" }}>{phase}</span>
          <span className="text-xs" style={{ color: "var(--gray-9)" }}>&middot;</span>
          <span className="text-xs" style={{ color: "var(--gray-9)" }}>{rowCount.toLocaleString()} rows</span>
        </div>
        {message && (
          <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--gray-11)" }}>
            {message}
          </p>
        )}
      </>
    );
  }

  return (
    <Card
      className="animate-fade-in"
      style={{
        padding: 0,
        border: "1px solid var(--gray-a5)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
        background: "var(--gray-3)",
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left flex items-center gap-3 px-4 py-3 transition-colors rounded-xl"
      >
        <span
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
          style={{
            color,
            background: `color-mix(in srgb, ${color} 8%, transparent)`,
          }}
        >
          <Database size={14} />
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-sm truncate" style={{ color: "var(--gray-12)" }}>
            {heading}
          </p>

          <p className="text-xs mt-1 truncate" style={{ color: "var(--gray-9)" }}>
            {subtitle}
          </p>

          <div className="flex items-center gap-1 mt-1 flex-wrap" style={{ fontFamily: "var(--font-mono)" }}>
            <span className="text-xs" style={{ color: "var(--gray-9)" }}>{chipLabel}</span>
            {metaParts.map((part, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="text-xs" style={{ color: "var(--gray-9)" }}>&middot;</span>
                <span className="text-xs tabular-nums" style={{ color: "var(--gray-9)" }}>{part}</span>
              </span>
            ))}
          </div>
        </div>

        <span
          className="text-xs tabular-nums flex-shrink-0"
          style={{ fontFamily: "var(--font-mono)", color: "var(--gray-9)" }}
        >
          {relativeTime(activity.timestamp)}
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

      {expanded && (
        <div
          className="px-4 pb-3"
          style={{ marginLeft: "14px", borderLeft: "2px solid var(--gray-a5)" }}
        >
          <div className="pl-5">
            {expandedContent}
          </div>
        </div>
      )}
    </Card>
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
      className="flex items-center gap-3 px-4 py-2 rounded-xl animate-fade-in"
      style={{
        background: "color-mix(in srgb, var(--warn) 3%, var(--color-background))",
        border: "1px solid color-mix(in srgb, var(--warn) 10%, var(--gray-a5))",
      }}
    >
      <span style={{ color: "var(--warn)" }}>
        <Zap size={13} />
      </span>

      <span className="text-xs flex-1 truncate" style={{ color: "var(--gray-12)" }}>
        <span className="font-medium" style={{ color: "var(--warn)" }}>Reflex</span>
        <span style={{ color: "var(--gray-9)", margin: "0 4px" }}>&middot;</span>
        {reason}
        {triggerDevice && actionCommand && (
          <span style={{ color: "var(--gray-9)" }}>
            {" "}({triggerDevice} &rarr; {actionCommand})
          </span>
        )}
      </span>

      <span
        className="text-xs tabular-nums flex-shrink-0"
        style={{ fontFamily: "var(--font-mono)", color: "var(--gray-9)" }}
      >
        {relativeTime(activity.timestamp)}
      </span>
    </div>
  );
}
