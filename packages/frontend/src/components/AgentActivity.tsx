import { useState } from "react";
import type { AgentActivity as ActivityType } from "@holms/shared";

const TYPE_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  thinking: { color: "var(--warm)", bg: "var(--warm-wash)", label: "Thinking" },
  tool_use: { color: "var(--glow-bright)", bg: "var(--glow-wash)", label: "Tool" },
  result: { color: "var(--ok)", bg: "var(--ok-dim)", label: "Result" },
  reflection: { color: "#db2777", bg: "rgba(219,39,119,0.08)", label: "Reflection" },
  outcome: { color: "var(--info)", bg: "var(--info-dim)", label: "Outcome" },
};

function formatToolName(raw: string): string {
  // deep_reason:mcp__memory__recall → recall [deep reason]
  const drMatch = raw.match(/^deep_reason:(.+)$/);
  if (drMatch) {
    const inner = formatToolName(drMatch[1]!);
    return `${inner} [deep reason]`;
  }
  // mcp__device-query__list_devices → list devices
  const mcpMatch = raw.match(/^mcp__[^_]+(?:-[^_]+)*__(.+)$/);
  if (mcpMatch) return mcpMatch[1]!.replace(/_/g, " ");
  return raw.replace(/_/g, " ");
}

function formatActivity(a: ActivityType): string {
  const d = a.data as Record<string, unknown>;
  switch (a.type) {
    case "tool_use":
      return formatToolName(String(d.tool ?? "unknown"));
    case "result":
      return String(d.result ?? "").slice(0, 80) || "Completed";
    case "thinking":
      return "Processing...";
    case "reflection":
      return String(d.insight ?? "").slice(0, 80);
    case "outcome":
      return String(d.feedback ?? "").slice(0, 80);
    default:
      return JSON.stringify(d).slice(0, 60);
  }
}

export default function AgentActivity({ activities }: { activities: ActivityType[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <span className="section-label">Assistant Activity</span>
        {activities.length > 0 && (
          <span
            className="text-[10px] tabular-nums"
            style={{ color: "var(--pewter)" }}
          >
            {activities.length} events
          </span>
        )}
      </div>

      <div
        className="flex-1 overflow-auto"
        style={{
          background: "var(--abyss)",
          border: "1px solid var(--graphite)",
          borderRadius: "var(--radius-md)",
          padding: "8px",
        }}
      >
        {activities.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M9 5v4l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </div>
            <div className="empty-state-text">
              Assistant reasoning and actions will appear here when active.
            </div>
          </div>
        ) : (
          <div className="space-y-px">
            {[...activities].reverse().map((a) => {
              const cfg = TYPE_CONFIG[a.type] ?? { color: "var(--steel)", bg: "var(--graphite)", label: "?" };
              const isExpanded = expanded.has(a.id);

              return (
                <div key={a.id}>
                  <button
                    onClick={() => toggle(a.id)}
                    className="w-full text-left flex items-center gap-2 py-1.5 px-2 rounded hover:bg-[var(--graphite)] transition-colors"
                    style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}
                  >
                    <span style={{ color: "var(--pewter)" }} className="flex-shrink-0 tabular-nums w-[72px]">
                      {new Date(a.timestamp).toLocaleTimeString()}
                    </span>
                    <span
                      className="badge flex-shrink-0"
                      style={{ background: cfg.bg, color: cfg.color }}
                    >
                      {cfg.label}
                    </span>
                    <span className="truncate" style={{ color: "var(--mist)" }}>
                      {formatActivity(a)}
                    </span>
                    <svg
                      width="10" height="10" viewBox="0 0 10 10" fill="none"
                      className="flex-shrink-0 ml-auto transition-transform"
                      style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
                    >
                      <path d="M3.5 2l3 3-3 3" stroke="var(--pewter)" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  </button>
                  {isExpanded && (
                    <pre
                      className="text-[10px] mx-2 mb-1 p-3 rounded-lg overflow-x-auto"
                      style={{
                        fontFamily: "var(--font-mono)",
                        background: "var(--obsidian)",
                        border: "1px solid var(--graphite)",
                        color: "var(--silver)",
                        maxHeight: "160px",
                      }}
                    >
                      {JSON.stringify(a.data, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
