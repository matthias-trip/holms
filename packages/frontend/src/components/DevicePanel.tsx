import { useState, useMemo } from "react";
import {
  Lightbulb, Thermometer, Radar, Lock, CircleDot, Plug, Fan, Speaker,
  PanelTop, Shield, Bot, Droplets, Flame, ToggleLeft, Power, Video, Gauge,
  Brain, ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { Button, Card, CardBody, Chip } from "@heroui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { trpc } from "../trpc";
import { relativeTime } from "../utils/humanize";
import type { Device } from "@holms/shared";

// ── Icon map ──

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  light: Lightbulb,
  climate: Thermometer,
  binary_sensor: Radar,
  sensor: Gauge,
  lock: Lock,
  fan: Fan,
  media_player: Speaker,
  cover: PanelTop,
  alarm_control_panel: Shield,
  vacuum: Bot,
  humidifier: Droplets,
  water_heater: Flame,
  switch: ToggleLeft,
  scene: Power,
  camera: Video,
};

// ── Domain color map ──

const DOMAIN_COLORS: Record<string, string> = {
  light:               "#fbbf24",
  climate:             "#f97316",
  binary_sensor:       "#3b82f6",
  sensor:              "#6366f1",
  lock:                "#22c55e",
  fan:                 "#06b6d4",
  media_player:        "#a855f7",
  cover:               "#64748b",
  alarm_control_panel: "#ef4444",
  vacuum:              "#14b8a6",
  humidifier:          "#0ea5e9",
  water_heater:        "#f97316",
  switch:              "#8b5cf6",
  scene:               "#ec4899",
  camera:              "#6366f1",
};

function getDomainColor(domain: string): string {
  return DOMAIN_COLORS[domain] ?? "var(--gray-9)";
}

function DeviceIcon({ domain, active }: { domain: string; active: boolean }) {
  const Icon = DOMAIN_ICONS[domain] ?? CircleDot;
  const color = getDomainColor(domain);
  return (
    <div
      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
      style={{
        background: active
          ? `color-mix(in srgb, ${color} 12%, transparent)`
          : "var(--gray-a3)",
      }}
    >
      <Icon size={16} strokeWidth={1.5} color={active ? color : "var(--gray-8)"} />
    </div>
  );
}

// ── Primary state extraction (DAL keys) ──

function getPrimaryState(device: Device): { label: string; detail?: string; active: boolean } {
  const s = device.state;

  switch (device.domain) {
    case "light": {
      const on = s.power === "on";
      const brightness = s.brightness as number | undefined;
      return { active: on, label: on ? "On" : "Off", detail: on && brightness != null ? `${brightness}%` : undefined };
    }
    case "switch":
    case "fan": {
      const on = s.power === "on";
      const speed = s.speed as number | undefined;
      return { active: on, label: on ? "On" : "Off", detail: on && speed != null ? `${speed}%` : undefined };
    }
    case "climate": {
      const temp = s.currentTemp as number | undefined;
      const target = s.targetTemp as number | undefined;
      return {
        active: true,
        label: temp != null ? `${temp}°` : "Climate",
        detail: target != null ? `Target ${target}°` : undefined,
      };
    }
    case "binary_sensor": {
      const active = s.active === true;
      return { active, label: active ? "Detected" : "Clear" };
    }
    case "sensor": {
      const val = s.value;
      const unit = s.unit as string | undefined;
      return { active: val != null, label: val != null ? `${val}${unit ? ` ${unit}` : ""}` : "—" };
    }
    case "lock": {
      const locked = s.locked === true;
      return { active: locked, label: locked ? "Locked" : "Unlocked" };
    }
    case "media_player": {
      const state = s.state as string | undefined;
      const on = state === "playing" || state === "paused" || state === "on";
      return { active: on, label: state ? capitalize(state) : "Idle" };
    }
    case "cover": {
      const pos = s.position as number | undefined;
      const state = s.state as string | undefined;
      return { active: state !== "closed", label: state ? capitalize(state) : "Cover", detail: pos != null ? `${pos}%` : undefined };
    }
    case "alarm_control_panel": {
      const state = s.state as string | undefined;
      return { active: state === "armed_away" || state === "armed_home", label: state ? capitalize(state.replace(/_/g, " ")) : "Disarmed" };
    }
    case "vacuum": {
      const state = s.state as string | undefined;
      const battery = s.battery as number | undefined;
      return { active: state === "cleaning", label: state ? capitalize(state) : "Idle", detail: battery != null ? `${battery}%` : undefined };
    }
    case "humidifier":
    case "water_heater": {
      const on = s.power === "on";
      return { active: on, label: on ? "On" : "Off" };
    }
    case "scene":
      return { active: false, label: "Scene" };
    case "camera":
      return { active: device.availability.online, label: device.availability.online ? "Streaming" : "Offline" };
    default: {
      if (s.power != null) {
        const on = s.power === "on" || s.power === true;
        return { active: on, label: on ? "On" : "Off" };
      }
      if (typeof s.state === "string") return { active: s.state !== "off" && s.state !== "unavailable", label: capitalize(s.state) };
      if (s.value != null) return { active: true, label: String(s.value) };
      return { active: false, label: "Unknown" };
    }
  }
}

