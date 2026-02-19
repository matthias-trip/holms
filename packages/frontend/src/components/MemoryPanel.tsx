import { useState, useMemo } from "react";
import { trpc } from "../trpc";
import type { Memory, ScoredMemory, MemoryQueryMeta } from "@holms/shared";

// Deterministic color from tag name
function tagColor(tag: string): { color: string; bg: string } {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return {
    color: `hsl(${hue}, 65%, 60%)`,
    bg: `hsla(${hue}, 65%, 60%, 0.1)`,
  };
}

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

function groupByDay<T extends Memory>(memories: T[]): { day: string; label: string; memories: T[] }[] {
  const groups = new Map<string, T[]>();

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

function similarityColor(score: number): { color: string; bg: string } {
  if (score > 0.7) return { color: "var(--ok)", bg: "var(--ok-dim)" };
  if (score > 0.4) return { color: "var(--warn)", bg: "var(--warn-dim)" };
  return { color: "var(--err)", bg: "var(--err-dim)" };
}

export default function MemoryPanel() {
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const tagsInput = activeTags.size > 0 ? { tags: Array.from(activeTags) } : undefined;

  const { data: memories, refetch } = trpc.memory.list.useQuery(
    tagsInput,
    { refetchInterval: 5000 },
  );

  const { data: searchData } = trpc.memory.search.useQuery(
    { query: search },
    { enabled: search.length > 0 },
  );

  const searchResults = searchData?.memories;
  const searchMeta = searchData?.meta;

  const deleteMutation = trpc.memory.delete.useMutation({
    onSuccess: () => refetch(),
  });

  // Derive unique tags from all memories
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const mem of memories ?? []) {
      for (const tag of mem.tags) {
        tags.add(tag);
      }
    }
    return Array.from(tags).sort();
  }, [memories]);

  const displayMemories = search.length > 0 ? searchResults : memories;

  const dayGroups = useMemo(
    () => groupByDay(displayMemories ?? []),
    [displayMemories],
  );

  const toggleTag = (tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

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

      {/* Search meta */}
      {search.length > 0 && searchMeta && (
        <div
          className="flex items-center gap-3 mb-3 px-3 py-2 rounded-lg text-[11px]"
          style={{ background: "var(--obsidian)", border: "1px solid var(--graphite)", color: "var(--steel)" }}
        >
          <span>{searchMeta.totalMatches} matches</span>
          {searchMeta.highSimilarityCluster && (
            <span
              className="px-1.5 py-0.5 rounded"
              style={{ background: "var(--ok-dim)", color: "var(--ok)" }}
            >
              tight cluster
            </span>
          )}
        </div>
      )}

      {/* Tag filters */}
      {allTags.length > 0 && (
        <div className="flex gap-1.5 mb-4 flex-wrap">
          {allTags.map((tag) => {
            const isActive = activeTags.has(tag);
            const tc = tagColor(tag);
            return (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all duration-150"
                style={{
                  background: isActive ? tc.bg : "var(--slate)",
                  color: isActive ? tc.color : "var(--steel)",
                  border: isActive
                    ? `1px solid ${tc.color}33`
                    : "1px solid var(--graphite)",
                }}
              >
                #{tag}
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
                  {group.memories.map((mem) => (
                    <div
                      key={mem.id}
                      className="rounded-xl p-4 group"
                      style={{
                        background: "var(--obsidian)",
                        border: "1px solid var(--graphite)",
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            {mem.tags.map((tag) => {
                              const tc = tagColor(tag);
                              return (
                                <span
                                  key={tag}
                                  className="badge"
                                  style={{ background: tc.bg, color: tc.color }}
                                >
                                  #{tag}
                                </span>
                              );
                            })}
                            {"similarity" in mem && (mem as ScoredMemory).similarity > 0 && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-medium tabular-nums"
                                style={{
                                  background: similarityColor((mem as ScoredMemory).similarity).bg,
                                  color: similarityColor((mem as ScoredMemory).similarity).color,
                                }}
                              >
                                {((mem as ScoredMemory).similarity * 100).toFixed(0)}%
                              </span>
                            )}
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
                          {mem.retrievalCues && (
                            <p
                              className="text-[11px] mt-1.5 leading-relaxed"
                              style={{ color: "var(--pewter)" }}
                            >
                              {mem.retrievalCues}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => deleteMutation.mutate({ id: mem.id })}
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
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
