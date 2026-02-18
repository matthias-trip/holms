import { useState } from "react";
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
            style={{ color: "var(--pewter)" }}
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
            <DeviceCard key={device.id} device={device} compact={compact} index={i} onCommand={refetch} />
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceCard({
  device,
  compact,
  index,
  onCommand,
}: {
  device: Device;
  compact?: boolean;
  index: number;
  onCommand: () => void;
}) {
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
            <span className="text-[11px]" style={{ color: "var(--silver)" }}>
              {status.detail}
            </span>
          )}
          <span
            className="text-[11px] font-medium"
            style={{ color: status.active ? "var(--ok)" : "var(--pewter)" }}
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
            background: "radial-gradient(circle, rgba(79,110,247,0.08) 0%, transparent 70%)",
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
            boxShadow: status.active ? "0 0 8px rgba(22,163,74,0.20)" : "none",
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
          style={{ color: status.active ? "var(--glow-bright)" : "var(--pewter)" }}
        >
          {status.label}
        </span>
        {status.detail && (
          <span className="text-[11px]" style={{ color: "var(--silver)" }}>
            {status.detail}
          </span>
        )}
      </div>

      {/* Controls */}
      <DeviceControls device={device} onCommand={onCommand} />
    </div>
  );
}

// ── Device Controls ──

function DeviceControls({ device, onCommand }: { device: Device; onCommand: () => void }) {
  const commandMutation = trpc.devices.command.useMutation({
    onSuccess: () => onCommand(),
  });

  const send = (command: string, params?: Record<string, unknown>) => {
    commandMutation.mutate({ deviceId: device.id, command, params });
  };

  const busy = commandMutation.isPending;

  switch (device.type) {
    case "light":
      return <LightControls device={device} send={send} busy={busy} />;
    case "thermostat":
      return <ThermostatControls device={device} send={send} busy={busy} />;
    case "motion_sensor":
      return <MotionControls device={device} send={send} busy={busy} />;
    case "door_lock":
      return <LockControls device={device} send={send} busy={busy} />;
    default:
      return null;
  }
}

// ── Light Controls ──

function LightControls({
  device,
  send,
  busy,
}: {
  device: Device;
  send: (cmd: string, params?: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const isOn = device.state.on === true;
  const brightness = (device.state.brightness as number) ?? 100;
  const [localBrightness, setLocalBrightness] = useState(brightness);

  return (
    <div className="mt-3 pt-3 space-y-2.5" style={{ borderTop: "1px solid var(--graphite)" }}>
      {/* On/Off toggle */}
      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: "var(--steel)" }}>Power</span>
        <ToggleButton
          active={isOn}
          onClick={() => send(isOn ? "turn_off" : "turn_on")}
          disabled={busy}
        />
      </div>
      {/* Brightness slider */}
      <div className="flex items-center gap-3">
        <span className="text-[11px] w-16 flex-shrink-0" style={{ color: "var(--steel)" }}>
          Brightness
        </span>
        <input
          type="range"
          min={1}
          max={100}
          value={localBrightness}
          onChange={(e) => setLocalBrightness(Number(e.target.value))}
          onMouseUp={() => send("set_brightness", { brightness: localBrightness })}
          onTouchEnd={() => send("set_brightness", { brightness: localBrightness })}
          disabled={busy}
          className="flex-1 accent-[var(--glow)]"
          style={{ height: "4px" }}
        />
        <span
          className="text-[10px] tabular-nums w-8 text-right"
          style={{ color: "var(--pewter)", fontFamily: "var(--font-mono)" }}
        >
          {localBrightness}%
        </span>
      </div>
    </div>
  );
}

// ── Thermostat Controls ──

