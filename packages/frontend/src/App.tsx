import { useState } from "react";
import DevicePanel from "./components/DevicePanel";
import EventFeed from "./components/EventFeed";
import ChatPanel from "./components/ChatPanel";
import MemoryPanel from "./components/MemoryPanel";
import ReflexPanel from "./components/ReflexPanel";
import AgentActivity from "./components/AgentActivity";
import ApprovalPanel from "./components/ApprovalPanel";

type Panel = "dashboard" | "chat" | "devices" | "memory" | "reflexes";

const NAV_ITEMS: { id: Panel; label: string }[] = [
  { id: "dashboard", label: "Overview" },
  { id: "chat", label: "Chat" },
  { id: "devices", label: "Devices" },
  { id: "memory", label: "Memory" },
  { id: "reflexes", label: "Reflexes" },
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
    case "reflexes":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <path d="M9.5 1.5L5 9h4l-2 5.5L12 7H8l1.5-5.5z" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      );
  }
}

export default function App() {
  const [activePanel, setActivePanel] = useState<Panel>("dashboard");

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
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-semibold"
              style={{
                background: "linear-gradient(135deg, var(--glow), var(--glow-dim))",
                color: "white",
                boxShadow: "0 0 20px rgba(124, 92, 252, 0.3)",
              }}
            >
              H
            </div>
            <div>
              <div className="text-sm font-semibold" style={{ color: "var(--white)" }}>
                Holms
              </div>
            </div>
          </div>
        </div>

        {/* Nav items */}
        <div className="flex-1 px-3 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive = activePanel === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActivePanel(item.id)}
                className="w-full text-left px-3 py-2 rounded-lg text-[13px] flex items-center gap-3 transition-all duration-150"
                style={{
                  background: isActive ? "var(--glow-wash)" : "transparent",
                  color: isActive ? "var(--white)" : "var(--silver)",
                  border: isActive ? "1px solid var(--glow-border)" : "1px solid transparent",
                }}
              >
                <NavIcon id={item.id} active={isActive} />
                <span style={{ fontWeight: isActive ? 500 : 400 }}>{item.label}</span>
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
            style={{ background: "var(--ok)" }}
          />
          <span
            className="text-[11px]"
            style={{ color: "var(--silver)", fontFamily: "var(--font-mono)" }}
          >
            Coordinator online
          </span>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {activePanel === "dashboard" && <DashboardView />}
        {activePanel === "chat" && <ChatPanel />}
        {activePanel === "devices" && <DevicePanel />}
        {activePanel === "memory" && <MemoryPanel />}
        {activePanel === "reflexes" && <ReflexPanel />}
      </main>
    </div>
  );
}

function DashboardView() {
  return (
    <div className="h-full p-3 grid grid-cols-2 grid-rows-2 gap-3">
      <div className="panel overflow-hidden flex flex-col">
        <DevicePanel compact />
      </div>
      <div className="panel overflow-hidden flex flex-col">
        <EventFeed />
      </div>
      <div className="panel overflow-hidden flex flex-col">
        <AgentActivity />
      </div>
      <div className="panel overflow-hidden flex flex-col">
        <ApprovalPanel />
      </div>
    </div>
  );
}
