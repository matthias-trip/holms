import { useState, useCallback, useEffect } from "react";
import { Button } from "@heroui/react";
import {
  LayoutGrid,
  MessageCircle,
  Activity,
  BarChart3,
  Lightbulb,
  Target,
  Zap,
  Clock,
  Settings,
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "./context/ThemeContext";
import ChatPanel from "./components/ChatPanel";
import DevicePanel from "./components/DevicePanel";
import MemoryPanel from "./components/MemoryPanel";
import ReflexPanel from "./components/ReflexPanel";
import ActivityPanel from "./components/ActivityPanel";
import SchedulesPanel from "./components/SchedulesPanel";
import SettingsPanel from "./components/SettingsPanel";
import UsagePanel from "./components/UsagePanel";
import CycleOverview from "./components/CycleOverview";

type Panel = "dashboard" | "chat" | "activity" | "usage" | "devices" | "memory" | "reflexes" | "schedules" | "settings";

const VALID_PANELS = new Set<string>(["dashboard", "chat", "activity", "usage", "devices", "memory", "reflexes", "schedules", "settings"]);

function getPanelFromHash(): Panel {
  const hash = window.location.hash.slice(1);
  return VALID_PANELS.has(hash) ? (hash as Panel) : "dashboard";
}

const NAV_ITEMS: { id: Panel; label: string }[] = [
  { id: "dashboard", label: "Overview" },
  { id: "chat", label: "Chat" },
  { id: "activity", label: "Activity" },
  { id: "usage", label: "Usage" },
  { id: "devices", label: "Devices" },
  { id: "memory", label: "Memory" },
  { id: "reflexes", label: "Automations" },
  { id: "schedules", label: "Schedules" },
  { id: "settings", label: "Settings" },
];

const NAV_ICONS: Record<Panel, React.ComponentType<{ size: number; strokeWidth: number; style?: React.CSSProperties }>> = {
  dashboard: LayoutGrid,
  chat: MessageCircle,
  activity: Activity,
  usage: BarChart3,
  devices: Lightbulb,
  memory: Target,
  reflexes: Zap,
  schedules: Clock,
  settings: Settings,
};

export default function App() {
  const [activePanel, setActivePanelRaw] = useState<Panel>(getPanelFromHash);
  const { resolved, toggleAppearance } = useTheme();

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
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--gray-2)" }}>
      {/* Sidebar */}
      <div
        className="flex flex-col flex-shrink-0 w-[200px]"
        style={{
          background: "var(--gray-1)",
          borderRight: "1px solid var(--gray-a3)",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 pt-5 pb-4">
          <img
            src="/logo.png"
            alt="Holms"
            className="w-7 h-7 rounded-lg"
          />
          <span
            className="text-base font-medium"
            style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.04em", color: "var(--gray-12)" }}
          >
            holms
          </span>
        </div>

        {/* Nav items */}
        <div className="flex flex-col gap-1 flex-1 px-3">
          {NAV_ITEMS.map((item) => {
            const isActive = activePanel === item.id;
            const Icon = NAV_ICONS[item.id];
            return (
              <Button
                key={item.id}
                variant="light"
                color="default"
                onPress={() => setActivePanel(item.id)}
                className="justify-start w-full"
                style={{
                  gap: "12px",
                  fontWeight: isActive ? 500 : 400,
                  background: isActive ? "var(--accent-a3)" : undefined,
                  borderLeft: isActive ? "3px solid var(--accent-9)" : "3px solid transparent",
                  borderRadius: "8px",
                  color: isActive ? "var(--gray-12)" : "var(--gray-9)",
                }}
                startContent={
                  <Icon
                    size={16}
                    strokeWidth={1.5}
                    style={{ color: isActive ? "var(--accent-9)" : "var(--gray-8)" }}
                  />
                }
              >
                {item.label}
              </Button>
            );
          })}
        </div>

        {/* Bottom section */}
        <div className="flex flex-col gap-3 mx-3 mb-4">
          {/* Theme toggle */}
          <Button
            isIconOnly
            variant="light"
            color="default"
            size="md"
            onPress={toggleAppearance}
            title={resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            style={{ alignSelf: "flex-start" }}
          >
            {resolved === "dark" ? <Sun size={16} strokeWidth={1.5} /> : <Moon size={16} strokeWidth={1.5} />}
          </Button>

          {/* Status */}
          <div
            className="px-3 py-2.5 rounded-lg"
            style={{ background: "var(--color-background)", border: "1px solid var(--gray-a5)" }}
          >
            <div className="flex items-center gap-2">
              <div
                className="w-1.5 h-1.5 rounded-full animate-pulse-dot"
                style={{ background: "var(--warm)" }}
              />
              <span className="text-xs" style={{ color: "var(--gray-9)" }}>
                Assistant ready
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden">
          {activePanel === "dashboard" && <CycleOverview />}
          {activePanel === "chat" && <ChatPanel />}
          {activePanel === "activity" && <ActivityPanel />}
          {activePanel === "usage" && <UsagePanel />}
          {activePanel === "devices" && <DevicePanel />}
          {activePanel === "memory" && <MemoryPanel />}
          {activePanel === "reflexes" && <ReflexPanel />}
          {activePanel === "schedules" && <SchedulesPanel />}
          {activePanel === "settings" && <SettingsPanel />}
        </div>
      </main>
    </div>
  );
}
