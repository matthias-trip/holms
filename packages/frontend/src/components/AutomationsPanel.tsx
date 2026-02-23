import { useState } from "react";
import { Clock, Radio, Gauge, ChevronDown, ChevronRight, Zap, Filter, Play, History } from "lucide-react";
import { Card, CardBody, Chip } from "@heroui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { trpc } from "../trpc";
import { relativeTime } from "../utils/humanize";
import type { Automation, AutomationDisplay, AutomationTrigger } from "@holms/shared";

type View = "definitions" | "history";

const RECURRENCE_LABELS: Record<string, string> = {
  once: "Once",
  daily: "Daily",
  weekdays: "Weekdays",
  weekends: "Weekends",
  weekly: "Weekly",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const OPERATOR_LABELS: Record<string, string> = {
  gt: ">",
  lt: "<",
  eq: "=",
  gte: "≥",
  lte: "≤",
};

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatChannel(channel: string): string {
  const provider = channel.split(":")[0] ?? channel;
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function formatNextFire(ts: number): string {
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
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.001) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function TriggerBadge({ trigger }: { trigger: AutomationTrigger }) {
  switch (trigger.type) {
    case "time":
      return (
        <div className="flex items-center gap-2">
          <Clock size={14} style={{ color: "var(--accent-9)" }} />
          <span className="text-lg font-bold tabular-nums" style={{ letterSpacing: "-0.02em", color: "var(--gray-12)" }}>
            {formatTime(trigger.hour, trigger.minute)}
          </span>
          <Chip variant="flat" color="primary" size="sm">
            {RECURRENCE_LABELS[trigger.recurrence] ?? trigger.recurrence}
            {trigger.recurrence === "weekly" && trigger.dayOfWeek != null
              ? ` (${DAY_NAMES[trigger.dayOfWeek]})`
              : ""}
          </Chip>
        </div>
      );
    case "device_event":
      return (
        <div className="flex items-center gap-2">
          <Radio size={14} style={{ color: "var(--accent-9)" }} />
          <Chip variant="flat" color="secondary" size="sm">
            Device Event
          </Chip>
          <span className="text-xs" style={{ color: "var(--gray-11)" }}>
            {trigger.deviceId}
            {trigger.eventType ? ` → ${trigger.eventType}` : ""}
          </span>
        </div>
      );
    case "state_threshold":
      return (
        <div className="flex items-center gap-2">
          <Gauge size={14} style={{ color: "var(--accent-9)" }} />
          <Chip variant="flat" color="warning" size="sm">
            Threshold
          </Chip>
          <span className="text-xs" style={{ color: "var(--gray-11)" }}>
            {trigger.deviceId}.{trigger.stateKey} {OPERATOR_LABELS[trigger.operator]} {trigger.value}
          </span>
        </div>
      );
  }
}

// ── Pipeline flow components ──

const CIRCLE_SIZE = 18;
const CIRCLE_CENTER = CIRCLE_SIZE / 2; // 9px

function FlowNode({
  icon,
  label,
  accentColor,
  bgColor,
  borderColor,
  children,
  isLast,
  delay = 0,
}: {
  icon: React.ReactNode;
  label: string;
  accentColor: string;
  bgColor: string;
  borderColor: string;
  children: React.ReactNode;
  isLast: boolean;
  delay?: number;
}) {
  return (
    <div
      className="relative flex items-start gap-2.5 animate-flow-node-in"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Vertical connector line — runs from bottom of this circle to top of next */}
      {!isLast && (
        <div
          style={{
            position: "absolute",
            left: CIRCLE_CENTER,
            top: CIRCLE_SIZE + 1, // start just below the circle
            bottom: 0,
            width: 1,
            background: "var(--gray-a5)",
          }}
        />
      )}
      <div
        className="relative flex-shrink-0 flex items-center justify-center rounded-full"
        style={{
          width: CIRCLE_SIZE,
          height: CIRCLE_SIZE,
          marginTop: 1,
          background: bgColor,
          border: `1px solid ${borderColor}`,
          color: accentColor,
          zIndex: 1,
        }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0" style={{ paddingBottom: isLast ? 0 : 8 }}>
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: accentColor, letterSpacing: "0.06em" }}
        >
          {label}
        </span>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}

function AutomationFlow({
  trigger,
  display,
}: {
  trigger: AutomationTrigger;
  display: AutomationDisplay;
}) {
  const hasConditions = display.conditions && display.conditions.length > 0;
  const hasActions = display.actions && display.actions.length > 0;
  const stages: React.ReactNode[] = [];

  // When
  stages.push(
    <FlowNode
      key="when"
      icon={<Zap size={10} />}
      label="When"
      accentColor="var(--accent-9)"
      bgColor="var(--accent-a3)"
      borderColor="var(--accent-a5)"
      isLast={!hasConditions && !hasActions}
      delay={0}
    >
      <TriggerBadge trigger={trigger} />
    </FlowNode>,
  );

  // Conditions
  if (hasConditions) {
    stages.push(
      <FlowNode
        key="conditions"
        icon={<Filter size={10} />}
        label="Conditions"
        accentColor="var(--warm)"
        bgColor="var(--warm-wash)"
        borderColor="var(--warm-border)"
        isLast={!hasActions}
        delay={60}
      >
        <div className="flex flex-col gap-1 mt-0.5">
          {display.conditions!.map((c, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span
                className="flex-shrink-0 rounded-full mt-1.5"
                style={{
                  width: 5,
                  height: 5,
                  background: "var(--warm)",
                }}
              />
              <span className="text-xs" style={{ color: "var(--gray-12)", lineHeight: "1.5" }}>
                {c}
              </span>
            </div>
          ))}
        </div>
      </FlowNode>,
    );
  }

  // Then
  if (hasActions) {
    stages.push(
      <FlowNode
        key="then"
        icon={<Play size={10} />}
        label="Then"
        accentColor="var(--ok)"
        bgColor="var(--ok-dim)"
        borderColor="rgba(34, 197, 94, 0.18)"
        isLast
        delay={hasConditions ? 120 : 60}
      >
        <div className="flex flex-col gap-1 mt-0.5">
          {display.actions!.map((a, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span
                className="flex-shrink-0 rounded-full mt-1.5"
                style={{
                  width: 5,
                  height: 5,
                  background: "var(--ok)",
                }}
              />
              <span className="text-xs" style={{ color: "var(--gray-12)", lineHeight: "1.5" }}>
                {a}
              </span>
            </div>
          ))}
        </div>
      </FlowNode>,
    );
  }

  return (
    <div className="rounded-lg p-3" style={{ background: "var(--gray-a3)" }}>
      {stages}
    </div>
  );
}

// ── Status dot ──

function StatusDot({ status }: { status: "completed" | "running" }) {
  if (status === "running") {
    return (
      <span
        className="flex-shrink-0 rounded-full animate-pulse"
        style={{ width: 7, height: 7, background: "var(--accent-9)" }}
      />
    );
  }
  return (
    <span
      className="flex-shrink-0 rounded-full"
      style={{ width: 7, height: 7, background: "var(--ok)" }}
    />
  );
}

// ── Inline run history for per-automation card ──

function InlineRunHistory({ automationId }: { automationId: string }) {
  const { data: runs } = trpc.automation.runHistory.useQuery(
    { automationId, limit: 10 },
    { refetchInterval: 5000 },
  );

  if (!runs || runs.length === 0) {
    return (
      <div className="text-xs py-1" style={{ color: "var(--gray-8)" }}>
        No runs recorded
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 py-1">
      {runs.map((run) => (
        <div key={run.turnId} className="flex items-center gap-2 min-w-0">
          <StatusDot status={run.status} />
          <span
            className="flex-shrink-0 text-[11px] tabular-nums"
            style={{ color: "var(--gray-9)", fontFamily: "var(--font-mono)" }}
          >
            {relativeTime(run.timestamp)}
          </span>
          <span
            className="text-xs truncate flex-1 min-w-0"
            style={{ color: "var(--gray-12)" }}
          >
            {run.summary ?? (run.status === "running" ? "Running..." : "No summary")}
          </span>
          <span
            className="flex-shrink-0 text-[11px] tabular-nums"
            style={{ color: "var(--gray-9)", fontFamily: "var(--font-mono)" }}
          >
            {formatDuration(run.durationMs)}
          </span>
          <span
            className="flex-shrink-0 text-[11px] tabular-nums"
            style={{ color: "var(--gray-9)", fontFamily: "var(--font-mono)" }}
          >
            {formatCost(run.costUsd)}
          </span>
        </div>
      ))}
    </div>
  );
}

function AutomationCard({ automation, index }: { automation: Automation; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  return (
    <Card
      className="animate-fade-in"
      style={{
        opacity: automation.enabled ? 1 : 0.5,
        animationDelay: `${index * 40}ms`,
        background: "var(--gray-3)",
        border: "1px solid var(--gray-a5)",
      }}
    >
      <CardBody>
        <div className="flex justify-between gap-3">
          <div className="flex-1">
            <p className="text-sm font-medium" style={{ color: "var(--gray-12)" }}>
              {automation.summary}
            </p>

            <span className="text-xs tabular-nums" style={{ color: "var(--gray-9)" }}>
              {automation.enabled && automation.nextFireAt && (
                <>
                  Next: {formatNextFire(automation.nextFireAt)}
                  {" \u00b7 "}
                </>
              )}
              {automation.lastFiredAt && (
                <>
                  Last: {new Date(automation.lastFiredAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {" \u00b7 "}
                </>
              )}
              Created{" "}
              {new Date(automation.createdAt).toLocaleDateString()}
              {automation.channel && (
                <>
                  {" \u00b7 "}
                  via {formatChannel(automation.channel)}
                </>
              )}
            </span>

            <div className="mt-3 mb-2">
              <AutomationFlow trigger={automation.trigger} display={automation.display ?? {}} />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-xs mb-1 cursor-pointer"
                style={{ color: "var(--gray-9)", background: "none", border: "none", padding: 0 }}
              >
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {expanded ? "Hide raw instruction" : "Show raw instruction"}
              </button>

              <button
                onClick={() => setHistoryExpanded(!historyExpanded)}
                className="flex items-center gap-1 text-xs mb-1 cursor-pointer"
                style={{ color: "var(--gray-9)", background: "none", border: "none", padding: 0 }}
              >
                {historyExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Run history
              </button>
            </div>

            {expanded && (
              <div className="text-xs mt-1 p-2 rounded-lg" style={{ color: "var(--gray-11)", background: "var(--gray-a3)", lineHeight: "1.6" }}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
                    strong: ({ children }) => <strong className="font-semibold" style={{ color: "var(--gray-12)" }}>{children}</strong>,
                    em: ({ children }) => <em className="italic">{children}</em>,
                    code: ({ children }) => (
                      <code className="px-1 py-0.5 rounded text-[11px]" style={{ background: "var(--gray-a5)", fontFamily: "var(--font-mono)" }}>
                        {children}
                      </code>
                    ),
                    ul: ({ children }) => <ul className="list-disc pl-4 mb-1.5 space-y-0.5">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal pl-4 mb-1.5 space-y-0.5">{children}</ol>,
                    li: ({ children }) => <li>{children}</li>,
                  }}
                >
                  {automation.instruction}
                </ReactMarkdown>
              </div>
            )}

            {historyExpanded && (
              <div className="mt-1 p-2 rounded-lg" style={{ background: "var(--gray-a3)" }}>
                <InlineRunHistory automationId={automation.id} />
              </div>
            )}

            {!automation.enabled && (
              <Chip variant="flat" color="danger" size="sm" className="mt-1">
                Disabled
              </Chip>
            )}

          </div>
        </div>
      </CardBody>
    </Card>
  );
}

// ── Run History view (all runs) ──

function RunHistoryView() {
  const { data: runs } = trpc.automation.runHistory.useQuery(
    {},
    { refetchInterval: 5000 },
  );

  if (!runs || runs.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">
          <Clock size={18} />
        </div>
        <div className="empty-state-text">
          No automation runs yet. Runs will appear here once automations start firing.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {runs.map((run, i) => (
        <Card
          key={run.turnId}
          className="animate-fade-in"
          style={{
            animationDelay: `${i * 30}ms`,
            background: "var(--gray-3)",
            border: "1px solid var(--gray-a5)",
          }}
        >
          <CardBody className="py-3 px-4">
            <div className="flex items-start gap-2.5">
              <div className="mt-1">
                <StatusDot status={run.status} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs" style={{ color: "var(--gray-9)" }}>
                    {relativeTime(run.timestamp)}
                  </span>
                  <Chip variant="flat" size="sm" style={{ fontSize: 11 }}>
                    {run.automationSummary ?? "Unknown automation"}
                  </Chip>
                </div>

                {run.summary && (
                  <p className="text-xs mt-1" style={{ color: "var(--gray-12)", lineHeight: "1.5" }}>
                    {run.summary}
                  </p>
                )}

                {run.status === "running" && !run.summary && (
                  <p className="text-xs mt-1" style={{ color: "var(--gray-9)", fontStyle: "italic" }}>
                    Running...
                  </p>
                )}

                <div
                  className="flex items-center gap-3 mt-1.5 text-[11px] tabular-nums"
                  style={{ color: "var(--gray-9)", fontFamily: "var(--font-mono)" }}
                >
                  {run.status === "completed" && (
                    <>
                      <span>{formatDuration(run.durationMs)}</span>
                      <span>{formatCost(run.costUsd)}</span>
                      <span>{run.toolUseCount} tool{run.toolUseCount !== 1 ? "s" : ""}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

export default function AutomationsPanel() {
  const [view, setView] = useState<View>("definitions");
  const { data: automations } = trpc.automation.list.useQuery(undefined, {
    refetchInterval: 5000,
  });

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--gray-2)" }}>
      {/* Tab bar */}
      <div
        className="flex gap-1 flex-shrink-0"
        style={{
          padding: "10px 24px",
          borderBottom: "1px solid var(--gray-a3)",
          background: "var(--gray-1)",
        }}
      >
        {([
          { key: "definitions" as View, label: "Automations" },
          { key: "history" as View, label: "Run History", icon: <History size={12} /> },
        ]).map(({ key, label, icon }) => {
          const active = view === key;
          return (
            <button
              key={key}
              onClick={() => setView(key)}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150 flex-shrink-0 flex items-center gap-1.5 cursor-pointer"
              style={{
                background: active ? "var(--gray-3)" : "transparent",
                border: active ? "1px solid var(--gray-a5)" : "1px solid transparent",
                color: active ? "var(--gray-12)" : "var(--gray-8)",
              }}
            >
              {icon}
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {view === "definitions" && (
          <>
            <div className="mb-5">
              <h3 className="text-base font-bold mb-2" style={{ color: "var(--gray-12)" }}>Automations</h3>
              <p className="text-xs" style={{ color: "var(--gray-9)", maxWidth: "500px", lineHeight: "1.6" }}>
                AI-reasoned automations triggered by time, device events, or state thresholds.
                The assistant reasons about the instruction each time an automation fires.
              </p>
            </div>

            <div className="space-y-2">
              {!automations || automations.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <Clock size={18} />
                  </div>
                  <div className="empty-state-text">
                    No automations yet. Ask the assistant to create automations like "turn off lights at
                    22:30 every day" or "when motion is detected in the hallway, check if lights should be on."
                  </div>
                </div>
              ) : (
                automations.map((automation, i) => (
                  <AutomationCard key={automation.id} automation={automation} index={i} />
                ))
              )}
            </div>
          </>
        )}

        {view === "history" && <RunHistoryView />}
      </div>
    </div>
  );
}
