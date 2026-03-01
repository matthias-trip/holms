import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Plug, RefreshCw, Wrench, Plus, Trash2, ScrollText, X, MoreHorizontal } from "lucide-react";
import { trpc } from "../trpc";
import SetupChatModal from "./SetupChatModal";

const STATUS_COLORS: Record<string, string> = {
  running: "#22c55e",
  stopped: "var(--gray-8)",
  restarting: "#eab308",
  crashed: "#ef4444",
};

const LOG_LEVEL_COLORS: Record<string, string> = {
  debug: "var(--gray-7)",
  info: "var(--gray-9)",
  warn: "#eab308",
  error: "#ef4444",
};

/* ── Delete with auto-reset confirm ──────────────────────────────── */

function DeleteButton({ onConfirm }: { onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  if (confirming) {
    return (
      <button
        onClick={onConfirm}
        className="text-[11px] font-medium px-2 py-1 rounded-md cursor-pointer transition-colors duration-150"
        style={{ color: "var(--err)", background: "var(--err-dim)", border: "none" }}
      >
        Confirm?
      </button>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="p-1.5 rounded-md cursor-pointer transition-colors duration-150"
      style={{ color: "var(--gray-8)", background: "transparent", border: "none" }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--err)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--gray-8)"; }}
      title="Remove instance"
    >
      <Trash2 size={15} />
    </button>
  );
}

/* ── Adapter Logs Modal ───────────────────────────────────────────── */

interface LogEntry {
  level: string;
  message: string;
  timestamp: number;
}

function AdapterLogsModal({
  isOpen,
  onClose,
  instanceId,
}: {
  isOpen: boolean;
  onClose: () => void;
  instanceId: string;
}) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const utils = trpc.useUtils();

  // Live health query so PID/status update after restart
  const { data: health } = trpc.plugins.adapterStatus.useQuery(
    { id: instanceId },
    { enabled: isOpen && !!instanceId, refetchInterval: 2000 },
  );
  const status = health?.status;
  const pid = health?.pid;

  const restartMutation = trpc.plugins.adapterRestart.useMutation({
    onSuccess: () => utils.plugins.list.invalidate(),
  });

  // Fetch initial buffered logs
  const { data: bufferedLogs } = trpc.plugins.adapterLogs.useQuery(
    { id: instanceId },
    { enabled: isOpen },
  );

  // Seed logs from buffer on first load
  useEffect(() => {
    if (bufferedLogs) {
      setLogs(bufferedLogs);
    }
  }, [bufferedLogs]);

  // Subscribe to real-time logs
  trpc.plugins.onAdapterLog.useSubscription(
    { id: instanceId },
    {
      enabled: isOpen,
      onData: (entry) => {
        setLogs((prev) => {
          const next = [...prev, entry];
          return next.length > 1000 ? next.slice(-1000) : next;
        });
      },
    },
  );

  // Auto-scroll logic
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    shouldAutoScroll.current = atBottom;
  }, []);

  useEffect(() => {
    if (shouldAutoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setLogs([]);
      shouldAutoScroll.current = true;
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const statusColor = STATUS_COLORS[status ?? ""] ?? "var(--gray-7)";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0, 0, 0, 0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="flex flex-col rounded-2xl overflow-hidden animate-fade-in"
        style={{
          width: "min(800px, 90vw)",
          height: "min(80vh, 700px)",
          background: "var(--gray-2)",
          border: "1px solid var(--gray-a5)",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 h-12 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--gray-a3)", background: "var(--gray-1)" }}
        >
          <div className="flex items-center gap-2.5">
            <ScrollText size={16} style={{ color: "var(--gray-9)" }} />
            <span className="text-sm font-medium" style={{ color: "var(--gray-12)" }}>
              {instanceId}
            </span>
            {pid != null && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded tabular-nums"
                style={{ background: "var(--gray-a3)", color: "var(--gray-8)", fontFamily: "var(--font-mono)" }}
              >
                PID {pid}
              </span>
            )}
            <span
              className="w-2 h-2 rounded-full"
              style={{
                background: statusColor,
                boxShadow: status === "running" ? `0 0 6px ${statusColor}` : "none",
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => restartMutation.mutate({ id: instanceId })}
              disabled={restartMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors duration-150 cursor-pointer"
              style={{
                background: "transparent",
                border: "1px solid var(--gray-a5)",
                color: "var(--gray-9)",
                opacity: restartMutation.isPending ? 0.5 : 1,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gray-a3)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <RefreshCw size={12} className={restartMutation.isPending ? "animate-spin-slow" : ""} />
              {restartMutation.isPending ? "Restarting..." : "Restart"}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg cursor-pointer transition-colors duration-150"
              style={{ color: "var(--gray-8)", background: "transparent", border: "none" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--gray-12)"; e.currentTarget.style.background = "var(--gray-a3)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--gray-8)"; e.currentTarget.style.background = "transparent"; }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Log viewer */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-auto px-4 py-3"
          style={{ fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: "1.7" }}
        >
          {logs.length === 0 ? (
            <div className="flex items-center justify-center h-full" style={{ color: "var(--gray-7)" }}>
              No log entries yet
            </div>
          ) : (
            logs.map((entry, i) => {
              const ts = new Date(entry.timestamp);
              const timeStr = ts.toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                fractionalSecondDigits: 3,
              } as Intl.DateTimeFormatOptions);
              const levelColor = LOG_LEVEL_COLORS[entry.level] ?? "var(--gray-9)";

              return (
                <div key={i} className="flex gap-2 hover:bg-[var(--gray-a3)] px-1 rounded">
                  <span className="flex-shrink-0 tabular-nums" style={{ color: "var(--gray-7)" }}>
                    {timeStr}
                  </span>
                  <span
                    className="flex-shrink-0 w-11 text-right uppercase text-[10px] font-medium self-center"
                    style={{ color: levelColor }}
                  >
                    {entry.level}
                  </span>
                  <span style={{ color: "var(--gray-11)", wordBreak: "break-all" }}>
                    {entry.message}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-5 h-9 flex-shrink-0 text-[11px]"
          style={{ borderTop: "1px solid var(--gray-a3)", color: "var(--gray-7)" }}
        >
          <span>{logs.length} entries</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Instance row ─────────────────────────────────────────────────── */

function InstanceRow({
  inst,
  pluginName,
  onLogs,
  onTweak,
  onRemove,
}: {
  inst: { id: string; displayName?: string; config: Record<string, unknown>; health: any; configuredEntityCount: number };
  pluginName: string;
  onLogs: () => void;
  onTweak: () => void;
  onRemove: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const health = inst.health;
  const statusColor = health
    ? (STATUS_COLORS[health.status] ?? "var(--gray-8)")
    : "var(--gray-7)";
  const isRunning = health?.status === "running";
  const needsSetup = isRunning && health.entityCount > 0 && inst.configuredEntityCount === 0;

  // Build subtitle parts
  const parts: string[] = [];
  if (inst.configuredEntityCount > 0) {
    parts.push(`${inst.configuredEntityCount} entit${inst.configuredEntityCount === 1 ? "y" : "ies"}`);
  }
  if (health?.status && health.status !== "running") {
    parts.push(health.status.charAt(0).toUpperCase() + health.status.slice(1));
  }

  return (
    <div
      className="group flex items-center gap-3 px-3 py-2 rounded-lg transition-colors duration-100"
      style={{ background: hovered ? "var(--gray-a3)" : "transparent" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Status dot */}
      <span
        className="w-[7px] h-[7px] rounded-full flex-shrink-0"
        style={{
          background: statusColor,
          boxShadow: isRunning ? `0 0 6px ${statusColor}` : "none",
        }}
      />

      {/* Name + subtitle */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium truncate" style={{ color: "var(--gray-12)" }}>
            {inst.displayName || inst.id}
          </span>
          {inst.displayName && (
            <span
              className="text-[11px] truncate"
              style={{ color: "var(--gray-7)", fontFamily: "var(--font-mono)" }}
            >
              {inst.id}
            </span>
          )}
        </div>
        {parts.length > 0 && (
          <span className="text-[11px]" style={{ color: "var(--gray-8)" }}>
            {parts.join(" · ")}
          </span>
        )}
      </div>

      {/* Needs setup CTA */}
      {needsSetup && (
        <button
          onClick={onTweak}
          className="text-[11px] font-medium px-2 py-1 rounded-md cursor-pointer transition-colors duration-150 flex-shrink-0"
          style={{ color: "var(--accent-9)", background: "var(--accent-a3)", border: "none" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent-a5)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "var(--accent-a3)"; }}
        >
          Assign entities
        </button>
      )}

      {/* Actions — visible on hover */}
      <div
        className="flex items-center gap-1 flex-shrink-0 transition-opacity duration-100"
        style={{ opacity: hovered ? 1 : 0 }}
      >
        <button
          onClick={onLogs}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium cursor-pointer transition-colors duration-150"
          style={{ color: "var(--gray-8)", background: "transparent", border: "none" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--gray-12)"; e.currentTarget.style.background = "var(--gray-a3)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--gray-8)"; e.currentTarget.style.background = "transparent"; }}
        >
          <ScrollText size={13} />
          Logs
        </button>
        <button
          onClick={onTweak}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium cursor-pointer transition-colors duration-150"
          style={{ color: "var(--gray-8)", background: "transparent", border: "none" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--gray-12)"; e.currentTarget.style.background = "var(--gray-a3)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--gray-8)"; e.currentTarget.style.background = "transparent"; }}
        >
          <Wrench size={13} />
          Edit
        </button>
        <DeleteButton onConfirm={onRemove} />
      </div>
    </div>
  );
}

/* ── Main panel ────────────────────────────────────────────────────── */

export default function AdaptersPanel() {
  const [setupAdapter, setSetupAdapter] = useState<{ name: string; adapterType: string } | null>(null);
  const [tweakTarget, setTweakTarget] = useState<{ adapterName: string; instanceId: string } | null>(null);
  const [logsTarget, setLogsTarget] = useState<{ instanceId: string } | null>(null);
  const utils = trpc.useUtils();
  const { data: plugins } = trpc.plugins.list.useQuery(undefined, {
    refetchInterval: 5000,
  });

  const toggleMutation = trpc.plugins.toggle.useMutation({
    onSuccess: () => utils.plugins.list.invalidate(),
  });

  const installMutation = trpc.plugins.install.useMutation({
    onSuccess: () => utils.plugins.list.invalidate(),
  });

  const refreshMutation = trpc.plugins.refresh.useMutation({
    onSuccess: () => utils.plugins.list.invalidate(),
  });

  const removeMutation = trpc.plugins.adapterRemove.useMutation({
    onSuccess: () => utils.plugins.list.invalidate(),
  });

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--gray-2)" }}>
      {/* Header */}
      <div
        className="flex justify-between items-center flex-shrink-0 px-6 h-14"
        style={{ borderBottom: "1px solid var(--gray-a3)", background: "var(--gray-1)" }}
      >
        <h3 className="text-base font-bold" style={{ color: "var(--gray-12)" }}>Adapters</h3>
        <button
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors duration-150 cursor-pointer"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--gray-9)",
            opacity: refreshMutation.isPending ? 0.5 : 1,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--gray-12)"; e.currentTarget.style.background = "var(--gray-a3)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--gray-9)"; e.currentTarget.style.background = "transparent"; }}
        >
          <RefreshCw
            size={12}
            className={refreshMutation.isPending ? "animate-spin-slow" : ""}
          />
          {refreshMutation.isPending ? "Scanning..." : "Rescan"}
        </button>
      </div>

      <div className="flex-1 overflow-auto px-6 py-5 space-y-3">
        {!plugins || plugins.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Plug size={18} />
            </div>
            <div className="empty-state-text">
              No adapters installed. Add adapter plugins to adapters/ or ~/.holms/adapters/ to connect
              external platforms.
            </div>
          </div>
        ) : (
          plugins.map((plugin, i) => {
            const hasInstances = plugin.adapterInstances && plugin.adapterInstances.length > 0;
            const isAdapter = plugin.capabilities.includes("adapter");

            return (
              <div
                key={plugin.name}
                className="rounded-xl animate-fade-in"
                style={{
                  opacity: plugin.enabled ? 1 : 0.5,
                  animationDelay: `${i * 40}ms`,
                  background: "var(--gray-3)",
                  border: "1px solid var(--gray-a5)",
                }}
              >
                {/* ── Adapter header ── */}
                <div className="flex items-center gap-3 px-4 py-3.5">
                  {/* Icon */}
                  <div
                    className="flex-shrink-0 flex items-center justify-center rounded-lg"
                    style={{
                      width: 34,
                      height: 34,
                      background: plugin.enabled ? "var(--accent-a3)" : "var(--gray-a3)",
                      color: plugin.enabled ? "var(--accent-9)" : "var(--gray-8)",
                    }}
                  >
                    <Plug size={15} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: "var(--gray-12)" }}>
                        {plugin.name}
                      </span>
                      <span className="text-[11px]" style={{ color: "var(--gray-7)" }}>
                        {plugin.version}
                      </span>
                      {!plugin.enabled && (
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                          style={{ color: "var(--gray-9)", background: "var(--gray-a3)" }}
                        >
                          Disabled
                        </span>
                      )}
                    </div>
                    {plugin.description && (
                      <p className="text-xs mt-0.5 truncate" style={{ color: "var(--gray-9)" }}>
                        {plugin.description}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {plugin.installed && plugin.enabled && isAdapter && !hasInstances && (
                      <button
                        onClick={() => setSetupAdapter({ name: plugin.name, adapterType: plugin.adapterType ?? plugin.name })}
                        className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-medium cursor-pointer transition-colors duration-150"
                        style={{
                          background: "var(--accent-a3)",
                          border: "1px solid var(--accent-a5)",
                          color: "var(--accent-9)",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent-a5)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "var(--accent-a3)"; }}
                      >
                        <Wrench size={13} />
                        Setup
                      </button>
                    )}

                    {!plugin.installed && (
                      <button
                        onClick={() => installMutation.mutate({ name: plugin.name })}
                        disabled={installMutation.isPending}
                        className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-medium cursor-pointer transition-colors duration-150"
                        style={{
                          background: "var(--accent-9)",
                          color: "white",
                          border: "none",
                          opacity: installMutation.isPending ? 0.5 : 1,
                        }}
                      >
                        {installMutation.isPending ? "Installing..." : "Install"}
                      </button>
                    )}

                    <button
                      onClick={() => toggleMutation.mutate({ name: plugin.name, enabled: !plugin.enabled })}
                      disabled={toggleMutation.isPending}
                      className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium cursor-pointer transition-colors duration-150"
                      style={{
                        background: "transparent",
                        border: "1px solid var(--gray-a5)",
                        color: plugin.enabled ? "var(--gray-9)" : "var(--accent-9)",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gray-a3)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      {plugin.enabled ? "Disable" : "Enable"}
                    </button>
                  </div>
                </div>

                {/* ── Instances ── */}
                {hasInstances && (
                  <div
                    className="mx-3 mb-3 rounded-lg overflow-hidden"
                    style={{ border: "1px solid var(--gray-a3)" }}
                  >
                    {plugin.adapterInstances!.map((inst, j) => (
                      <div
                        key={inst.id}
                        style={j > 0 ? { borderTop: "1px solid var(--gray-a3)" } : undefined}
                      >
                        <InstanceRow
                          inst={inst}
                          pluginName={plugin.name}
                          onLogs={() => setLogsTarget({ instanceId: inst.id })}
                          onTweak={() => setTweakTarget({ adapterName: plugin.name, instanceId: inst.id })}
                          onRemove={() => removeMutation.mutate({ id: inst.id })}
                        />
                      </div>
                    ))}

                    {/* Add instance row */}
                    {plugin.multiInstance && (
                      <div style={{ borderTop: "1px solid var(--gray-a3)" }}>
                        <button
                          onClick={() => setSetupAdapter({ name: plugin.name, adapterType: plugin.adapterType ?? plugin.name })}
                          className="flex items-center gap-2 w-full px-3 py-2 text-[12px] font-medium cursor-pointer transition-colors duration-150"
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "var(--gray-8)",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent-9)"; e.currentTarget.style.background = "var(--gray-a3)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--gray-8)"; e.currentTarget.style.background = "transparent"; }}
                        >
                          <Plus size={12} />
                          Add instance
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Setup modal (new instance) */}
      <SetupChatModal
        isOpen={!!setupAdapter}
        onClose={() => setSetupAdapter(null)}
        adapterName={setupAdapter?.name ?? ""}
        adapterType={setupAdapter?.adapterType}
      />

      {/* Tweak modal (existing instance) */}
      <SetupChatModal
        isOpen={!!tweakTarget}
        onClose={() => setTweakTarget(null)}
        adapterName={tweakTarget?.adapterName ?? ""}
        instanceId={tweakTarget?.instanceId}
      />

      {/* Logs modal */}
      <AdapterLogsModal
        isOpen={!!logsTarget}
        onClose={() => setLogsTarget(null)}
        instanceId={logsTarget?.instanceId ?? ""}
      />
    </div>
  );
}
