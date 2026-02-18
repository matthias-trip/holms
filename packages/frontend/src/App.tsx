import { useState, useCallback, useEffect } from "react";
import ChatPanel from "./components/ChatPanel";
import DevicePanel from "./components/DevicePanel";
import MemoryPanel from "./components/MemoryPanel";
import ReflexPanel from "./components/ReflexPanel";
import AgentsPanel from "./components/AgentsPanel";
import SchedulesPanel from "./components/SchedulesPanel";
import CycleOverview from "./components/CycleOverview";
import { trpc } from "./trpc";
import type { PendingApproval } from "@holms/shared";

type Panel = "dashboard" | "chat" | "agents" | "devices" | "memory" | "reflexes" | "schedules";

const VALID_PANELS = new Set<string>(["dashboard", "chat", "agents", "devices", "memory", "reflexes", "schedules"]);

function getPanelFromHash(): Panel {
  const hash = window.location.hash.slice(1);
  return VALID_PANELS.has(hash) ? (hash as Panel) : "dashboard";
}

const NAV_ITEMS: { id: Panel; label: string }[] = [
  { id: "dashboard", label: "Overview" },
  { id: "chat", label: "Chat" },
  { id: "agents", label: "Agents" },
  { id: "devices", label: "Devices" },
  { id: "memory", label: "Memory" },
  { id: "reflexes", label: "Automations" },
  { id: "schedules", label: "Schedules" },
];

function NavIcon({ id, active }: { id: Panel; active: boolean }) {
  const color = active ? "var(--white)" : "var(--steel)";
  const size = 16;

  switch (id) {
    case "dashboard":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="6" height="6" rx="1.5" stroke={color} strokeWidth="1.3" />
          <rect x="9" y="1" width="6" height="6" rx="1.5" stroke={color} strokeWidth="1.3" />
          <rect x="1" y="9" width="6" height="6" rx="1.5" stroke={color} strokeWidth="1.3" />
          <rect x="9" y="9" width="6" height="6" rx="1.5" stroke={color} strokeWidth="1.3" />
        </svg>
      );
    case "chat":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <path
            d="M2.5 3C2.5 2.17 3.17 1.5 4 1.5h8c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5H6l-3 2.5V3z"
            stroke={color}
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <circle cx="5.5" cy="6.5" r="0.75" fill={color} />
          <circle cx="8" cy="6.5" r="0.75" fill={color} />
          <circle cx="10.5" cy="6.5" r="0.75" fill={color} />
        </svg>
      );
    case "devices":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="5" r="3.5" stroke={color} strokeWidth="1.3" />
          <path d="M8 8.5v4M6 14.5h4" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "memory":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6.5" stroke={color} strokeWidth="1.3" />
          <circle cx="8" cy="8" r="2.5" stroke={color} strokeWidth="1.3" />
          <path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "agents":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="4" r="2.5" stroke={color} strokeWidth="1.3" />
          <circle cx="3" cy="12" r="2" stroke={color} strokeWidth="1.3" />
          <circle cx="13" cy="12" r="2" stroke={color} strokeWidth="1.3" />
          <path d="M6.5 6l-2 4.5M9.5 6l2 4.5" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "reflexes":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <path d="M9.5 1.5L5 9h4l-2 5.5L12 7H8l1.5-5.5z" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      );
    case "schedules":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6.5" stroke={color} strokeWidth="1.3" />
          <path d="M8 4v4.5l3 1.5" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}

function formatApprovalAction(command: string, params: unknown, deviceId: string): string {
  const p = params as Record<string, unknown>;
  if (command.startsWith("set_")) {
    const prop = command.replace("set_", "").replace(/_/g, " ");
    const val = Object.values(p)[0];
    const valStr = typeof val === "number" ? `${val}%` : String(val);
    return `Set ${deviceId} ${prop} to ${valStr}`;
  }
  if (command === "turn_on") return `Turn on ${deviceId}`;
  if (command === "turn_off") return `Turn off ${deviceId}`;
  if (command === "lock") return `Lock ${deviceId}`;
  if (command === "unlock") return `Unlock ${deviceId}`;
  return `${command.replace(/_/g, " ")} on ${deviceId}`;
}

