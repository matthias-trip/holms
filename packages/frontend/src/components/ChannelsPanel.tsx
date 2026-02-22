import { useState } from "react";
import ChannelList from "./channels/ChannelList";
import ConversationList from "./channels/ConversationList";
import ChannelRouting from "./channels/ChannelRouting";

const channelSubTabs = [
  { key: "providers", label: "Providers" },
  { key: "conversations", label: "Conversations" },
  { key: "routing", label: "Routing" },
] as const;

export default function ChannelsPanel() {
  const [subTab, setSubTab] = useState<string>("providers");

  return (
    <div className="h-full flex flex-col">
      {/* Sub-tab bar — pill buttons */}
      <div
        className="px-6 py-2 flex gap-1 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--gray-a3)" }}
      >
        {channelSubTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
            style={{
              background: subTab === t.key ? "var(--gray-3)" : "transparent",
              border: subTab === t.key ? "1px solid var(--gray-a5)" : "1px solid transparent",
              color: subTab === t.key ? "var(--gray-12)" : "var(--gray-9)",
            }}
            onMouseEnter={(e) => {
              if (subTab !== t.key) {
                e.currentTarget.style.color = "var(--gray-11)";
                e.currentTarget.style.background = "var(--gray-a3)";
              }
            }}
            onMouseLeave={(e) => {
              if (subTab !== t.key) {
                e.currentTarget.style.color = "var(--gray-9)";
                e.currentTarget.style.background = "transparent";
              }
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {subTab === "providers" && <ChannelList />}
        {subTab === "conversations" && <ConversationList />}
        {subTab === "routing" && <ChannelRouting />}
      </div>
    </div>
  );
}
