import { useState, useCallback, useEffect } from "react";
import ChatPanel from "./components/ChatPanel";
import DevicePanel from "./components/DevicePanel";
import MemoryPanel from "./components/MemoryPanel";
import ReflexPanel from "./components/ReflexPanel";
import ActivityPanel from "./components/ActivityPanel";
import SchedulesPanel from "./components/SchedulesPanel";
import PluginsPanel from "./components/PluginsPanel";
import CycleOverview from "./components/CycleOverview";

type Panel = "dashboard" | "chat" | "activity" | "devices" | "memory" | "reflexes" | "schedules" | "plugins";

const VALID_PANELS = new Set<string>(["dashboard", "chat", "activity", "devices", "memory", "reflexes", "schedules", "plugins"]);

function getPanelFromHash(): Panel {
  const hash = window.location.hash.slice(1);
  return VALID_PANELS.has(hash) ? (hash as Panel) : "dashboard";
}

const NAV_ITEMS: { id: Panel; label: string }[] = [
  { id: "dashboard", label: "Overview" },
  { id: "chat", label: "Chat" },
  { id: "activity", label: "Activity" },
  { id: "devices", label: "Devices" },
  { id: "memory", label: "Memory" },
  { id: "reflexes", label: "Automations" },
  { id: "schedules", label: "Schedules" },
  { id: "plugins", label: "Plugins" },
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
    case "activity":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <path d="M1.5 8h3l1.5-5 3 10 1.5-5h3" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
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
    case "plugins":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <path d="M6.5 2v2.5H4a1 1 0 0 0-1 1V8h2.5a1.5 1.5 0 0 1 0 3H3v2.5a1 1 0 0 0 1 1h2.5V12a1.5 1.5 0 0 1 3 0v2.5H12a1 1 0 0 0 1-1V11h-1a1.5 1.5 0 0 1 0-3h1V5.5a1 1 0 0 0-1-1H9.5V2a1.5 1.5 0 0 0-3 0z" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      );
  }
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
        <div className="px-4 pt-5 pb-4 flex items-center gap-2.5">
          <img
            src="/logo.png"
            alt="Holms"
            className="w-7 h-7 rounded-lg"
          />
          <span
            className="text-[16px]"
            style={{ color: "var(--white)", fontWeight: 500, fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}
          >
            holms
          </span>
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
        <div className="flex-1 overflow-hidden">
          {activePanel === "dashboard" && <CycleOverview />}
          {activePanel === "chat" && <ChatPanel />}
          {activePanel === "activity" && <ActivityPanel />}
          {activePanel === "devices" && <DevicePanel />}
          {activePanel === "memory" && <MemoryPanel />}
          {activePanel === "reflexes" && <ReflexPanel />}
          {activePanel === "schedules" && <SchedulesPanel />}
          {activePanel === "plugins" && <PluginsPanel />}
        </div>
      </main>
    </div>
  );
}

