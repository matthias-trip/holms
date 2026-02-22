import { useState } from "react";
import { Clock, Radio, Gauge, ChevronDown, ChevronRight, Zap, Filter, Play } from "lucide-react";
import { Card, CardBody, Chip } from "@heroui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { trpc } from "../trpc";
import type { Automation, AutomationDisplay, AutomationTrigger } from "@holms/shared";

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

function AutomationCard({ automation, index }: { automation: Automation; index: number }) {
  const [expanded, setExpanded] = useState(false);

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

            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs mb-1 cursor-pointer"
              style={{ color: "var(--gray-9)", background: "none", border: "none", padding: 0 }}
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {expanded ? "Hide raw instruction" : "Show raw instruction"}
            </button>

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

export default function AutomationsPanel() {
  const { data: automations } = trpc.automation.list.useQuery(undefined, {
    refetchInterval: 5000,
  });

  return (
    <div className="h-full flex flex-col p-6" style={{ background: "var(--gray-2)" }}>
      <div className="mb-5">
        <h3 className="text-base font-bold mb-2" style={{ color: "var(--gray-12)" }}>Automations</h3>
        <p className="text-xs" style={{ color: "var(--gray-9)", maxWidth: "500px", lineHeight: "1.6" }}>
          AI-reasoned automations triggered by time, device events, or state thresholds.
          The assistant reasons about the instruction each time an automation fires.
        </p>
      </div>

      <div className="flex-1 overflow-auto space-y-2">
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
    </div>
  );
}