function ApprovalBanner({
  pending,
  onNavigate,
}: {
  pending: PendingApproval[];
  onNavigate: () => void;
}) {
  const latest = pending[pending.length - 1];
  const utils = trpc.useUtils();

  const approveMutation = trpc.approval.approve.useMutation({
    onSuccess: () => utils.approval.pending.invalidate(),
  });
  const rejectMutation = trpc.approval.reject.useMutation({
    onSuccess: () => utils.approval.pending.invalidate(),
  });

  const isLoading = approveMutation.isPending || rejectMutation.isPending;

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 animate-slide-down"
      style={{
        background: "var(--warm-wash)",
        borderBottom: "1px solid var(--warm-border)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
        <path
          d="M8 1.5L1.5 13.5h13L8 1.5z"
          stroke="var(--warn)"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M8 6.5v3" stroke="var(--warn)" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="8" cy="11.5" r="0.6" fill="var(--warn)" />
      </svg>
      <button
        onClick={onNavigate}
        className="flex-1 text-left text-[12px] truncate cursor-pointer"
        style={{ color: "var(--frost)", background: "none", border: "none", padding: 0 }}
      >
        <span style={{ fontWeight: 500 }}>
          {pending.length > 1 ? `${pending.length} approvals needed` : "Approval needed"}
        </span>
        <span style={{ color: "var(--silver)", marginLeft: 6 }}>
          {formatApprovalAction(latest.command, latest.params, latest.deviceId)}
        </span>
      </button>
      <div className="flex gap-1.5 flex-shrink-0">
        <button
          onClick={() => approveMutation.mutate({ id: latest.id })}
          disabled={isLoading}
          className="px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer transition-all"
          style={{
            background: "var(--ok-dim)",
            color: "var(--ok)",
            border: "1px solid rgba(22,163,74,0.15)",
          }}
        >
          Approve
        </button>
        <button
          onClick={() => rejectMutation.mutate({ id: latest.id })}
          disabled={isLoading}
          className="px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer transition-all"
          style={{
            background: "var(--err-dim)",
            color: "var(--err)",
            border: "1px solid rgba(220,38,38,0.15)",
          }}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [activePanel, setActivePanelRaw] = useState<Panel>(getPanelFromHash);

  const setActivePanel = useCallback((panel: Panel) => {
    window.location.hash = panel === "dashboard" ? "" : panel;
    setActivePanelRaw(panel);
  }, []);

  useEffect(() => {
    const onHashChange = () => setActivePanelRaw(getPanelFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Global approval state
  const utils = trpc.useUtils();
  const { data: pendingApprovals } = trpc.approval.pending.useQuery(undefined, {
    refetchInterval: 3000,
  });
  trpc.approval.onProposal.useSubscription(undefined, {
    onData: () => utils.approval.pending.invalidate(),
  });

  const hasPending = pendingApprovals && pendingApprovals.length > 0;
  const showBanner = hasPending && activePanel !== "dashboard";

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--void)" }}>
      {/* Sidebar */}
      <nav
        className="w-[200px] flex-shrink-0 flex flex-col"
        style={{
          background: "var(--abyss)",
          borderRight: "1px solid var(--graphite)",
        }}
      >
        {/* Logo */}
        <div className="px-4 pt-5 pb-4">
          <img
            src="/header-bw.png"
            alt="Holms"
            className="h-8"
            style={{ objectFit: "contain" }}
          />
        </div>

        {/* Nav items */}
        <div className="flex-1 px-3 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive = activePanel === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActivePanel(item.id)}
                className="w-full text-left px-3 py-2 rounded-lg text-[13px] flex items-center gap-3 transition-all duration-150 relative"
                style={{
                  background: isActive ? "var(--glow-wash)" : "transparent",
                  color: isActive ? "var(--white)" : "var(--silver)",
                  border: isActive ? "1px solid var(--glow-border)" : "1px solid transparent",
                }}
              >
                <NavIcon id={item.id} active={isActive} />
                <span style={{ fontWeight: isActive ? 500 : 400 }}>{item.label}</span>
                {item.id === "dashboard" && hasPending && (
                  <span
                    className="absolute right-2.5 w-2 h-2 rounded-full animate-pulse-dot"
                    style={{ background: "var(--err)" }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Status */}
        <div
          className="mx-3 mb-4 px-3 py-2.5 rounded-lg flex items-center gap-2.5"
          style={{ background: "var(--obsidian)", border: "1px solid var(--graphite)" }}
        >
          <div
            className="w-1.5 h-1.5 rounded-full animate-pulse-dot"
            style={{ background: "var(--warm)" }}
          />
          <span
            className="text-[11px]"
            style={{ color: "var(--silver)" }}
          >
            Assistant ready
          </span>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {showBanner && (
          <ApprovalBanner
            pending={pendingApprovals}
            onNavigate={() => setActivePanel("dashboard")}
          />
        )}
        <div className="flex-1 overflow-hidden">
          {activePanel === "dashboard" && <CycleOverview />}
          {activePanel === "chat" && <ChatPanel />}
          {activePanel === "agents" && <AgentsPanel />}
          {activePanel === "devices" && <DevicePanel />}
          {activePanel === "memory" && <MemoryPanel />}
          {activePanel === "reflexes" && <ReflexPanel />}
          {activePanel === "schedules" && <SchedulesPanel />}
        </div>
      </main>
    </div>
  );
}

