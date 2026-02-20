import { useState } from "react";
import { Lightbulb, Thermometer, Radar, Lock, CircleDot } from "lucide-react";
import { Switch, Card, CardBody, Button, Slider } from "@heroui/react";
import { trpc } from "../trpc";
import type { Device } from "@holms/shared";

function DeviceIcon({ type, active }: { type: string; active: boolean }) {
  const color = active ? "var(--gray-12)" : "var(--gray-9)";
  const props = { size: 18, color, strokeWidth: 1.3 };
  switch (type) {
    case "light":
      return <Lightbulb {...props} />;
    case "thermostat":
      return <Thermometer {...props} />;
    case "motion_sensor":
      return <Radar {...props} />;
    case "door_lock":
      return <Lock {...props} />;
    default:
      return <CircleDot {...props} />;
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
        label: `${temp}\u00b0`,
        detail: `Target ${target}\u00b0`,
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
      <div className="flex justify-between items-center mb-4">
        <span className="text-base font-bold" style={{ color: "var(--gray-12)" }}>Devices</span>
        {devices && (
          <span className="text-xs" style={{ color: "var(--gray-9)" }}>{devices.length} connected</span>
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
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 animate-fade-in"
        style={{
          background: status.active ? "var(--accent-a3)" : "var(--gray-a3)",
          border: status.active ? "1px solid var(--accent-a5)" : "1px solid var(--gray-a5)",
          animationDelay: `${index * 30}ms`,
        }}
      >
        <DeviceIcon type={device.type} active={status.active} />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium truncate block" style={{ color: "var(--gray-12)" }}>
            {device.name}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {status.detail && (
            <span className="text-xs" style={{ color: "var(--gray-12)" }}>{status.detail}</span>
          )}
          <span className="text-xs font-medium" style={{ color: status.active ? "var(--ok)" : "var(--gray-8)" }}>
            {status.label}
          </span>
        </div>
      </div>
    );
  }

  return (
    <Card
      className="transition-all duration-200 animate-fade-in relative overflow-hidden"
      style={{
        animationDelay: `${index * 50}ms`,
        border: status.active ? "1px solid var(--accent-a5)" : "1px solid var(--gray-a5)",
        background: "var(--gray-3)",
      }}
    >
      <CardBody>
        {status.active && (
          <div
            className="absolute top-0 right-0 w-24 h-24 rounded-full"
            style={{
              background: "radial-gradient(circle, rgba(79,110,247,0.08) 0%, transparent 70%)",
              transform: "translate(30%, -30%)",
            }}
          />
        )}
        <div className="flex justify-between items-start mb-3 relative">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{
              background: status.active ? "var(--accent-a3)" : "var(--gray-a5)",
              border: `1px solid ${status.active ? "var(--accent-a5)" : "var(--gray-6)"}`,
            }}
          >
            <DeviceIcon type={device.type} active={status.active} />
          </div>
          <div
            className="w-2 h-2 rounded-full"
            style={{
              background: status.active ? "var(--ok)" : "var(--gray-6)",
              boxShadow: status.active ? "0 0 8px rgba(22,163,74,0.20)" : "none",
            }}
          />
        </div>
        <div className="relative">
          <p className="text-sm font-medium mb-1" style={{ color: "var(--gray-12)" }}>{device.name}</p>
          <p className="text-xs" style={{ color: "var(--gray-9)" }}>{device.room}</p>
        </div>
        <div
          className="flex justify-between items-center mt-3 pt-3"
          style={{ borderTop: "1px solid var(--gray-a5)" }}
        >
          <span className="text-xs font-medium" style={{ color: status.active ? "var(--accent-10)" : "var(--gray-8)" }}>
            {status.label}
          </span>
          {status.detail && (
            <span className="text-xs" style={{ color: "var(--gray-12)" }}>{status.detail}</span>
          )}
        </div>

        {/* Controls */}
        <DeviceControls device={device} onCommand={onCommand} />
      </CardBody>
    </Card>
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
    <div className="mt-3 pt-3 space-y-2.5" style={{ borderTop: "1px solid var(--gray-a5)" }}>
      <div className="flex justify-between items-center">
        <span className="text-xs" style={{ color: "var(--gray-9)" }}>Power</span>
        <Switch
          isSelected={isOn}
          onValueChange={() => send(isOn ? "turn_off" : "turn_on")}
          isDisabled={busy}
          size="sm"
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs w-16 flex-shrink-0" style={{ color: "var(--gray-9)" }}>Brightness</span>
        <Slider
          value={localBrightness}
          minValue={1}
          maxValue={100}
          step={1}
          onChange={(v) => setLocalBrightness(v as number)}
          onChangeEnd={(v) => send("set_brightness", { brightness: v as number })}
          isDisabled={busy}
          size="sm"
          className="flex-1"
        />
        <span
          className="text-xs w-8 text-right tabular-nums"
          style={{ fontFamily: "var(--font-mono)", color: "var(--gray-9)" }}
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
    <div className="mt-3 pt-3 space-y-2.5" style={{ borderTop: "1px solid var(--gray-a5)" }}>
      <div className="flex justify-between items-center">
        <span className="text-xs" style={{ color: "var(--gray-9)" }}>Target</span>
        <div className="flex items-center gap-1">
          <StepButton
            label="-"
            onClick={() => send("set_temperature", { temperature: target - 0.5 })}
            disabled={busy || target <= 10}
          />
          <span
            className="text-sm font-medium tabular-nums w-10 text-center"
            style={{ fontFamily: "var(--font-mono)", color: "var(--gray-12)" }}
          >
            {target}\u00b0
          </span>
          <StepButton
            label="+"
            onClick={() => send("set_temperature", { temperature: target + 0.5 })}
            disabled={busy || target >= 35}
          />
        </div>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-xs" style={{ color: "var(--gray-9)" }}>Mode</span>
        <div className="flex gap-1">
          {["auto", "heat", "cool", "off"].map((m) => (
            <Button
              key={m}
              variant={mode === m ? "flat" : "light"}
              color={mode === m ? "primary" : "default"}
              size="sm"
              onPress={() => send("set_mode", { mode: m })}
              isDisabled={busy}
            >
              {m}
            </Button>
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
    <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--gray-a5)" }}>
      <div className="flex justify-between items-center">
        <span className="text-xs" style={{ color: "var(--gray-9)" }}>Simulate</span>
        <div className="flex gap-1">
          <Button
            variant="flat"
            color={hasMotion ? "success" : "warning"}
            size="sm"
            onPress={() => send("simulate_motion")}
            isDisabled={busy || hasMotion}
          >
            Trigger motion
          </Button>
          <Button
            variant="flat"
            color="default"
            size="sm"
            onPress={() => send("simulate_motion_clear")}
            isDisabled={busy || !hasMotion}
          >
            Clear
          </Button>
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
    <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--gray-a5)" }}>
      <div className="flex justify-between items-center">
        <span className="text-xs" style={{ color: "var(--gray-9)" }}>
          {locked ? "Locked" : "Unlocked"}
        </span>
        <Switch
          isSelected={locked}
          onValueChange={() => send(locked ? "unlock" : "lock")}
          isDisabled={busy}
          size="sm"
          color={locked ? "success" : "danger"}
        />
      </div>
    </div>
  );
}

// ── Shared UI Components ──

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
    <Button
      variant="bordered"
      size="sm"
      onPress={onClick}
      isDisabled={disabled}
      isIconOnly
      className="w-6 h-6 min-w-6"
    >
      {label}
    </Button>
  );
}
