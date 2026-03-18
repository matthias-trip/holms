import { useMemo } from "react";
import { Lightbulb, Thermometer, UserCheck, Lock } from "lucide-react";
import { trpc } from "../../trpc";

// ── Types (mirrors SpacesPanel) ──

interface SourceObs {
  source: string;
  reachable: boolean;
  state: Record<string, unknown>;
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

// ── Property summary helpers ──

function countLightsOn(properties: PropertyObs[]): { on: number; total: number } | null {
  const illum = properties.find((p) => p.property === "illumination");
  if (!illum) return null;
  const reachable = illum.sources.filter((s) => s.reachable || Object.keys(s.state).length > 0);
  if (reachable.length === 0) return null;
  const on = reachable.filter((s) => s.state.on === true).length;
  return { on, total: reachable.length };
}

function getTemperature(properties: PropertyObs[]): number | null {
  const climate = properties.find((p) => p.property === "climate");
  if (!climate) return null;
  for (const s of climate.sources) {
    const t = s.state.temperature ?? s.state.temp;
    if (typeof t === "number") return Math.round(t * 10) / 10;
  }
  return null;
}

function isOccupied(properties: PropertyObs[]): boolean | null {
  const occ = properties.find((p) => p.property === "occupancy");
  if (!occ) return null;
  return occ.sources.some((s) => s.state.occupied === true || s.state.motion === true);
}

function isLocked(properties: PropertyObs[]): boolean | null {
  const access = properties.find((p) => p.property === "access");
  if (!access) return null;
  const hasLock = access.sources.some((s) => "locked" in s.state);
  if (!hasLock) return null;
  return access.sources.every((s) => s.state.locked === true);
}

// ── Space Card ──

function SpaceCard({
  space,
  displayName,
  floor,
  index,
}: {
  space: SpaceObs;
  displayName: string;
  floor?: string;
  index: number;
}) {
  const lights = countLightsOn(space.properties);
  const temp = getTemperature(space.properties);
  const occupied = isOccupied(space.properties);
  const locked = isLocked(space.properties);

  const hasData = lights || temp !== null || occupied !== null || locked !== null;

  return (
    <div
      className="animate-fade-in rounded-2xl p-4 flex flex-col gap-2 transition-all duration-150"
      style={{
        animationDelay: `${index * 40}ms`,
        background: "var(--gray-3)",
        border: "1px solid var(--gray-a5)",
        opacity: hasData ? 1 : 0.5,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span
          className="text-sm font-semibold"
          style={{ fontFamily: "var(--font-display)", color: "var(--gray-12)" }}
        >
          {displayName}
        </span>
        {floor && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: "var(--gray-a3)", color: "var(--gray-8)" }}
          >
            {floor}
          </span>
        )}
      </div>

      {/* Property indicators */}
      {hasData ? (
        <div className="flex items-center gap-3 flex-wrap">
          {lights && (
            <div className="flex items-center gap-1.5">
              <Lightbulb
                size={13}
                style={{ color: lights.on > 0 ? "var(--warm)" : "var(--gray-7)" }}
              />
              <span className="text-xs" style={{ color: "var(--gray-11)" }}>
                {lights.on > 0 ? `${lights.on} on` : "off"}
              </span>
            </div>
          )}
          {temp !== null && (
            <div className="flex items-center gap-1.5">
              <Thermometer size={13} style={{ color: "var(--accent-9)" }} />
              <span className="text-xs" style={{ color: "var(--gray-11)" }}>
                {temp}°C
              </span>
            </div>
          )}
          {occupied !== null && (
            <div className="flex items-center gap-1.5">
              <UserCheck size={13} style={{ color: occupied ? "var(--ok)" : "var(--gray-7)" }} />
              <span className="text-xs" style={{ color: "var(--gray-11)" }}>
                {occupied ? "occ." : "empty"}
              </span>
            </div>
          )}
          {locked !== null && (
            <div className="flex items-center gap-1.5">
              <Lock size={13} style={{ color: locked ? "var(--ok)" : "var(--warn)" }} />
              <span className="text-xs" style={{ color: "var(--gray-11)" }}>
                {locked ? "locked" : "unlocked"}
              </span>
            </div>
          )}
        </div>
      ) : (
        <span className="text-xs" style={{ color: "var(--gray-8)" }}>No data</span>
      )}
    </div>
  );
}

// ── Main Grid ──

export default function SpaceGrid() {
  const { data: observeData } = trpc.spaces.list.useQuery(undefined, {
    refetchInterval: 5000,
  });

  const { data: capData } = trpc.spaces.capabilities.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const rawSpaces: SpaceObs[] = (observeData as any)?.spaces ?? [];
  const capabilities: SpaceCapability[] = (capData as any)?.spaces ?? [];

  const merged = useMemo(() => {
    const capMap = new Map(capabilities.map((c) => [c.space, c]));
    return rawSpaces.map((s) => {
      const cap = capMap.get(s.space);
      return {
        ...s,
        displayName: cap?.displayName ?? s.space.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        floor: cap?.floor,
      };
    });
  }, [rawSpaces, capabilities]);

  if (merged.length === 0) {
    return (
      <div className="text-xs py-8 text-center" style={{ color: "var(--gray-8)" }}>
        No spaces configured yet
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: "12px",
      }}
    >
      {merged.map((space, i) => (
        <SpaceCard
          key={space.space}
          space={space}
          displayName={space.displayName}
          floor={space.floor}
          index={i}
        />
      ))}
    </div>
  );
}
