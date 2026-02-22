import { useState, useMemo } from "react";
import { Search, X, Pin } from "lucide-react";
import { Chip, Card, CardBody, Button, Input } from "@heroui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { trpc } from "../trpc";
import type { Memory, ScoredMemory, MemoryQueryMeta } from "@holms/shared";

const mdComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-1.5 last:mb-0">{children}</p>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold" style={{ color: "var(--gray-12)" }}>{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="px-1 py-0.5 rounded text-[11px]" style={{ background: "var(--gray-a5)", fontFamily: "var(--font-mono)" }}>
      {children}
    </code>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-4 mb-1.5 space-y-0.5">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-4 mb-1.5 space-y-0.5">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
};

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
    onSuccess: () => {
      refetch();
    },
  });

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
    <div className="h-full flex flex-col" style={{ background: "var(--gray-2)" }}>
      {/* Header */}
      <div
        className="flex justify-between items-center flex-shrink-0 px-6 py-4"
        style={{ borderBottom: "1px solid var(--gray-a3)" }}
      >
        <h3 className="text-base font-bold" style={{ color: "var(--gray-12)" }}>What I Remember</h3>
        {displayMemories && (
          <span className="text-xs" style={{ color: "var(--gray-9)" }}>{displayMemories.length} entries</span>
        )}
      </div>

      <div className="flex-1 flex flex-col overflow-hidden p-6">
        {/* Search */}
        <div className="mb-4">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search memories..."
            size="md"
            startContent={<Search size={14} style={{ color: "var(--gray-8)" }} />}
          />
        </div>

        {/* Search meta */}
        {search.length > 0 && searchMeta && (
          <div
            className="flex items-center gap-3 mb-3 px-3 py-2 rounded-lg"
            style={{ background: "var(--color-background)", border: "1px solid var(--gray-a5)" }}
          >
            <span className="text-xs" style={{ color: "var(--gray-9)" }}>{searchMeta.totalMatches} matches</span>
            {searchMeta.highSimilarityCluster && (
              <Chip color="success" size="sm">tight cluster</Chip>
            )}
          </div>
        )}

        {/* Tag filters */}
        {allTags.length > 0 && (
          <div className="flex gap-1 mb-4 flex-wrap">
            {allTags.map((tag) => {
              const isActive = activeTags.has(tag);
              const tc = tagColor(tag);
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all duration-150"
                  style={{
                    background: isActive ? tc.bg : "var(--gray-a3)",
                    color: isActive ? tc.color : "var(--gray-9)",
                    border: isActive
                      ? `1px solid ${tc.color}33`
                      : "1px solid var(--gray-a5)",
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
                <Search size={18} />
              </div>
              <div className="empty-state-text">
                No memories yet. As I learn about your home and preferences, they'll show up here.
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {dayGroups.map((group) => (
                <section key={group.day}>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-xs font-bold" style={{ color: "var(--gray-9)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {group.label}
                    </span>
                    <div
                      className="flex-1 h-px"
                      style={{ background: "var(--gray-a5)" }}
                    />
                    <span className="text-xs tabular-nums" style={{ color: "var(--gray-9)" }}>
                      {group.memories.length}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {group.memories.map((mem, i) => (
                      <Card
                        key={mem.id}
                        className="group animate-fade-in"
                        style={{ background: "var(--gray-3)", border: "1px solid var(--gray-a5)", animationDelay: `${i * 50}ms` }}
                      >
                        <CardBody>
                          <div className="flex justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                {mem.pinned && (
                                  <span
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
                                    style={{ background: "var(--accent-a3)", color: "var(--accent-11)" }}
                                  >
                                    <Pin size={9} />
                                    pinned
                                  </span>
                                )}
                                {mem.tags.map((tag) => {
                                  const tc = tagColor(tag);
                                  return (
                                    <span
                                      key={tag}
                                      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
                                      style={{ background: tc.bg, color: tc.color }}
                                    >
                                      #{tag}
                                    </span>
                                  );
                                })}
                                {mem.entityId && (
                                  <span
                                    className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                                    style={{ background: "var(--gray-a3)", color: "var(--gray-9)" }}
                                    title={mem.entityId}
                                  >
                                    {mem.entityId}
                                  </span>
                                )}
                                {mem.personId && (
                                  <span
                                    className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                                    style={{ background: "var(--gray-a3)", color: "var(--gray-9)" }}
                                    title={mem.personId}
                                  >
                                    person
                                  </span>
                                )}
                                {mem.scope && (
                                  <span
                                    className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                                    style={{ background: "var(--gray-a3)", color: "var(--gray-9)" }}
                                    title={mem.scope}
                                  >
                                    personal
                                  </span>
                                )}
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
                                <span className="text-xs ml-auto tabular-nums" style={{ color: "var(--gray-9)" }}>
                                  {new Date(mem.createdAt).toLocaleTimeString(undefined, {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </div>
                              <div className="text-sm" style={{ lineHeight: "1.6", color: "var(--gray-12)" }}>
                                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                                  {mem.content}
                                </ReactMarkdown>
                              </div>
                              {mem.retrievalCues && (
                                <p className="text-xs mt-1" style={{ color: "var(--gray-9)", lineHeight: "1.6" }}>
                                  {mem.retrievalCues}
                                </p>
                              )}
                            </div>
                            <Button
                              isIconOnly
                              variant="light"
                              color="danger"
                              size="sm"
                              onPress={() => deleteMutation.mutate({ id: mem.id })}
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Delete memory"
                            >
                              <X size={14} />
                            </Button>
                          </div>
                        </CardBody>
                      </Card>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
