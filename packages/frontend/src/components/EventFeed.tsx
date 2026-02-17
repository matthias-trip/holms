import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "../trpc";
import type { BusEvent } from "@holms/shared";

const TYPE_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  "device:event": { color: "var(--info)", bg: "var(--info-dim)", label: "DEV" },
  "agent:thinking": { color: "var(--warn)", bg: "var(--warn-dim)", label: "THK" },
  "agent:tool_use": { color: "var(--glow-bright)", bg: "var(--glow-wash)", label: "MCP" },
  "agent:result": { color: "var(--ok)", bg: "var(--ok-dim)", label: "RES" },
  "reflex:triggered": { color: "var(--err)", bg: "var(--err-dim)", label: "RFX" },
};

function dedupeEvents(events: BusEvent[]): BusEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = `${e.timestamp}:${e.type}:${JSON.stringify(e.data)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatEventData(event: BusEvent): string {
  const d = event.data as Record<string, unknown>;
  switch (event.type) {
    case "device:event":
      return `${d.deviceId ?? "?"} → ${d.type ?? "event"}`;
    case "agent:tool_use":
      return String(d.tool ?? "unknown tool");
    case "agent:result": {
      const r = String(d.result ?? "");
      return r.length > 80 ? r.slice(0, 77) + "..." : r;
    }
    case "agent:thinking":
      return "Processing...";
    default:
      return JSON.stringify(d).slice(0, 80);
  }
}

export default function EventFeed() {
  const [events, setEvents] = useState<BusEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: initial } = trpc.events.recent.useQuery({ limit: 50 });

  useEffect(() => {
    if (initial) setEvents(dedupeEvents(initial));
  }, [initial]);

  const addEvent = useCallback((event: BusEvent) => {
    setEvents((prev) => {
      const key = `${event.timestamp}:${event.type}:${JSON.stringify(event.data)}`;
      const lastKey = prev.length > 0
        ? `${prev[prev.length - 1]!.timestamp}:${prev[prev.length - 1]!.type}:${JSON.stringify(prev[prev.length - 1]!.data)}`
        : "";
      if (key === lastKey) return prev;
      return [...prev.slice(-199), event];
    });
  }, []);

  trpc.events.onEvent.useSubscription(undefined, {
    onData: addEvent,
  });

  useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, paused]);

  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="section-label">Event Feed</span>
          {events.length > 0 && (
            <span
              className="text-[10px] tabular-nums"
              style={{ fontFamily: "var(--font-mono)", color: "var(--pewter)" }}
            >
              {events.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setPaused(!paused)}
          className="btn-ghost"
        >
          {paused ? "▶ Resume" : "⏸ Pause"}
        </button>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto"
        style={{
          background: "var(--abyss)",
          border: "1px solid var(--graphite)",
          borderRadius: "var(--radius-md)",
          padding: "8px",
        }}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {events.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">~</div>
            <div className="empty-state-text">
              Listening for events. Device activity and agent actions will appear here.
            </div>
          </div>
        ) : (
          <div className="space-y-px">
            {events.map((event, i) => {
              const cfg = TYPE_CONFIG[event.type] ?? {
                color: "var(--steel)",
                bg: "var(--graphite)",
                label: event.type.split(":")[1]?.slice(0, 3).toUpperCase() ?? "?",
              };
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 py-1 px-2 rounded hover:bg-[var(--graphite)] transition-colors"
                  style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}
                >
                  <span style={{ color: "var(--pewter)" }} className="flex-shrink-0 tabular-nums w-[72px]">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                  <span
                    className="badge flex-shrink-0"
                    style={{ background: cfg.bg, color: cfg.color }}
                  >
                    {cfg.label}
                  </span>
                  <span className="truncate" style={{ color: "var(--mist)" }}>
                    {formatEventData(event)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
