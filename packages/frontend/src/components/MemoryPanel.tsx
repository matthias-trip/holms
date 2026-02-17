import { useState } from "react";
import { trpc } from "../trpc";
import type { MemoryType } from "@holms/shared";

const TYPE_CONFIG: Record<string, { color: string; bg: string; icon: string }> = {
  observation: { color: "var(--info)", bg: "var(--info-dim)", icon: "◎" },
  preference: { color: "#c084fc", bg: "rgba(192,132,252,0.1)", icon: "♦" },
  pattern: { color: "var(--ok)", bg: "var(--ok-dim)", icon: "◇" },
  goal: { color: "var(--warn)", bg: "var(--warn-dim)", icon: "▲" },
  reflection: { color: "var(--err)", bg: "var(--err-dim)", icon: "○" },
  plan: { color: "#22d3ee", bg: "rgba(34,211,238,0.1)", icon: "□" },
};

const MEMORY_TYPES: (MemoryType | "all")[] = [
  "all", "observation", "preference", "pattern", "goal", "reflection", "plan",
];

export default function MemoryPanel() {
  const [filter, setFilter] = useState<MemoryType | "all">("all");
  const [search, setSearch] = useState("");

  const { data: memories, refetch } = trpc.memory.list.useQuery(
    filter === "all" ? undefined : { type: filter },
    { refetchInterval: 5000 },
  );

  const { data: searchResults } = trpc.memory.search.useQuery(
    { query: search },
    { enabled: search.length > 0 },
  );

  const deleteMutation = trpc.memory.delete.useMutation({
    onSuccess: () => refetch(),
  });

  const displayMemories = search.length > 0 ? searchResults : memories;

  return (
    <div className="h-full flex flex-col p-6" style={{ background: "var(--void)" }}>
      <div className="flex items-center justify-between mb-5">
        <span className="section-label">Agent Memory</span>
        {displayMemories && (
          <span
            className="text-[11px]"
            style={{ fontFamily: "var(--font-mono)", color: "var(--pewter)" }}
          >
            {displayMemories.length} entries
          </span>
        )}
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative">
          <svg
            width="14" height="14" viewBox="0 0 14 14" fill="none"
            className="absolute left-3 top-1/2 -translate-y-1/2"
          >
            <circle cx="6" cy="6" r="4.5" stroke="var(--pewter)" strokeWidth="1.2" />
            <path d="M9.5 9.5L12.5 12.5" stroke="var(--pewter)" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search memories..."
            className="input-base w-full"
            style={{ paddingLeft: "34px" }}
          />
        </div>
      </div>

      {/* Type filters */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {MEMORY_TYPES.map((type) => {
          const isActive = filter === type;
          const cfg = type !== "all" ? TYPE_CONFIG[type] : null;
          return (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all duration-150"
              style={{
                fontFamily: "var(--font-mono)",
                background: isActive ? (cfg?.bg ?? "var(--glow-wash)") : "var(--slate)",
                color: isActive ? (cfg?.color ?? "var(--glow-bright)") : "var(--steel)",
                border: isActive
                  ? `1px solid ${cfg?.color ?? "var(--glow)"}33`
                  : "1px solid var(--graphite)",
              }}
            >
              {type}
            </button>
          );
        })}
      </div>

      {/* Memory list */}
      <div className="flex-1 overflow-auto space-y-2">
        {(!displayMemories || displayMemories.length === 0) ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.3" />
                <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            </div>
            <div className="empty-state-text">
              No memories stored yet. The coordinator builds understanding over time through observations, preferences, and reflections.
            </div>
          </div>
        ) : (
          displayMemories.map((mem, i) => {
            const cfg = TYPE_CONFIG[mem.type] ?? { color: "var(--steel)", bg: "var(--graphite)", icon: "?" };
            return (
              <div
                key={mem.key}
                className="rounded-xl p-4 animate-fade-in group"
                style={{
                  background: "var(--obsidian)",
                  border: "1px solid var(--graphite)",
                  animationDelay: `${i * 40}ms`,
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className="badge"
                        style={{ background: cfg.bg, color: cfg.color }}
                      >
                        {cfg.icon} {mem.type}
                      </span>
                      <span
                        className="text-[10px] truncate"
                        style={{ fontFamily: "var(--font-mono)", color: "var(--pewter)" }}
                      >
                        {mem.key}
                      </span>
                    </div>
                    <p className="text-[13px] leading-relaxed" style={{ color: "var(--mist)" }}>
                      {mem.content}
                    </p>
                    {mem.tags.length > 0 && (
                      <div className="flex gap-1 mt-2">
                        {mem.tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] px-1.5 py-0.5 rounded"
                            style={{
                              fontFamily: "var(--font-mono)",
                              background: "var(--slate)",
                              color: "var(--steel)",
                            }}
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => deleteMutation.mutate({ key: mem.key })}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[var(--err-dim)]"
                    style={{ color: "var(--steel)" }}
                    title="Delete memory"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
