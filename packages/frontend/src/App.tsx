import { useState, useCallback, useEffect } from "react";
import { Button } from "@heroui/react";
import {
  LayoutGrid,
  MessageCircle,
  Activity,
  Lightbulb,
  Users,
  Settings,
  Sun,
  Moon,
  Sparkles,
  LogOut,
  Clock,
} from "lucide-react";
import { useTheme } from "./context/ThemeContext";
import { useAuth } from "./context/AuthContext";
import ChatPanel from "./components/ChatPanel";
import SpacesPanel from "./components/SpacesPanel";
import PeoplePanel from "./components/PeoplePanel";
import HomeView from "./components/home/HomeView";
import SystemStatus from "./components/SystemStatus";
import AgentPulse from "./components/shared/AgentPulse";
import ActivityView from "./components/views/ActivityView";
import GoalsView from "./components/views/GoalsView";
import AutomationsView from "./components/views/AutomationsView";
import SettingsView from "./components/views/SettingsView";

type Panel =
  | "home"
  | "chat"
  | "activity"
  | "goals"
  | "automations"
  | "spaces"
  | "people"
  | "settings";

// Backward compat: map old hash names to new panels
const HASH_ALIASES: Record<string, Panel> = {
  dashboard: "home",
  usage: "activity",
  memory: "goals",
  reflexes: "automations",
  triage: "automations",
  adapters: "settings",
  channels: "settings",
  zones: "settings",
  devices: "settings",
  integrations: "settings",
  plugins: "settings",
};

const VALID_PANELS = new Set<string>([
  "home", "chat", "activity", "goals", "automations", "spaces", "people", "settings",
]);

function getPanelFromHash(): Panel {
  const hash = window.location.hash.slice(1);
  if (HASH_ALIASES[hash]) return HASH_ALIASES[hash];
  return VALID_PANELS.has(hash) ? (hash as Panel) : "home";
}

// --- Navigation ---

type NavItem = { id: Panel; label: string };

const NAV: NavItem[] = [
  { id: "home", label: "Home" },
  { id: "chat", label: "Chat" },
  { id: "activity", label: "Activity" },
  { id: "goals", label: "Goals" },
  { id: "automations", label: "Automations" },
  { id: "spaces", label: "Spaces" },
  { id: "people", label: "People" },
  { id: "settings", label: "Settings" },
];

const NAV_ICONS: Record<Panel, React.ComponentType<{ size: number; strokeWidth: number; style?: React.CSSProperties }>> = {
  home: LayoutGrid,
  chat: MessageCircle,
  activity: Activity,
  goals: Sparkles,
  automations: Clock,
  spaces: Lightbulb,
  people: Users,
  settings: Settings,
};

function NavButton({
  item,
  isActive,
  onPress,
}: {
  item: NavItem;
  isActive: boolean;
  onPress: () => void;
}) {
  const Icon = NAV_ICONS[item.id];
  return (
    <Button
      variant="light"
      color="default"
      onPress={onPress}
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
}

export default function App() {
  return <AppShell />;
}

function AppShell() {
  const [activePanel, setActivePanelRaw] = useState<Panel>(getPanelFromHash);
  const { resolved, toggleAppearance } = useTheme();
  const { logout } = useAuth();

  const setActivePanel = useCallback((panel: Panel) => {
    window.location.hash = panel === "home" ? "" : panel;
    setActivePanelRaw(panel);
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      setActivePanelRaw(getPanelFromHash());
    };
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
        {/* Logo + Agent Status */}
        <AgentPulse />

        {/* Nav */}
        <div className="flex flex-col flex-1 px-3 overflow-y-auto gap-0.5">
          {NAV.map((item, i) => (
            <div key={item.id}>
              {/* Divider before Settings */}
              {i === NAV.length - 1 && (
                <div className="my-2 mx-1" style={{ height: 1, background: "var(--gray-a3)" }} />
              )}
              <NavButton
                item={item}
                isActive={activePanel === item.id}
                onPress={() => setActivePanel(item.id)}
              />
            </div>
          ))}
        </div>

        {/* Bottom section */}
        <div className="flex flex-col gap-3 mx-3 mb-4">
          {/* Theme toggle + Sign out */}
          <div className="flex items-center gap-1">
            <Button
              isIconOnly
              variant="light"
              color="default"
              size="md"
              onPress={toggleAppearance}
              title={resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {resolved === "dark" ? <Sun size={16} strokeWidth={1.5} /> : <Moon size={16} strokeWidth={1.5} />}
            </Button>
            <button
              onClick={logout}
              className="p-2 rounded-lg cursor-pointer transition-colors duration-150"
              style={{ color: "var(--gray-8)", background: "transparent" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--gray-11)"; e.currentTarget.style.background = "var(--gray-a3)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--gray-8)"; e.currentTarget.style.background = "transparent"; }}
              title="Sign out"
            >
              <LogOut size={16} strokeWidth={1.5} />
            </button>
          </div>

          {/* Status + Version */}
          <SystemStatus />
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden">
          {activePanel === "home" && <HomeView />}
          {activePanel === "chat" && <ChatPanel />}
          {activePanel === "activity" && <ActivityView />}
          {activePanel === "goals" && <GoalsView />}
          {activePanel === "automations" && <AutomationsView />}
          {activePanel === "spaces" && <SpacesPanel />}
          {activePanel === "people" && <PeoplePanel />}
          {activePanel === "settings" && <SettingsView />}
        </div>
      </main>
    </div>
  );
}
