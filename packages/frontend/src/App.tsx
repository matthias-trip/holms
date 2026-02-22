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
  Puzzle,
  Sparkles,
} from "lucide-react";
import { useTheme } from "./context/ThemeContext";
import ChatPanel from "./components/ChatPanel";
import DevicePanel from "./components/DevicePanel";
import MemoryPanel from "./components/MemoryPanel";
import ReflexPanel from "./components/ReflexPanel";
import ActivityPanel from "./components/ActivityPanel";
import AutomationsPanel from "./components/AutomationsPanel";
import GoalsPanel from "./components/GoalsPanel";
import PeoplePanel from "./components/PeoplePanel";
import TriagePanel from "./components/TriagePanel";
import IntegrationsPanel from "./components/IntegrationsPanel";
import ChannelsPanel from "./components/ChannelsPanel";
import PluginsPanel from "./components/PluginsPanel";
import UsagePanel from "./components/UsagePanel";
import CycleOverview from "./components/CycleOverview";
import { trpc } from "./trpc";

type Panel =
  | "dashboard"
  | "chat"
  | "activity"
  | "usage"
  | "devices"
  | "people"
  | "memory"
  | "reflexes"
  | "triage"
  | "automations"
  | "goals"
  | "integrations"
  | "channels"
  | "plugins";

const VALID_PANELS = new Set<string>([
  "dashboard", "chat", "activity", "usage", "devices", "people",
  "memory", "reflexes", "triage", "automations", "goals", "integrations",
  "channels", "plugins",
]);

function getPanelFromHash(): Panel {
  const hash = window.location.hash.slice(1);
  // Backward compat: #settings → #integrations
  if (hash === "settings") return "integrations";
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
      { id: "devices", label: "Devices" },
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
      { id: "integrations", label: "Integrations" },
      { id: "channels", label: "Channels" },
      { id: "people", label: "People" },
      { id: "plugins", label: "Plugins" },
    ],
  },
];

const NAV_ICONS: Record<Panel, React.ComponentType<{ size: number; strokeWidth: number; style?: React.CSSProperties }>> = {
  dashboard: LayoutGrid,
  chat: MessageCircle,
  activity: Activity,
  usage: BarChart3,
  devices: Lightbulb,
  people: Users,
  memory: Target,
  automations: Clock,
  goals: Sparkles,
  reflexes: Zap,
  triage: ListFilter,
  integrations: Plug,
  channels: Radio,
  plugins: Puzzle,
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

function OnboardingBanner({ onNavigate }: { onNavigate: (panel: Panel) => void }) {
  const { data: status } = trpc.deviceProviders.onboardingStatus.useQuery(undefined, {
    refetchInterval: 5000,
  });

  if (!status) return null;

  if (!status.hasProvider) {
    return (
      <div
        className="mx-6 mt-4 px-4 py-3 rounded-lg flex items-center gap-3"
        style={{ background: "var(--accent-a3)", border: "1px solid var(--accent-a5)" }}
      >
        <Plug size={18} style={{ color: "var(--accent-9)", flexShrink: 0 }} />
        <div className="flex-1">
          <div className="text-sm font-medium" style={{ color: "var(--gray-12)" }}>
            Welcome to Holms
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--gray-10)" }}>
            Connect Home Assistant in Settings to get started
          </div>
        </div>
        <Button
          size="sm"
          variant="flat"
          color="primary"
          onPress={() => onNavigate("integrations")}
        >
          Settings
        </Button>
      </div>
    );
  }

  if (status.needsOnboarding) {
    return (
      <div
        className="mx-6 mt-4 px-4 py-3 rounded-lg flex items-center gap-3"
        style={{ background: "var(--accent-a3)", border: "1px solid var(--accent-a5)" }}
      >
        <Search size={18} className="animate-pulse" style={{ color: "var(--accent-9)", flexShrink: 0 }} />
        <div className="flex-1">
          <div className="text-sm font-medium" style={{ color: "var(--gray-12)" }}>
            Discovering your home...
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--gray-10)" }}>
            The assistant is analyzing your Home Assistant entities and setting up your home
          </div>
        </div>
        <Button
          size="sm"
          variant="flat"
          color="primary"
          onPress={() => onNavigate("chat")}
        >
          View Chat
        </Button>
      </div>
    );
  }

  return null;
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
        {activePanel === "dashboard" && <OnboardingBanner onNavigate={setActivePanel} />}
        <div className="flex-1 overflow-hidden">
          {activePanel === "dashboard" && <CycleOverview />}
          {activePanel === "chat" && <ChatPanel />}
          {activePanel === "activity" && <ActivityPanel />}
          {activePanel === "usage" && <UsagePanel />}
          {activePanel === "devices" && <DevicePanel />}
          {activePanel === "people" && <PeoplePanel />}
          {activePanel === "memory" && <MemoryPanel />}
          {activePanel === "automations" && <AutomationsPanel />}
          {activePanel === "goals" && <GoalsPanel />}
          {activePanel === "reflexes" && <ReflexPanel />}
          {activePanel === "triage" && <TriagePanel />}
          {activePanel === "integrations" && <IntegrationsPanel />}
          {activePanel === "channels" && <ChannelsPanel />}
          {activePanel === "plugins" && <PluginsPanel />}
        </div>
      </main>
    </div>
  );
}