function ThermostatControls({
  device,
  send,
  busy,
}: {
  device: Device;
  send: (cmd: string, params?: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const target = (device.state.target as number) ?? 21;
  const mode = (device.state.mode as string) ?? "auto";

  return (
    <div className="mt-3 pt-3 space-y-2.5" style={{ borderTop: "1px solid var(--graphite)" }}>
      {/* Target temperature */}
      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: "var(--steel)" }}>Target</span>
        <div className="flex items-center gap-1">
          <StepButton
            label="-"
            onClick={() => send("set_temperature", { temperature: target - 0.5 })}
            disabled={busy || target <= 10}
          />
          <span
            className="text-[12px] font-medium tabular-nums w-10 text-center"
            style={{ color: "var(--frost)", fontFamily: "var(--font-mono)" }}
          >
            {target}°
          </span>
          <StepButton
            label="+"
            onClick={() => send("set_temperature", { temperature: target + 0.5 })}
            disabled={busy || target >= 35}
          />
        </div>
      </div>
      {/* Mode */}
      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: "var(--steel)" }}>Mode</span>
        <div className="flex gap-1">
          {["auto", "heat", "cool", "off"].map((m) => (
            <button
              key={m}
              onClick={() => send("set_mode", { mode: m })}
              disabled={busy}
              className="px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
              style={{
                background: mode === m ? "var(--glow-wash)" : "transparent",
                color: mode === m ? "var(--glow-bright)" : "var(--pewter)",
                border: mode === m ? "1px solid var(--glow-border)" : "1px solid var(--graphite)",
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Motion Sensor Controls ──

function MotionControls({
  device,
  send,
  busy,
}: {
  device: Device;
  send: (cmd: string, params?: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const hasMotion = device.state.motion === true;

  return (
    <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--graphite)" }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: "var(--steel)" }}>Simulate</span>
        <div className="flex gap-1.5">
          <button
            onClick={() => send("simulate_motion")}
            disabled={busy || hasMotion}
            className="px-2.5 py-1 rounded text-[10px] font-medium transition-colors"
            style={{
              background: hasMotion ? "var(--ok-dim)" : "var(--warn-dim)",
              color: hasMotion ? "var(--ok)" : "var(--warn)",
              border: `1px solid ${hasMotion ? "var(--ok)" : "var(--warn)"}`,
              opacity: busy || hasMotion ? 0.5 : 1,
            }}
          >
            Trigger motion
          </button>
          <button
            onClick={() => send("simulate_motion_clear")}
            disabled={busy || !hasMotion}
            className="px-2.5 py-1 rounded text-[10px] font-medium transition-colors"
            style={{
              background: "var(--slate)",
              color: "var(--steel)",
              border: "1px solid var(--graphite)",
              opacity: busy || !hasMotion ? 0.5 : 1,
            }}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Lock Controls ──

function LockControls({
  device,
  send,
  busy,
}: {
  device: Device;
  send: (cmd: string, params?: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const locked = device.state.locked === true;

  return (
    <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--graphite)" }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: "var(--steel)" }}>
          {locked ? "Locked" : "Unlocked"}
        </span>
        <ToggleButton
          active={locked}
          activeColor="var(--ok)"
          inactiveColor="var(--err)"
          onClick={() => send(locked ? "unlock" : "lock")}
          disabled={busy}
        />
      </div>
    </div>
  );
}

// ── Shared UI Components ──

function ToggleButton({
  active,
  onClick,
  disabled,
  activeColor,
  inactiveColor,
}: {
  active: boolean;
  onClick: () => void;
  disabled: boolean;
  activeColor?: string;
  inactiveColor?: string;
}) {
  const onColor = activeColor ?? "var(--glow)";
  const offColor = inactiveColor ?? "var(--gunmetal)";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="relative w-9 h-5 rounded-full transition-colors duration-200"
      style={{
        background: active ? onColor : offColor,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200"
        style={{
          transform: active ? "translateX(18px)" : "translateX(2px)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
        }}
      />
    </button>
  );
}

function StepButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-6 h-6 rounded flex items-center justify-center text-[12px] font-medium transition-colors"
      style={{
        background: "var(--slate)",
        border: "1px solid var(--graphite)",
        color: disabled ? "var(--gunmetal)" : "var(--frost)",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}
