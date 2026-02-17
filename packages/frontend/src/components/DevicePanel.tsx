import { trpc } from "../trpc";
import type { Device } from "@holms/shared";

function DeviceIcon({ type, active }: { type: string; active: boolean }) {
  const color = active ? "var(--white)" : "var(--steel)";
  switch (type) {
    case "light":
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="7" r="4" stroke={color} strokeWidth="1.3" />
          <path d="M7 11h4M7.5 13h3" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
          {active && <circle cx="9" cy="7" r="2" fill="var(--warn)" opacity="0.5" />}
        </svg>
      );
    case "thermostat":
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <rect x="7" y="2" width="4" height="10" rx="2" stroke={color} strokeWidth="1.3" />
          <circle cx="9" cy="14" r="2.5" stroke={color} strokeWidth="1.3" />
          {active && <circle cx="9" cy="14" r="1.2" fill="var(--err)" opacity="0.6" />}
        </svg>
      );
    case "motion_sensor":
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="2" stroke={color} strokeWidth="1.3" />
          <path d="M4.5 9a4.5 4.5 0 009 0M2.5 9a6.5 6.5 0 0013 0" stroke={color} strokeWidth="1.3" strokeLinecap="round" opacity="0.5" />
          {active && <circle cx="9" cy="9" r="1" fill="var(--ok)" />}
        </svg>
      );
    case "door_lock":
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <rect x="4" y="8" width="10" height="8" rx="2" stroke={color} strokeWidth="1.3" />
          <path d="M6.5 8V6a2.5 2.5 0 015 0v2" stroke={color} strokeWidth="1.3" />
          <circle cx="9" cy="12" r="1" fill={color} />
        </svg>
      );
    default:
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="6" stroke={color} strokeWidth="1.3" />
        </svg>
      );
  }
}

function getDeviceStatus(device: Device): { label: string; active: boolean; detail?: string } {
  switch (device.type) {
    case "light": {
      const on = device.state.on === true;
      const brightness = device.state.brightness as number | undefined;
      return {
        active: on,
        label: on ? "On" : "Off",
        detail: on && brightness !== undefined ? `${brightness}%` : undefined,
      };
    }
    case "thermostat": {
      const temp = device.state.temperature as number;
      const target = device.state.target as number;
      return {
        active: true,
        label: `${temp}°`,
        detail: `Target ${target}°`,
      };
    }
    case "motion_sensor": {
      const motion = device.state.motion === true;
      return { active: motion, label: motion ? "Motion" : "Clear" };
    }
    case "door_lock": {
      const locked = device.state.locked === true;
      return { active: locked, label: locked ? "Locked" : "Unlocked" };
    }
    default:
      return { active: false, label: "Unknown" };
  }
}

export default function DevicePanel({ compact }: { compact?: boolean }) {
  const { data: devices, isLoading, refetch } = trpc.devices.list.useQuery(undefined, {
    refetchInterval: 3000,
  });

  trpc.devices.onEvent.useSubscription(undefined, {
    onData: () => refetch(),
  });

  return (
    <div className={`${compact ? "p-4" : "h-full p-6"} flex flex-col`}>
      <div className="flex items-center justify-between mb-4">
        <span className="section-label">Devices</span>
        {devices && (
          <span
            className="text-[11px]"
            style={{ fontFamily: "var(--font-mono)", color: "var(--pewter)" }}
          >
            {devices.length} connected
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="shimmer w-full h-12 rounded-lg" />
        </div>
      ) : (
        <div className={`flex-1 overflow-auto space-y-1.5 ${compact ? "" : "grid grid-cols-2 lg:grid-cols-3 gap-3 space-y-0"}`}>
          {devices?.map((device, i) => (
            <DeviceCard key={device.id} device={device} compact={compact} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceCard({ device, compact, index }: { device: Device; compact?: boolean; index: number }) {
  const status = getDeviceStatus(device);

  if (compact) {
    return (
      <div
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 animate-fade-in"
        style={{
          background: status.active ? "var(--glow-wash)" : "var(--slate)",
          border: status.active ? "1px solid var(--glow-border)" : "1px solid var(--graphite)",
          animationDelay: `${index * 30}ms`,
        }}
      >
        <DeviceIcon type={device.type} active={status.active} />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium truncate" style={{ color: "var(--frost)" }}>
            {device.name}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status.detail && (
            <span
              className="text-[11px]"
              style={{ fontFamily: "var(--font-mono)", color: "var(--silver)" }}
            >
              {status.detail}
            </span>
          )}
          <span
            className="text-[11px] font-medium"
            style={{
              fontFamily: "var(--font-mono)",
              color: status.active ? "var(--ok)" : "var(--pewter)",
            }}
          >
            {status.label}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="p-4 rounded-xl transition-all duration-200 animate-fade-in relative overflow-hidden"
      style={{
        background: status.active
          ? "linear-gradient(145deg, var(--graphite), var(--slate))"
          : "var(--slate)",
        border: status.active ? "1px solid var(--glow-border)" : "1px solid var(--graphite)",
        animationDelay: `${index * 50}ms`,
      }}
    >
      {status.active && (
        <div
          className="absolute top-0 right-0 w-24 h-24 rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(124,92,252,0.08) 0%, transparent 70%)",
            transform: "translate(30%, -30%)",
          }}
        />
      )}
      <div className="flex items-start justify-between mb-3 relative">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{
            background: status.active ? "var(--glow-wash)" : "var(--graphite)",
            border: `1px solid ${status.active ? "var(--glow-border)" : "var(--gunmetal)"}`,
          }}
        >
          <DeviceIcon type={device.type} active={status.active} />
        </div>
        <div
          className="w-2 h-2 rounded-full"
          style={{
            background: status.active ? "var(--ok)" : "var(--gunmetal)",
            boxShadow: status.active ? "0 0 8px rgba(52,211,153,0.4)" : "none",
          }}
        />
      </div>
      <div className="relative">
        <div className="text-[13px] font-medium mb-0.5" style={{ color: "var(--frost)" }}>
          {device.name}
        </div>
        <div className="text-[11px]" style={{ color: "var(--steel)" }}>
          {device.room}
        </div>
      </div>
      <div
        className="mt-3 pt-3 flex items-center justify-between"
        style={{ borderTop: "1px solid var(--graphite)" }}
      >
        <span
          className="text-[11px] font-medium"
          style={{
            fontFamily: "var(--font-mono)",
            color: status.active ? "var(--glow-bright)" : "var(--pewter)",
          }}
        >
          {status.label}
        </span>
        {status.detail && (
          <span
            className="text-[11px]"
            style={{ fontFamily: "var(--font-mono)", color: "var(--silver)" }}
          >
            {status.detail}
          </span>
        )}
      </div>
    </div>
  );
}
