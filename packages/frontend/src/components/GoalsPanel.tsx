import { useState } from "react";
import {
  Eye, Zap, Flag, RefreshCw, AlertTriangle, MessageSquare,
  ChevronRight, Trash2, X, Target, ArrowRight, Clock,
} from "lucide-react";
import { Card, CardBody, Chip, Tabs, Tab } from "@heroui/react";
import { trpc } from "../trpc";
import { relativeTime } from "../utils/humanize";
import MarkdownMessage from "./MarkdownMessage";
import type { Goal, GoalEvent, GoalEventType } from "@holms/shared";

type FilterKey = "all" | "active" | "completed" | "attention";

const STATUS_STYLES: Record<string, { color: string; bg: string }> = {
  active: { color: "var(--accent-9)", bg: "var(--accent-a3)" },
  paused: { color: "var(--gray-9)", bg: "var(--gray-a3)" },
  completed: { color: "var(--ok)", bg: "var(--ok-dim)" },
  abandoned: { color: "var(--gray-8)", bg: "var(--gray-a3)" },
};

const EVENT_ICONS: Record<GoalEventType, { icon: typeof Eye; color: string; bg: string }> = {
  observation: { icon: Eye, color: "var(--info)", bg: "var(--info-dim)" },
  action: { icon: Zap, color: "var(--accent-9)", bg: "var(--accent-a3)" },
  milestone: { icon: Flag, color: "var(--ok)", bg: "var(--ok-dim)" },
  status_change: { icon: RefreshCw, color: "var(--gray-9)", bg: "var(--gray-a3)" },
  attention: { icon: AlertTriangle, color: "var(--warn)", bg: "var(--warn-dim)" },
  user_note: { icon: MessageSquare, color: "var(--gray-11)", bg: "var(--gray-a3)" },
};

// ── Pipeline flow components ──

const CIRCLE_SIZE = 18;
const CIRCLE_CENTER = CIRCLE_SIZE / 2;

