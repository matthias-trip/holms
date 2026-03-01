import { useState, useMemo } from "react";
import { Plug, ChevronRight, ChevronDown } from "lucide-react";
import { Card, CardBody, Chip } from "@heroui/react";
import { trpc } from "../trpc";

// ── Property color map ──

const PROPERTY_COLORS: Record<string, string> = {
  illumination: "#fbbf24",
  climate: "#f97316",
  occupancy: "#3b82f6",
  access: "#22c55e",
  media: "#a855f7",
  power: "#8b5cf6",
  water: "#0ea5e9",
  safety: "#ef4444",
  air_quality: "#14b8a6",
};

function getPropertyColor(property: string): string {
  return PROPERTY_COLORS[property] ?? "var(--gray-9)";
}

// ── Property ordering ──

const PROPERTY_ORDER: string[] = [
  "illumination", "climate", "occupancy", "access",
  "media", "power", "water", "safety", "air_quality",
];

// ── Types ──

interface SourceObs {
  source: string;
  adapterId?: string;
  role: string;
  mounting?: string;
  features: string[];
  reachable: boolean;
  state: Record<string, unknown>;
  cached?: boolean;
}

interface PropertyObs {
  property: string;
  sources: SourceObs[];
}

interface SpaceObs {
  space: string;
  properties: PropertyObs[];
}

interface SpaceCapability {
  space: string;
  displayName: string;
  floor?: string;
}

interface MergedSpace {
  id: string;
  displayName: string;
  floor?: string;
  properties: PropertyObs[];
}

interface FlatSource {
  source: SourceObs;
  property: string;
  propertyColor: string;
}

// ── Name formatting helpers ──

