import { useState, useMemo } from "react";
import { trpc } from "../trpc";
import type { Memory, MemoryType } from "@holms/shared";

const TYPE_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  observation: { color: "var(--info)", bg: "var(--info-dim)", label: "Noticed" },
  preference: { color: "#7c3aed", bg: "rgba(124,58,237,0.08)", label: "Preference" },
  pattern: { color: "var(--ok)", bg: "var(--ok-dim)", label: "Pattern" },
  goal: { color: "var(--warn)", bg: "var(--warn-dim)", label: "Goal" },
  reflection: { color: "var(--err)", bg: "var(--err-dim)", label: "Reflection" },
  plan: { color: "#0891b2", bg: "rgba(8,145,178,0.08)", label: "Plan" },
};

const OWNER_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  orchestrator: { color: "var(--glow-bright)", bg: "var(--glow-wash)", label: "Orchestrator" },
  lighting: { color: "var(--warn)", bg: "var(--warn-dim)", label: "Lighting" },
  presence: { color: "var(--info)", bg: "var(--info-dim)", label: "Presence" },
  electricity: { color: "var(--ok)", bg: "var(--ok-dim)", label: "Electricity" },
};

const MEMORY_TYPES: (MemoryType | "all")[] = [
  "all", "observation", "preference", "pattern", "goal", "reflection", "plan",
];

type OwnerFilter = "all" | "orchestrator" | string;

function formatDayLabel(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (target.getTime() === today.getTime()) return "Today";
  if (target.getTime() === yesterday.getTime()) return "Yesterday";

  const diff = today.getTime() - target.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days < 7) {
    return date.toLocaleDateString(undefined, { weekday: "long" });
  }

  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function groupByDay(memories: Memory[]): { day: string; label: string; memories: Memory[] }[] {
  const groups = new Map<string, Memory[]>();

  // Sort newest first
  const sorted = [...memories].sort((a, b) => b.createdAt - a.createdAt);

  for (const mem of sorted) {
    const d = new Date(mem.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const group = groups.get(key);
    if (group) {
      group.push(mem);
    } else {
      groups.set(key, [mem]);
    }
  }

  return Array.from(groups.entries()).map(([day, mems]) => ({
    day,
    label: formatDayLabel(day),
    memories: mems,
  }));
}

export default function MemoryPanel() {
  const [filter, setFilter] = useState<MemoryType | "all">("all");
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
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

  const baseMemories = search.length > 0 ? searchResults : memories;

  const ownerOptions = useMemo(() => {
    const owners = new Set<string>();
    for (const mem of memories ?? []) {
      owners.add(mem.scope ?? "orchestrator");
    }
    return ["all", ...Array.from(owners).sort()] as OwnerFilter[];
  }, [memories]);

  const displayMemories = useMemo(() => {
    if (!baseMemories || ownerFilter === "all") return baseMemories;
    return baseMemories.filter((mem) => {
      const owner = mem.scope ?? "orchestrator";
      return owner === ownerFilter;
    });
  }, [baseMemories, ownerFilter]);

  const dayGroups = useMemo(
    () => groupByDay(displayMemories ?? []),
    [displayMemories],
  );

  return (
    <div className="h-full flex flex-col p-6" style={{ background: "var(--void)" }}>
      <div className="flex items-center justify-between mb-5">
        <span className="section-label">What I Remember</span>
        {displayMemories && (
          <span
            className="text-[11px]"
            style={{ color: "var(--pewter)" }}
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
      <div className="flex gap-1.5 mb-3 flex-wrap">
        {MEMORY_TYPES.map((type) => {
          const isActive = filter === type;
          const cfg = type !== "all" ? TYPE_CONFIG[type] : null;
          return (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all duration-150"
              style={{
                background: isActive ? (cfg?.bg ?? "var(--glow-wash)") : "var(--slate)",
                color: isActive ? (cfg?.color ?? "var(--glow-bright)") : "var(--steel)",
                border: isActive
                  ? `1px solid ${cfg?.color ?? "var(--glow)"}33`
                  : "1px solid var(--graphite)",
              }}
            >
              {type === "all" ? "All" : (cfg?.label ?? type)}
            </button>
          );
        })}
      </div>

      {/* Owner filters */}
      {ownerOptions.length > 2 && (
        <div className="flex gap-1.5 mb-4 flex-wrap items-center">
          <span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: "var(--pewter)" }}>
            Agent
          </span>
          {ownerOptions.map((owner) => {
            const isActive = ownerFilter === owner;
            const cfg = owner !== "all" ? OWNER_CONFIG[owner] : null;
            return (
              <button
                key={owner}
                onClick={() => setOwnerFilter(owner)}
                className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all duration-150"
                style={{
                  background: isActive ? (cfg?.bg ?? "var(--glow-wash)") : "var(--slate)",
                  color: isActive ? (cfg?.color ?? "var(--glow-bright)") : "var(--steel)",
                  border: isActive
                    ? `1px solid ${cfg?.color ?? "var(--glow)"}33`
                    : "1px solid var(--graphite)",
                }}
              >
                {owner === "all" ? "All" : (cfg?.label ?? owner)}
              </button>
            );
          })}
        </div>
      )}

      {/* Memory list grouped by day */}
      <div className="flex-1 overflow-auto">
        {(!displayMemories || displayMemories.length === 0) ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.3" />
                <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            </div>
            <div className="empty-state-text">
              No memories yet. As I learn about your home and preferences, they'll show up here.
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {dayGroups.map((group) => (
              <section key={group.day}>
                {/* Day header */}
                <div className="flex items-center gap-3 mb-3">
                  <h3
                    className="text-[12px] font-semibold uppercase tracking-wider flex-shrink-0"
                    style={{ color: "var(--steel)" }}
                  >
                    {group.label}
                  </h3>
                  <div
                    className="flex-1 h-px"
                    style={{ background: "var(--graphite)" }}
                  />
                  <span
                    className="text-[10px] tabular-nums flex-shrink-0"
                    style={{ color: "var(--pewter)" }}
                  >
                    {group.memories.length}
                  </span>
                </div>

                {/* Memory cards for this day */}
                <div className="space-y-2">
                  {group.memories.map((mem) => {
                    const cfg = TYPE_CONFIG[mem.type] ?? { color: "var(--steel)", bg: "var(--graphite)", label: "Other" };
                    return (
                      <div
                        key={mem.key}
                        className="rounded-xl p-4 group"
                        style={{
                          background: "var(--obsidian)",
                          border: "1px solid var(--graphite)",
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <span
                                className="badge"
                                style={{ background: cfg.bg, color: cfg.color }}
                              >
                                {cfg.label}
                              </span>
                              {(() => {
                                const ownerKey = mem.scope ?? "orchestrator";
                                const ownerCfg = OWNER_CONFIG[ownerKey] ?? {
                                  color: "var(--steel)",
                                  bg: "var(--slate)",
                                  label: ownerKey,
                                };
                                return (
                                  <span
                                    className="badge"
                                    style={{
                                      background: ownerCfg.bg,
                                      color: ownerCfg.color,
                                      borderLeft: `2px solid ${ownerCfg.color}33`,
                                    }}
                                  >
                                    {ownerCfg.label}
                                  </span>
                                );
                              })()}
                              <span
                                className="text-[10px] tabular-nums ml-auto"
                                style={{ color: "var(--pewter)" }}
                              >
                                {new Date(mem.createdAt).toLocaleTimeString(undefined, {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
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
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