function GoalFlowNode({
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
      {!isLast && (
        <div
          style={{
            position: "absolute",
            left: CIRCLE_CENTER,
            top: CIRCLE_SIZE + 1,
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

function GoalTimeline({ events }: { events: GoalEvent[] }) {
  return (
    <div className="flex flex-col mt-1">
      {events.map((event, i) => {
        const config = EVENT_ICONS[event.type] ?? EVENT_ICONS.observation;
        const Icon = config.icon;
        const isLast = i === events.length - 1;

        return (
          <div
            key={event.id}
            className="flex gap-3 animate-flow-node-in"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            {/* Connector column */}
            <div className="flex flex-col items-center" style={{ width: 18 }}>
              <div
                className="flex items-center justify-center rounded-full flex-shrink-0"
                style={{
                  width: 18,
                  height: 18,
                  background: config.bg,
                }}
              >
                <Icon size={10} strokeWidth={2} style={{ color: config.color }} />
              </div>
              {!isLast && (
                <div
                  className="flex-1"
                  style={{
                    width: 1,
                    background: "var(--gray-a5)",
                    minHeight: 16,
                  }}
                />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 pb-3 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="text-[11px] tabular-nums font-mono"
                  style={{ color: "var(--gray-8)" }}
                >
                  {event.type} · {relativeTime(event.timestamp)}
                </span>
              </div>
              <div className="text-[13px] mt-0.5 [&_p]:mb-1 [&_p:last-child]:mb-0" style={{ color: "var(--gray-11)" }}>
                <MarkdownMessage content={event.content} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GoalCard({
  goal,
  isExpanded,
  onToggle,
  index,
}: {
  goal: Goal;
  isExpanded: boolean;
  onToggle: () => void;
  index: number;
}) {
  const [noteText, setNoteText] = useState("");
  const utils = trpc.useUtils();

  const { data: detail } = trpc.goals.get.useQuery(
    { id: goal.id },
    { enabled: isExpanded },
  );

  const addNote = trpc.goals.addNote.useMutation({
    onSuccess: () => {
      setNoteText("");
      utils.goals.get.invalidate({ id: goal.id });
      utils.goals.list.invalidate();
    },
  });

  const updateStatus = trpc.goals.updateStatus.useMutation({
    onSuccess: () => {
      utils.goals.list.invalidate();
      utils.goals.get.invalidate({ id: goal.id });
    },
  });

  const dismissAttention = trpc.goals.dismissAttention.useMutation({
    onSuccess: () => {
      utils.goals.list.invalidate();
      utils.goals.get.invalidate({ id: goal.id });
    },
  });

  const deleteGoal = trpc.goals.delete.useMutation({
    onSuccess: () => {
      utils.goals.list.invalidate();
    },
  });

  const statusStyle = STATUS_STYLES[goal.status] ?? STATUS_STYLES.active;

  const createdDate = new Date(goal.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <Card
      className="animate-fade-in group"
      style={{
        opacity: goal.status === "abandoned" ? 0.5 : 1,
        animationDelay: `${index * 40}ms`,
        background: "var(--gray-3)",
        border: goal.needsAttention
          ? "1px solid var(--warm-border)"
          : "1px solid var(--gray-a5)",
      }}
      shadow="none"
    >
      <CardBody style={{ padding: 0 }}>
        {/* Header — clickable */}
        <button
          onClick={onToggle}
          className="w-full flex items-center gap-3 px-4 py-3 text-left"
          style={{ cursor: "pointer" }}
        >
          {goal.needsAttention && (
            <div
              className="w-2 h-2 rounded-full animate-pulse-dot flex-shrink-0"
              style={{ background: "var(--warn)" }}
            />
          )}
          <div className="flex-1 min-w-0">
            <span
              className="text-sm font-medium truncate block"
              style={{
                color: goal.status === "abandoned" ? "var(--gray-8)" : "var(--gray-12)",
                textDecoration: goal.status === "abandoned" ? "line-through" : undefined,
              }}
            >
              {goal.title}
            </span>
            {goal.summary && (
              <p
                className="text-[13px] truncate mt-0.5"
                style={{ color: "var(--gray-9)" }}
              >
                {goal.summary}
              </p>
            )}
            <span className="text-xs tabular-nums mt-1 block" style={{ color: "var(--gray-9)" }}>
              {goal.status !== "active" && (
                <>
                  <Chip
                    size="sm"
                    variant="flat"
                    style={{
                      color: statusStyle.color,
                      background: statusStyle.bg,
                      fontSize: 11,
                      height: 20,
                      verticalAlign: "middle",
                    }}
                  >
                    {goal.status}
                  </Chip>
                  {" · "}
                </>
              )}
              {goal.status === "active" && "active · "}
              updated {relativeTime(goal.updatedAt)}
              {" · "}
              created {createdDate}
              {goal.needsAttention && goal.attentionReason && (
                <>
                  {" · "}
                  <span style={{ color: "var(--warn)" }}>{goal.attentionReason}</span>
                </>
              )}
            </span>
          </div>
          <ChevronRight
            size={14}
            strokeWidth={1.5}
            style={{
              color: "var(--gray-7)",
              transition: "transform 200ms ease",
              transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
              flexShrink: 0,
            }}
          />
        </button>

        {/* Expanded content */}
        {isExpanded && (
          <div className="px-4 pb-4">
            {/* Flow pipeline */}
            <div className="rounded-lg p-3" style={{ background: "var(--gray-a3)" }}>
              {/* Objective */}
              <GoalFlowNode
                icon={<Target size={10} />}
                label="Objective"
                accentColor="var(--accent-9)"
                bgColor="var(--accent-a3)"
                borderColor="var(--accent-a5)"
                isLast={!goal.nextSteps && !(detail?.events && detail.events.length > 0)}
                delay={0}
              >
                <p className="text-[13px]" style={{ color: "var(--gray-11)" }}>
                  {goal.description}
                </p>
              </GoalFlowNode>

              {/* Next steps */}
              {goal.nextSteps && (
                <GoalFlowNode
                  icon={<ArrowRight size={10} />}
                  label="Next Steps"
                  accentColor="var(--warm)"
                  bgColor="var(--warm-wash)"
                  borderColor="var(--warm-border)"
                  isLast={!(detail?.events && detail.events.length > 0)}
                  delay={60}
                >
                  <div
                    className="text-[13px] [&_p]:mb-1 [&_p:last-child]:mb-0 [&_ul]:pl-4 [&_li]:mb-0.5"
                    style={{ color: "var(--gray-10)" }}
                  >
                    <MarkdownMessage content={goal.nextSteps} />
                  </div>
                </GoalFlowNode>
              )}

              {/* Timeline */}
              {detail?.events && detail.events.length > 0 && (
                <GoalFlowNode
                  icon={<Clock size={10} />}
                  label="Timeline"
                  accentColor="var(--gray-9)"
                  bgColor="var(--gray-a3)"
                  borderColor="var(--gray-a5)"
                  isLast
                  delay={goal.nextSteps ? 120 : 60}
                >
                  <GoalTimeline events={detail.events} />
                </GoalFlowNode>
              )}
            </div>

            {/* Add note */}
            <div className="flex gap-2 mt-3">
              <input
                type="text"
                placeholder="Add a note..."
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && noteText.trim()) {
                    addNote.mutate({ id: goal.id, content: noteText.trim() });
                  }
                }}
                className="flex-1 text-[13px] px-2.5 py-1.5 rounded-lg outline-none"
                style={{
                  background: "var(--gray-2)",
                  border: "1px solid var(--gray-a4)",
                  color: "var(--gray-12)",
                }}
              />
              <button
                disabled={!noteText.trim()}
                onClick={() => {
                  if (noteText.trim()) {
                    addNote.mutate({ id: goal.id, content: noteText.trim() });
                  }
                }}
                className="text-[13px] px-2.5 py-1 rounded-lg font-medium transition-all duration-150 disabled:opacity-40"
                style={{
                  background: "var(--accent-a3)",
                  color: "var(--accent-9)",
                }}
              >
                Post
              </button>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 mt-3">
              {goal.needsAttention && (
                <button
                  onClick={() => dismissAttention.mutate({ id: goal.id })}
                  className="text-[13px] px-2.5 py-1 rounded-lg font-medium transition-all duration-150 flex items-center gap-1 hover:brightness-125"
                  style={{
                    background: "var(--gray-a3)",
                    color: "var(--warn)",
                  }}
                >
                  <X size={12} />
                  Dismiss
                </button>
              )}
              {goal.status === "active" && (
                <button
                  onClick={() => updateStatus.mutate({ id: goal.id, status: "paused" })}
                  className="text-[13px] px-2.5 py-1 rounded-lg font-medium transition-all duration-150 hover:brightness-125"
                  style={{
                    background: "var(--gray-a3)",
                    color: "var(--gray-11)",
                  }}
                >
                  Pause
                </button>
              )}
              {goal.status === "paused" && (
                <button
                  onClick={() => updateStatus.mutate({ id: goal.id, status: "active" })}
                  className="text-[13px] px-2.5 py-1 rounded-lg font-medium transition-all duration-150 hover:brightness-125"
                  style={{
                    background: "var(--gray-a3)",
                    color: "var(--gray-11)",
                  }}
                >
                  Resume
                </button>
              )}
              {(goal.status === "active" || goal.status === "paused") && (
                <button
                  onClick={() => updateStatus.mutate({ id: goal.id, status: "completed" })}
                  className="text-[13px] px-2.5 py-1 rounded-lg font-medium transition-all duration-150 hover:brightness-125"
                  style={{
                    background: "var(--gray-a3)",
                    color: "var(--gray-11)",
                  }}
                >
                  Complete
                </button>
              )}
              {(goal.status === "active" || goal.status === "paused") && (
                <button
                  onClick={() => updateStatus.mutate({ id: goal.id, status: "abandoned" })}
                  className="text-[13px] px-2.5 py-1 rounded-lg font-medium transition-all duration-150 hover:brightness-125"
                  style={{
                    background: "var(--gray-a3)",
                    color: "var(--gray-11)",
                  }}
                >
                  Abandon
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={() => deleteGoal.mutate({ id: goal.id })}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg"
                style={{ color: "var(--gray-8)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--err)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--gray-8)")}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export default function GoalsPanel() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const queryInput = filter === "active" || filter === "completed"
    ? { status: filter as "active" | "completed" }
    : undefined;

  const { data: goals } = trpc.goals.list.useQuery(queryInput, {
    refetchInterval: 5000,
  });

  const filtered = filter === "attention"
    ? goals?.filter((g) => g.needsAttention)
    : goals;

  const activeCount = goals?.filter((g) => g.status === "active").length ?? 0;
  const attentionCount = filtered !== goals
    ? (filtered?.length ?? 0)
    : (goals?.filter((g) => g.needsAttention).length ?? 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex justify-between items-start flex-shrink-0 px-6 py-4"
        style={{ borderBottom: "1px solid var(--gray-a3)" }}
      >
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold" style={{ color: "var(--gray-12)" }}>
              Goals
            </h3>
            {attentionCount > 0 && (
              <span
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{ background: "var(--warn-dim)", color: "var(--warn)" }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full animate-pulse-dot"
                  style={{ background: "var(--warn)" }}
                />
                {attentionCount} need{attentionCount === 1 ? "s" : ""} attention
              </span>
            )}
          </div>
          <p className="text-xs mt-1" style={{ color: "var(--gray-9)", maxWidth: "500px", lineHeight: "1.6" }}>
            Long-term objectives tracked by the assistant. Progress is logged automatically during goal reviews.
          </p>
        </div>
        <span className="text-xs flex-shrink-0 mt-1" style={{ color: "var(--gray-9)" }}>
          {activeCount} active
        </span>
      </div>

      {/* Filter tabs */}
      <div
        className="px-6 py-2.5 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--gray-a3)", background: "var(--gray-1)" }}
      >
        <Tabs
          selectedKey={filter}
          onSelectionChange={(key) => setFilter(key as FilterKey)}
          size="sm"
          variant="light"
        >
          <Tab key="all" title="All" />
          <Tab key="active" title="Active" />
          <Tab key="completed" title="Completed" />
          <Tab key="attention" title="Needs Attention" />
        </Tabs>
      </div>

      {/* Goal list */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {(!filtered || filtered.length === 0) ? (
          <div className="empty-state" style={{ paddingTop: 100 }}>
            <div className="empty-state-icon"><Flag size={18} /></div>
            <p className="text-sm font-medium mb-1" style={{ color: "var(--gray-12)" }}>
              {filter === "attention" ? "No goals need attention" : filter === "completed" ? "No completed goals" : "No goals yet"}
            </p>
            <div className="empty-state-text">
              {filter === "all" || filter === "active"
                ? "Goals emerge as the assistant observes patterns in your home. You can also ask it to track specific objectives."
                : filter === "attention"
                  ? "All goals are on track."
                  : "Completed goals will appear here."
              }
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((goal, index) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                isExpanded={expandedId === goal.id}
                onToggle={() => setExpandedId(expandedId === goal.id ? null : goal.id)}
                index={index}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
