import { useState, useCallback, useEffect } from "react";
import { Button } from "@heroui/react";
import {
  LayoutGrid,
  MessageCircle,
  Activity,
  BarChart3,
  Lightbulb,
  Target,
  Users,
  Zap,
  Clock,
  Settings,
  Sun,
  Moon,
  Plug,
  Search,
  ListFilter,
  ChevronDown,
  ChevronRight,
  Radio,
  Sparkles,
} from "lucide-react";
import { useTheme } from "./context/ThemeContext";
import ChatPanel from "./components/ChatPanel";
import SpacesPanel from "./components/SpacesPanel";
import MemoryPanel from "./components/MemoryPanel";
import ReflexPanel from "./components/ReflexPanel";
import ActivityPanel from "./components/ActivityPanel";
import AutomationsPanel from "./components/AutomationsPanel";
import GoalsPanel from "./components/GoalsPanel";
import PeoplePanel from "./components/PeoplePanel";
import TriagePanel from "./components/TriagePanel";
import AdaptersPanel from "./components/AdaptersPanel";
import ChannelsPanel from "./components/ChannelsPanel";
import UsagePanel from "./components/UsagePanel";
import CycleOverview from "./components/CycleOverview";
import SystemStatus from "./components/SystemStatus";

type Panel =
  | "dashboard"
  | "chat"
  | "activity"
  | "usage"
  | "spaces"
  | "people"
  | "memory"
  | "reflexes"
  | "triage"
  | "automations"
  | "goals"
  | "adapters"
  | "channels";

const VALID_PANELS = new Set<string>([
  "dashboard", "chat", "activity", "usage", "spaces", "people",
  "memory", "reflexes", "triage", "automations", "goals", "adapters",
  "channels",
]);

function getPanelFromHash(): Panel {
  const hash = window.location.hash.slice(1);
  // Backward compat
  if (hash === "settings" || hash === "integrations" || hash === "plugins") return "adapters";
  if (hash === "devices") return "spaces";
  return VALID_PANELS.has(hash) ? (hash as Panel) : "dashboard";
}

// --- Navigation structure ---

type IconComponent = React.ComponentType<{ size: number; strokeWidth: number; style?: React.CSSProperties }>;
type NavItem = { id: Panel; label: string };
type NavGroup = { label: string; icon: IconComponent; items: NavItem[] };
type NavEntry = NavItem | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return "items" in entry;
}

const NAV: NavEntry[] = [
  { id: "dashboard", label: "Overview" },
  { id: "activity", label: "Activity" },
  { id: "chat", label: "Chat" },
  { id: "goals", label: "Goals" },
  { id: "automations", label: "Automations" },
  {
    label: "Insights",
    icon: Search,
    items: [
      { id: "spaces", label: "Spaces" },
      { id: "usage", label: "Usage" },
      { id: "memory", label: "Memory" },
      { id: "reflexes", label: "Reflexes" },
      { id: "triage", label: "Triage" },
    ],
  },
  {
    label: "Settings",
    icon: Settings,
    items: [
      { id: "adapters", label: "Adapters" },
      { id: "channels", label: "Channels" },
      { id: "people", label: "People" },
    ],
  },
];

const NAV_ICONS: Record<Panel, React.ComponentType<{ size: number; strokeWidth: number; style?: React.CSSProperties }>> = {
  dashboard: LayoutGrid,
  chat: MessageCircle,
  activity: Activity,
  usage: BarChart3,
  spaces: Lightbulb,
  people: Users,
  memory: Target,
  automations: Clock,
  goals: Sparkles,
  reflexes: Zap,
  triage: ListFilter,
  adapters: Plug,
  channels: Radio,
};