// ── State formatting helpers ──

function formatStateKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

function formatStateValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number") {
    const k = key.toLowerCase();
    if (k.includes("temp")) return `${value}°`;
    if (k.includes("brightness") || k.includes("volume") || k.includes("speed") || k.includes("position") || k.includes("battery") || k.includes("humidity"))
      return `${value}%`;
    return String(value);
  }
  if (typeof value === "string") return capitalize(value);
  if (Array.isArray(value)) return value.join(", ");
  return JSON.stringify(value);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Markdown components (same as MemoryPanel) ──

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

// ── Pinned memory type ──

interface PinnedMemory {
  id: number;
  content: string;
  tags: string[];
  pinned: boolean;
  updatedAt: number;
}

// ── Root component ──

export default function DevicePanel({ compact }: { compact?: boolean }) {
  const { data: devices, isLoading, refetch } = trpc.devices.list.useQuery(undefined, {
    refetchInterval: 3000,
  });
  const { data: pinnedByEntity } = trpc.memory.pinnedByEntity.useQuery(undefined, {
    refetchInterval: 30000,
  });

  trpc.devices.onEvent.useSubscription(undefined, {
    onData: () => refetch(),
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(new Set());

  const pinnedMap = useMemo(() => {
    const m = new Map<string, PinnedMemory[]>();
    if (pinnedByEntity) {
      for (const group of pinnedByEntity) {
        m.set(group.entityId, group.memories as PinnedMemory[]);
      }
    }
    return m;
  }, [pinnedByEntity]);

  const grouped = useMemo(() => {
    if (!devices) return [];
    const map = new Map<string, Device[]>();
    for (const d of devices) {
      const area = d.area?.name || "Unassigned";
      let list = map.get(area);
      if (!list) { list = []; map.set(area, list); }
      list.push(d);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([area, devs]) => ({
        area,
        devices: devs.sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name)),
      }));
  }, [devices]);

  const toggleArea = (area: string) => {
    setCollapsedAreas((prev) => {
      const next = new Set(prev);
      if (next.has(area)) next.delete(area); else next.add(area);
      return next;
    });
  };

  // ── Compact mode (tile grid) ──
  if (compact) {
    return (
      <div className="p-4 flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <span className="text-base font-bold" style={{ color: "var(--gray-12)" }}>Devices</span>
          {devices && (
            <span className="text-xs" style={{ color: "var(--gray-9)" }}>{devices.length} connected</span>
          )}
        </div>
        <div
          className="flex-1 overflow-auto"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: "8px",
          }}
        >
          {devices?.map((device, i) => {
            const status = getPrimaryState(device);
            const domainColor = getDomainColor(device.domain);
            return (
              <div
                key={device.id}
                className="flex flex-col gap-1.5 animate-fade-in"
                style={{
                  background: "var(--gray-3)",
                  border: status.active
                    ? `1px solid color-mix(in srgb, ${domainColor} 30%, var(--gray-a5))`
                    : "1px solid var(--gray-a5)",
                  borderRadius: "10px",
                  padding: "10px 12px",
                  animationDelay: `${i * 30}ms`,
                }}
              >
                <div className="flex items-center gap-2">
                  <DeviceIcon domain={device.domain} active={status.active} />
                  <span
                    className="text-[13px] font-medium truncate"
                    style={{ color: "var(--gray-12)" }}
                  >
                    {device.name}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px]" style={{ color: "var(--gray-9)" }}>
                    {status.label}
                  </span>
                  {status.detail && (
                    <span
                      className="text-[11px] tabular-nums"
                      style={{ fontFamily: "var(--font-mono)", color: "var(--gray-12)" }}
                    >
                      {status.detail}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Full panel ──
  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-between items-center px-6 py-4">
        <span className="text-base font-bold" style={{ color: "var(--gray-12)" }}>Devices</span>
        {devices && (
          <span className="text-xs" style={{ color: "var(--gray-9)" }}>{devices.length} connected</span>
        )}
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="shimmer w-full h-12 rounded-lg" />
        </div>
      ) : devices && devices.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center" style={{ paddingBottom: "10vh" }}>
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
            style={{ background: "var(--gray-a3)", border: "1px solid var(--gray-a5)" }}
          >
            <Plug size={22} strokeWidth={1.5} style={{ color: "var(--gray-8)" }} />
          </div>
          <h3 className="text-base font-semibold mb-1" style={{ color: "var(--gray-12)" }}>
            No devices connected
          </h3>
          <p className="text-sm mb-4" style={{ color: "var(--gray-9)", maxWidth: "300px", lineHeight: "1.6" }}>
            Connect a device provider like Home Assistant to start controlling your smart home.
          </p>
          <Button
            variant="bordered"
            size="sm"
            onPress={() => { window.location.hash = "settings"; }}
          >
            Go to Settings
          </Button>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {grouped.map(({ area, devices: areaDevices }) => (
            <div key={area}>
              <AreaHeader
                area={area}
                count={areaDevices.length}
                collapsed={collapsedAreas.has(area)}
                onToggle={() => toggleArea(area)}
              />
              {!collapsedAreas.has(area) && (
                <div
                  style={{
                    padding: "0 20px 16px 20px",
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                    gap: "10px",
                  }}
                >
                  {areaDevices.map((device, i) => (
                    <DeviceCard
                      key={device.id}
                      device={device}
                      expanded={expandedId === device.id}
                      onToggle={() => setExpandedId(expandedId === device.id ? null : device.id)}
                      pinnedMemories={pinnedMap.get(device.id)}
                      index={i}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Area header (sticky) ──

function AreaHeader({ area, count, collapsed, onToggle }: {
  area: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2.5 cursor-pointer select-none"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        padding: "12px 20px 8px 20px",
        background: "var(--gray-2)",
      }}
    >
      <ChevronRight
        size={14}
        strokeWidth={2}
        style={{
          color: "var(--gray-8)",
          transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
          transition: "transform 150ms",
        }}
      />
      <span className="text-sm font-semibold" style={{ color: "var(--gray-12)" }}>
        {area}
      </span>
      <Chip size="sm" variant="flat" classNames={{ base: "h-5", content: "text-[11px] px-0" }} style={{ background: "var(--gray-a3)", color: "var(--gray-9)" }}>
        {count} {count === 1 ? "device" : "devices"}
      </Chip>
    </button>
  );
}

// ── Device card ──

function DeviceCard({ device, expanded, onToggle, pinnedMemories, index }: {
  device: Device;
  expanded: boolean;
  onToggle: () => void;
  pinnedMemories?: PinnedMemory[];
  index?: number;
}) {
  const status = getPrimaryState(device);
  const offline = !device.availability.online;
  const domainColor = getDomainColor(device.domain);

  const cardStyle: React.CSSProperties = {
    background: "var(--gray-3)",
    borderRadius: "12px",
    cursor: "pointer",
    transition: "all 150ms",
    opacity: offline ? 0.55 : 1,
    padding: 0,
    ...(expanded
      ? {
          border: "1px solid var(--accent-a5)",
          boxShadow: "0 0 0 1px var(--accent-a5), 0 4px 12px rgba(0,0,0,0.08)",
        }
      : offline
        ? {
            border: "1px solid var(--gray-a3)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          }
        : status.active
          ? {
              border: `1px solid color-mix(in srgb, ${domainColor} 30%, var(--gray-a5))`,
              boxShadow: `0 0 0 1px color-mix(in srgb, ${domainColor} 15%, transparent), 0 2px 8px color-mix(in srgb, ${domainColor} 6%, transparent)`,
            }
          : {
              border: "1px solid var(--gray-a5)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
            }),
  };

  return (
    <Card
      className="animate-fade-in"
      style={{ ...cardStyle, animationDelay: `${(index ?? 0) * 30}ms` }}
      classNames={{ base: "device-card" }}
      isPressable={false}
      shadow="none"
    >
      <CardBody style={{ padding: 0 }}>
        {/* Collapsed row */}
        <div
          onClick={onToggle}
          className="flex items-center gap-3"
          style={{ padding: "12px 14px", cursor: "pointer" }}
        >
          <DeviceIcon domain={device.domain} active={status.active} />
          <div className="flex-1 min-w-0">
            <span
              className="text-[13px] font-medium truncate block"
              style={{ color: "var(--gray-12)" }}
            >
              {device.name}
            </span>
            <span className="text-[11px]" style={{ color: "var(--gray-9)" }}>
              {status.label}
            </span>
          </div>
          {status.detail && (
            <span
              className="text-[12px] tabular-nums flex-shrink-0"
              style={{ fontFamily: "var(--font-mono)", color: "var(--gray-12)" }}
            >
              {status.detail}
            </span>
          )}
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{
              background: offline
                ? "var(--danger)"
                : status.active
                  ? domainColor
                  : "var(--gray-6)",
              boxShadow: status.active && !offline
                ? `0 0 6px color-mix(in srgb, ${domainColor} 40%, transparent)`
                : "none",
            }}
          />
        </div>

        {/* Expanded detail */}
        {expanded && (
          <ExpandedDetail device={device} pinnedMemories={pinnedMemories} />
        )}
      </CardBody>
    </Card>
  );
}

// ── Expanded detail panel ──

function ExpandedDetail({ device, pinnedMemories }: {
  device: Device;
  pinnedMemories?: PinnedMemory[];
}) {
  const stateEntries = Object.entries(device.state).filter(([, v]) => v != null);

  return (
    <div
      className="space-y-3"
      style={{
        padding: "0 14px 14px 14px",
        borderTop: "1px solid var(--gray-a3)",
        marginTop: "4px",
      }}
    >
      {/* State tiles */}
      {stateEntries.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
            gap: "8px",
            paddingTop: "12px",
          }}
        >
          {stateEntries.map(([key, value]) => (
            <div
              key={key}
              style={{
                background: "var(--gray-a3)",
                borderRadius: "8px",
                padding: "8px 10px",
              }}
            >
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
      )}

      {/* Pinned memories */}
      {pinnedMemories && pinnedMemories.length > 0 && (
        <div
          className="rounded-lg p-3 space-y-2"
          style={{ background: "var(--gray-a3)", border: "1px solid var(--gray-a5)" }}
        >
          <div className="flex items-center gap-1.5">
            <Brain size={12} strokeWidth={1.5} style={{ color: "var(--gray-8)" }} />
            <span className="text-[10px] font-semibold uppercase" style={{ color: "var(--gray-8)" }}>
              Agent Notes
            </span>
          </div>
          {pinnedMemories.map((mem) => (
            <div key={mem.id}>
              <div className="text-xs leading-relaxed" style={{ color: "var(--gray-11)" }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {mem.content}
                </ReactMarkdown>
              </div>
              <span className="text-[10px]" style={{ color: "var(--gray-7)" }}>
                {relativeTime(mem.updatedAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Metadata bar */}
      {device.metadata && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {device.metadata.manufacturer && (
            <MetaItem label="Mfr" value={device.metadata.manufacturer} />
          )}
          {device.metadata.model && (
            <MetaItem label="Model" value={device.metadata.model} />
          )}
          {device.metadata.swVersion && (
            <MetaItem label="FW" value={device.metadata.swVersion} />
          )}
        </div>
      )}

    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px]" style={{ color: "var(--gray-7)" }}>{label}</span>
      <span className="text-[11px]" style={{ fontFamily: "var(--font-mono)", color: "var(--gray-9)" }}>{value}</span>
    </div>
  );
}