function formatSourceName(id: string): string {
  return id
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatPropertyName(property: string): string {
  return property
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── State extraction helpers ──

const BOOLEAN_PRIORITY = ["on", "locked", "open", "motion", "occupied"] as const;

interface PrimaryState {
  primary: { key: string; value: boolean } | null;
  secondary: Array<{ key: string; value: number | string }>;
}

function extractPrimaryState(state: Record<string, unknown>): PrimaryState {
  let primary: { key: string; value: boolean } | null = null;

  for (const key of BOOLEAN_PRIORITY) {
    if (typeof state[key] === "boolean") {
      primary = { key, value: state[key] };
      break;
    }
  }

  if (!primary) {
    for (const [key, value] of Object.entries(state)) {
      if (typeof value === "boolean") {
        primary = { key, value };
        break;
      }
    }
  }

  const secondary: PrimaryState["secondary"] = [];
  for (const [key, value] of Object.entries(state)) {
    if (key === primary?.key || key === "error") continue;
    if (typeof value === "number" || (typeof value === "string" && value.length < 20)) {
      secondary.push({ key, value: value as number | string });
      if (secondary.length >= 2) break;
    }
  }

  return { primary, secondary };
}

function getBooleanDisplay(key: string, value: boolean): { label: string; color: string } {
  const k = key.toLowerCase();
  if (k === "on" || k === "is_on") {
    return value
      ? { label: "On", color: "var(--ok)" }
      : { label: "Off", color: "var(--gray-9)" };
  }
  if (k === "open" || k === "is_open") {
    return value
      ? { label: "Open", color: "var(--warn)" }
      : { label: "Closed", color: "var(--ok)" };
  }
  if (k === "locked" || k === "is_locked") {
    return value
      ? { label: "Locked", color: "var(--ok)" }
      : { label: "Unlocked", color: "var(--warn)" };
  }
  if (k === "motion" || k === "occupied") {
    return value
      ? { label: key.charAt(0).toUpperCase() + key.slice(1), color: "var(--warn)" }
      : { label: "Clear", color: "var(--gray-9)" };
  }
  return value
    ? { label: "On", color: "var(--ok)" }
    : { label: "Off", color: "var(--gray-9)" };
}

function round(n: number, decimals: number): number {
  if (Number.isInteger(n)) return n;
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

function formatInlineValue(key: string, value: number | string): string {
  if (typeof value === "string") return value;
  const k = key.toLowerCase();
  if (k.includes("temp") || k.includes("temperature")) return `${round(value, 1)}\u00b0`;
  if (k.includes("brightness") || k.includes("volume") || k.includes("humidity") || k.includes("battery") || k.includes("position") || k.includes("speed"))
    return `${Math.round(value)}%`;
  if (k.includes("color_temp") || k.includes("colortemp") || k.includes("ct")) return `${Math.round(value)}K`;
  return String(round(value, 1));
}

function getPropertySummary(property: string, sources: SourceObs[]): string {
  const prop = property.toLowerCase();
  const reachable = sources.filter((s) => s.reachable || Object.keys(s.state).length > 0);
  if (reachable.length === 0) return "";

  if (prop === "illumination") {
    const onCount = reachable.filter((s) => s.state.on === true).length;
    return `${onCount}/${reachable.length} on`;
  }
  if (prop === "climate") {
    const temps = reachable
      .map((s) => {
        const t = s.state.temperature ?? s.state.temp;
        return typeof t === "number" ? t : null;
      })
      .filter((t): t is number => t !== null);
    if (temps.length > 0) {
      const avg = temps.reduce((a, b) => a + b, 0) / temps.length;
      return `avg ${avg.toFixed(1)}\u00b0`;
    }
    return "";
  }
  if (prop === "access") {
    const closed = reachable.filter((s) => s.state.open === false || s.state.locked === true).length;
    return `${closed} closed`;
  }
  if (prop === "occupancy") {
    const active = reachable.filter((s) => s.state.motion === true || s.state.occupied === true).length;
    return active > 0 ? `${active} active` : "clear";
  }
  if (prop === "power") {
    const onCount = reachable.filter((s) => s.state.on === true).length;
    return `${onCount}/${reachable.length} on`;
  }

  return `${reachable.length} source${reachable.length !== 1 ? "s" : ""}`;
}

function formatStateKey(key: string): string {
  return key.replace(/_/g, " ").replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

function formatStateValue(key: string, value: unknown): React.ReactNode {
  if (value === null || value === undefined) return "\u2014";
  if (typeof value === "boolean") {
    const display = getBooleanDisplay(key, value);
    return <span style={{ color: display.color, fontWeight: 600 }}>{display.label}</span>;
  }
  if (typeof value === "number") return formatInlineValue(key, value);
  if (typeof value === "string") return value.charAt(0).toUpperCase() + value.slice(1);
  if (Array.isArray(value)) return value.join(", ");
  return JSON.stringify(value);
}

// ── Attention scoring ──

function isAttentionState(source: SourceObs): boolean {
  const { primary } = extractPrimaryState(source.state);
  if (!primary) return false;
  const k = primary.key.toLowerCase();
  if ((k === "open" || k === "is_open") && primary.value) return true;
  if ((k === "motion" || k === "occupied") && primary.value) return true;
  if ((k === "locked" || k === "is_locked") && !primary.value) return true;
  return false;
}

function getAttentionScore(source: SourceObs): number {
  if (!source.reachable) return 4;
  const { primary } = extractPrimaryState(source.state);
  if (!primary) return 3;
  if (isAttentionState(source)) return 0;
  if (primary.value) return 1;
  return 2;
}

function sortSourcesByAttention(sources: SourceObs[]): SourceObs[] {
  return [...sources].sort((a, b) => getAttentionScore(a) - getAttentionScore(b));
}

// ── Home status ──

function getHomeStatus(spaces: SpaceObs[]): string[] {
  const parts: string[] = [];
  let totalLights = 0, onLights = 0;
  let totalAccess = 0, closedAccess = 0;
  const temps: number[] = [];

  for (const space of spaces) {
    for (const prop of space.properties) {
      const p = prop.property.toLowerCase();
      const reachable = prop.sources.filter((s) => s.reachable || Object.keys(s.state).length > 0);

      if (p === "illumination" || p === "power") {
        totalLights += reachable.length;
        onLights += reachable.filter((s) => s.state.on === true).length;
      }
      if (p === "access") {
        totalAccess += reachable.length;
        closedAccess += reachable.filter((s) => s.state.open === false || s.state.locked === true).length;
      }
      if (p === "climate") {
        for (const s of reachable) {
          const t = s.state.temperature ?? s.state.temp;
          if (typeof t === "number") temps.push(t);
        }
      }
    }
  }

  if (totalLights > 0) parts.push(`${onLights}/${totalLights} on`);
  if (totalAccess > 0) parts.push(`${closedAccess} closed`);
  if (temps.length > 0) {
    const avg = temps.reduce((a, b) => a + b, 0) / temps.length;
    parts.push(`${avg.toFixed(1)}\u00b0`);
  }

  return parts;
}

// ── Merge observe + capabilities data ──

function mergeSpaceData(
  observe: SpaceObs[],
  capabilities: SpaceCapability[] | undefined,
): MergedSpace[] {
  const capMap = new Map<string, SpaceCapability>();
  if (capabilities) {
    for (const cap of capabilities) {
      capMap.set(cap.space, cap);
    }
  }

  return observe.map((sp) => {
    const cap = capMap.get(sp.space);
    // Sort properties by canonical order
    const sorted = [...sp.properties].sort((a, b) => {
      const ai = PROPERTY_ORDER.indexOf(a.property);
      const bi = PROPERTY_ORDER.indexOf(b.property);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    return {
      id: sp.space,
      displayName: cap?.displayName ?? formatSourceName(sp.space),
      floor: cap?.floor,
      properties: sorted,
    };
  });
}

// ── Flatten space (for compact mode) ──

function flattenSpace(space: MergedSpace): FlatSource[] {
  const seen = new Set<string>();
  const result: FlatSource[] = [];

  for (const prop of space.properties) {
    for (const src of prop.sources) {
      if (seen.has(src.source)) continue;
      seen.add(src.source);
      result.push({
        source: src,
        property: prop.property,
        propertyColor: getPropertyColor(prop.property),
      });
    }
  }

  return result.sort((a, b) => getAttentionScore(a.source) - getAttentionScore(b.source));
}

// ── Root component ──

export default function SpacesPanel({ compact }: { compact?: boolean }) {
  const { data: observeData, isLoading, refetch: refetchObserve } = trpc.spaces.list.useQuery(undefined, {
    refetchInterval: 3000,
  });

  const { data: capData, refetch: refetchCaps } = trpc.spaces.capabilities.useQuery(undefined, {
    refetchInterval: 30000,
  });

  trpc.spaces.onEvent.useSubscription(undefined, {
    onData: () => {
      refetchObserve();
      refetchCaps();
    },
  });

  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [collapsedFloors, setCollapsedFloors] = useState<Set<string>>(new Set());

  const rawSpaces: SpaceObs[] = (observeData as any)?.spaces ?? [];
  const capabilities: SpaceCapability[] | undefined = (capData as any)?.spaces;
  const merged = useMemo(() => mergeSpaceData(rawSpaces, capabilities), [rawSpaces, capabilities]);
  const homeStatus = useMemo(() => getHomeStatus(rawSpaces), [rawSpaces]);

  // Group by floor
  const { floors, ungrouped } = useMemo(() => {
    const floorMap = new Map<string, MergedSpace[]>();
    const noFloor: MergedSpace[] = [];
    for (const space of merged) {
      if (space.floor) {
        const list = floorMap.get(space.floor) ?? [];
        list.push(space);
        floorMap.set(space.floor, list);
      } else {
        noFloor.push(space);
      }
    }
    return {
      floors: Array.from(floorMap.entries()).map(([name, spaces]) => ({ name, spaces })),
      ungrouped: noFloor,
    };
  }, [merged]);

  const hasFloors = floors.length > 0;

  const toggleFloor = (floor: string) => {
    setCollapsedFloors((prev) => {
      const next = new Set(prev);
      if (next.has(floor)) next.delete(floor);
      else next.add(floor);
      return next;
    });
  };

  // ── Compact mode ──
  if (compact) {
    return (
      <div className="p-4 flex flex-col">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm font-medium" style={{ color: "var(--gray-12)" }}>Spaces</span>
          {homeStatus.length > 0 && (
            <span className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--gray-9)" }}>
              {homeStatus.join(" \u00b7 ")}
            </span>
          )}
        </div>
        <div
          className="flex-1 overflow-auto"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: "8px",
          }}
        >
          {merged.map((space, i) => {
            const flat = flattenSpace(space);

            return (
              <Card
                key={space.id}
                className="animate-fade-in"
                style={{
                  background: "var(--gray-3)",
                  border: "1px solid var(--gray-a5)",
                  animationDelay: `${i * 40}ms`,
                }}
              >
                <CardBody className="gap-2">
                  <span className="text-[13px] font-medium" style={{ color: "var(--gray-12)" }}>
                    {space.displayName}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {space.properties.map((p) => {
                      const summary = getPropertySummary(p.property, p.sources);
                      if (!summary) return null;
                      return (
                        <span
                          key={p.property}
                          className="text-[11px] flex items-center gap-1"
                          style={{ color: "var(--gray-11)" }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ background: getPropertyColor(p.property) }}
                          />
                          {summary}
                        </span>
                      );
                    })}
                  </div>
                  {/* Dot row */}
                  <div className="flex items-center gap-0.5 mt-0.5">
                    {flat.map((fs) => {
                      const { primary } = extractPrimaryState(fs.source.state);
                      const active = primary?.value ?? false;
                      const attention = isAttentionState(fs.source);
                      return (
                        <span
                          key={fs.source.source}
                          style={{
                            width: "5px",
                            height: "5px",
                            borderRadius: "50%",
                            background: active || attention
                              ? (attention ? "var(--warn)" : fs.propertyColor)
                              : "transparent",
                            border: `1.5px solid ${active || attention
                              ? (attention ? "var(--warn)" : fs.propertyColor)
                              : "var(--gray-7)"}`,
                            flexShrink: 0,
                          }}
                        />
                      );
                    })}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Full panel ──

  const renderSpaceSection = (space: MergedSpace, animBase: number) => (
    <div key={space.id} className="mb-6">
      {/* Space name */}
      <div className="flex items-center gap-2.5 mb-3 px-1">
        <span className="text-base font-semibold" style={{ color: "var(--gray-12)" }}>
          {space.displayName}
        </span>
      </div>

      {/* Property groups */}
      <div className="space-y-4">
        {space.properties.map((prop) => {
          const summary = getPropertySummary(prop.property, prop.sources);
          const sorted = sortSourcesByAttention(prop.sources);
          const color = getPropertyColor(prop.property);

          return (
            <div key={prop.property} className="flex">
              {/* Colored left border */}
              <div
                className="flex-shrink-0 rounded-full"
                style={{ width: "4px", background: color, opacity: 0.7 }}
              />

              <div className="flex-1 min-w-0 ml-3">
                {/* Property header */}
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className="text-[12px] font-medium"
                    style={{ color }}
                  >
                    {formatPropertyName(prop.property)}
                  </span>
                  {summary && (
                    <span
                      className="text-[11px] tabular-nums"
                      style={{ fontFamily: "var(--font-mono)", color: "var(--gray-8)" }}
                    >
                      {summary}
                    </span>
                  )}
                </div>

                {/* Source rows — 2-column grid */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
                    gap: "6px",
                  }}
                >
                  {sorted.map((source, si) => {
                    const compoundKey = `${prop.property}:${source.source}`;
                    return (
                      <SourceRow
                        key={compoundKey}
                        source={source}
                        expanded={expandedSources.has(compoundKey)}
                        onToggle={() =>
                          setExpandedSources((prev) => {
                            const next = new Set(prev);
                            if (next.has(compoundKey)) next.delete(compoundKey);
                            else next.add(compoundKey);
                            return next;
                          })
                        }
                        index={animBase + si}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  let globalAnimIndex = 0;

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--gray-2)" }}>
      {/* Header */}
      <div
        className="flex justify-between items-center flex-shrink-0 px-6 h-14"
        style={{ borderBottom: "1px solid var(--gray-a3)", background: "var(--gray-1)" }}
      >
        <h3 className="text-base font-bold" style={{ color: "var(--gray-12)" }}>Spaces</h3>
        {homeStatus.length > 0 && (
          <span className="text-xs tabular-nums" style={{ fontFamily: "var(--font-mono)", color: "var(--gray-9)" }}>
            {homeStatus.join(" \u00b7 ")}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="shimmer w-full h-12 rounded-lg" />
        </div>
      ) : merged.length === 0 ? (
        <div className="empty-state" style={{ paddingBottom: "10vh" }}>
          <div className="empty-state-icon">
            <Plug size={18} />
          </div>
          <div className="empty-state-text">
            No spaces discovered yet. Configure an adapter to start observing your home.
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-6">
          {hasFloors ? (
            <>
              {floors.map((floor) => {
                const isCollapsed = collapsedFloors.has(floor.name);
                const floorBase = globalAnimIndex;
                if (!isCollapsed) {
                  for (const sp of floor.spaces) {
                    for (const p of sp.properties) globalAnimIndex += p.sources.length;
                  }
                }
                return (
                  <div key={floor.name} className="mb-6">
                    {/* Floor label */}
                    <button
                      className="flex items-center gap-1.5 mb-3 px-1 cursor-pointer"
                      style={{ background: "none", border: "none", padding: 0 }}
                      onClick={() => toggleFloor(floor.name)}
                    >
                      {isCollapsed ? (
                        <ChevronRight size={12} style={{ color: "var(--gray-8)" }} />
                      ) : (
                        <ChevronDown size={12} style={{ color: "var(--gray-8)" }} />
                      )}
                      <span
                        className="text-[11px] font-semibold uppercase tracking-wider"
                        style={{ color: "var(--gray-8)" }}
                      >
                        {floor.name}
                      </span>
                    </button>

                    {!isCollapsed && (
                      <div className="pl-2">
                        {floor.spaces.map((space) => {
                          const base = floorBase;
                          return renderSpaceSection(space, base);
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Ungrouped spaces */}
              {ungrouped.length > 0 && (
                <div className="mb-6">
                  {floors.length > 0 && (
                    <div className="mb-3 px-1">
                      <span
                        className="text-[11px] font-semibold uppercase tracking-wider"
                        style={{ color: "var(--gray-8)" }}
                      >
                        Other
                      </span>
                    </div>
                  )}
                  <div className="pl-2">
                    {ungrouped.map((space) => {
                      const base = globalAnimIndex;
                      for (const p of space.properties) globalAnimIndex += p.sources.length;
                      return renderSpaceSection(space, base);
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* No floors — flat list */
            merged.map((space) => {
              const base = globalAnimIndex;
              for (const p of space.properties) globalAnimIndex += p.sources.length;
              return renderSpaceSection(space, base);
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── Source row ──

function SourceRow({ source, expanded, onToggle, index }: {
  source: SourceObs;
  expanded: boolean;
  onToggle: () => void;
  index: number;
}) {
  const { primary, secondary } = extractPrimaryState(source.state);
  const boolDisplay = primary ? getBooleanDisplay(primary.key, primary.value) : null;

  const stateEntries = Object.entries(source.state).filter(([k, v]) => {
    if (v == null) return false;
    if (k === primary?.key) return false;
    if (secondary.some((s) => s.key === k)) return false;
    return true;
  });

  const hasExpandable = stateEntries.length > 0 || source.features.length > 0;
  const attention = isAttentionState(source);

  // Status dot color
  const dotColor = !source.reachable
    ? "var(--gray-7)"
    : attention
      ? "var(--warn)"
      : boolDisplay?.color === "var(--ok)"
        ? "var(--ok)"
        : "var(--gray-7)";

  const dotGlow = source.reachable && (attention || boolDisplay?.color === "var(--ok)")
    ? `0 0 6px color-mix(in srgb, ${dotColor} 40%, transparent)`
    : "none";

  // Chip style
  const chipBg = boolDisplay
    ? `color-mix(in srgb, ${boolDisplay.color} 12%, transparent)`
    : "var(--gray-a3)";

  // Metadata line parts
  const metaParts: string[] = [source.role];
  if (source.mounting) metaParts.push(source.mounting);

  return (
    <div
      className="animate-fade-in rounded-lg"
      style={{
        opacity: source.reachable ? 1 : 0.5,
        animationDelay: `${index * 30}ms`,
        background: expanded ? "var(--gray-a2)" : "var(--gray-3)",
        border: expanded ? "1px solid var(--accent-a5)" : "1px solid var(--gray-a4)",
        cursor: hasExpandable ? "pointer" : "default",
      }}
      onClick={hasExpandable ? onToggle : undefined}
    >
      {/* Cached stripe */}
      {source.cached && (
        <div
          style={{
            height: "2px",
            background: "var(--warn)",
            borderRadius: "8px 8px 0 0",
          }}
        />
      )}

      <div className="px-3 py-2.5">
        {/* Row 1: Name + state */}
        <div className="flex items-center gap-2">
          {/* Status dot */}
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: dotColor, boxShadow: dotGlow }}
          />

          {/* Source name — gets full remaining width */}
          <span className="text-[12.5px] font-medium flex-1 min-w-0" style={{ color: "var(--gray-12)", wordBreak: "break-word" }}>
            {formatSourceName(source.source)}
          </span>

          {/* Secondary values */}
          {secondary.length > 0 && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {secondary.map(({ key, value }) => (
                <span
                  key={key}
                  className="text-[11px] tabular-nums"
                  style={{ fontFamily: "var(--font-mono)", color: "var(--gray-9)" }}
                >
                  {formatInlineValue(key, value)}
                </span>
              ))}
            </div>
          )}

          {/* State chip */}
          {boolDisplay && (
            <Chip
              variant="flat"
              size="sm"
              style={{
                background: chipBg,
                color: boolDisplay.color,
                fontSize: "11px",
              }}
            >
              {boolDisplay.label}
            </Chip>
          )}

          {/* Expand chevron */}
          {hasExpandable && (
            <ChevronRight
              size={12}
              className="flex-shrink-0 transition-transform duration-200"
              style={{
                transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
                color: "var(--gray-8)",
              }}
            />
          )}
        </div>

        {/* Row 2: Metadata — role, mounting, adapter */}
        <div className="flex items-center gap-1.5 mt-1 ml-[14px]">
          <span className="text-[10.5px]" style={{ color: "var(--gray-8)" }}>
            {metaParts.join(" \u00b7 ")}
          </span>
          {source.adapterId && (
            <span
              className="text-[9px] px-1 py-px rounded"
              style={{
                background: "var(--gray-a3)",
                color: "var(--gray-9)",
              }}
            >
              {source.adapterId}
            </span>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 pt-0 ml-[14px]">
          {/* Features */}
          {source.features.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap mb-3 mt-1">
              {source.features.map((f) => (
                <span
                  key={f}
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ border: "1px solid var(--gray-a5)", color: "var(--gray-9)" }}
                >
                  {f}
                </span>
              ))}
            </div>
          )}

          {/* State grid */}
          {stateEntries.length > 0 && (
            <div
              className="rounded-lg p-3"
              style={{ background: "var(--gray-a3)" }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
                  gap: "8px",
                }}
              >
                {stateEntries.map(([key, value]) => (
                  <div key={key}>
                    <span
                      className="text-[10px] uppercase tracking-wide block"
                      style={{ color: "var(--gray-8)" }}
                    >
                      {formatStateKey(key)}
                    </span>
                    <span
                      className="text-[13px] block"
                      style={{ fontFamily: "var(--font-mono)", color: "var(--gray-12)" }}
                    >
                      {formatStateValue(key, value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