function NavButton({
  item,
  isActive,
  onPress,
  indent,
}: {
  item: NavItem;
  isActive: boolean;
  onPress: () => void;
  indent?: boolean;
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
        paddingLeft: indent ? "24px" : undefined,
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

function CollapsibleGroup({
  group,
  activePanel,
  expanded,
  onToggle,
  onNavigate,
}: {
  group: NavGroup;
  activePanel: Panel;
  expanded: boolean;
  onToggle: () => void;
  onNavigate: (panel: Panel) => void;
}) {
  const hasActiveChild = group.items.some((item) => item.id === activePanel);

  const Icon = group.icon;
  return (
    <div className="mt-2">
      <Button
        variant="light"
        color="default"
        onPress={onToggle}
        className="justify-start w-full"
        style={{
          gap: "12px",
          fontWeight: hasActiveChild ? 500 : 400,
          background: hasActiveChild ? "var(--accent-a2)" : undefined,
          borderLeft: "3px solid transparent",
          borderRadius: "8px",
          color: hasActiveChild ? "var(--gray-11)" : "var(--gray-9)",
        }}
        startContent={
          <Icon
            size={16}
            strokeWidth={1.5}
            style={{ color: hasActiveChild ? "var(--accent-9)" : "var(--gray-8)" }}
          />
        }
        endContent={
          <ChevronDown
            size={14}
            strokeWidth={1.5}
            style={{
              color: "var(--gray-7)",
              marginLeft: "auto",
              transition: "transform 200ms ease",
              transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
            }}
          />
        }
      >
        {group.label}
      </Button>
      <div
        style={{
          display: "grid",
          gridTemplateRows: expanded ? "1fr" : "0fr",
          transition: "grid-template-rows 200ms ease",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <div className="flex flex-col">
            {group.items.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                isActive={activePanel === item.id}
                onPress={() => onNavigate(item.id)}
                indent
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


/** Returns the group label that contains the given panel, or null for top-level items. */
function groupForPanel(panel: Panel): string | null {
  for (const entry of NAV) {
    if (isGroup(entry) && entry.items.some((i) => i.id === panel)) {
      return entry.label;
    }
  }
  return null;
}

export default function App() {
  const [activePanel, setActivePanelRaw] = useState<Panel>(getPanelFromHash);
  // Which group is manually expanded (null = only auto-expand from active panel)
  const [manualExpanded, setManualExpanded] = useState<string | null>(null);
  const { resolved, toggleAppearance } = useTheme();

  const activeGroup = groupForPanel(activePanel);

  const setActivePanel = useCallback((panel: Panel) => {
    window.location.hash = panel === "dashboard" ? "" : panel;
    setActivePanelRaw(panel);
    // Clear manual expansion — active panel's group auto-expands
    setManualExpanded(null);
  }, []);

  const toggleGroup = useCallback((label: string) => {
    setManualExpanded((prev) => (prev === label ? null : label));
  }, []);

  const isGroupExpanded = useCallback(
    (label: string) => label === activeGroup || label === manualExpanded,
    [activeGroup, manualExpanded],
  );

  useEffect(() => {
    const onHashChange = () => {
      setActivePanelRaw(getPanelFromHash());
      setManualExpanded(null);
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

        {/* Nav */}
        <div className="flex flex-col flex-1 px-3 overflow-y-auto">
          {NAV.map((entry) => {
            if (isGroup(entry)) {
              return (
                <CollapsibleGroup
                  key={entry.label}
                  group={entry}
                  activePanel={activePanel}
                  expanded={isGroupExpanded(entry.label)}
                  onToggle={() => toggleGroup(entry.label)}
                  onNavigate={setActivePanel}
                />
              );
            }
            return (
              <NavButton
                key={entry.id}
                item={entry}
                isActive={activePanel === entry.id}
                onPress={() => setActivePanel(entry.id)}
              />
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

          {/* Status + Version */}
          <SystemStatus />
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden">
          {activePanel === "dashboard" && <CycleOverview />}
          {activePanel === "chat" && <ChatPanel />}
          {activePanel === "activity" && <ActivityPanel />}
          {activePanel === "usage" && <UsagePanel />}
          {activePanel === "spaces" && <SpacesPanel />}
          {activePanel === "people" && <PeoplePanel />}
          {activePanel === "memory" && <MemoryPanel />}
          {activePanel === "automations" && <AutomationsPanel />}
          {activePanel === "goals" && <GoalsPanel />}
          {activePanel === "reflexes" && <ReflexPanel />}
          {activePanel === "triage" && <TriagePanel />}
          {activePanel === "adapters" && <AdaptersPanel />}
          {activePanel === "channels" && <ChannelsPanel />}
        </div>
      </main>
    </div>
  );
}
