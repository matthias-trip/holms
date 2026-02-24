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
    <div className="h-full flex flex-col" style={{ background: "var(--gray-2)" }}>
      {/* Header */}
      <div
        className="flex justify-between items-center flex-shrink-0 px-6 h-14"
        style={{ borderBottom: "1px solid var(--gray-a3)", background: "var(--gray-1)" }}
      >
        <h3 className="text-base font-bold" style={{ color: "var(--gray-12)" }}>Channels</h3>
      </div>

      {/* Sub-tabs */}
      <div
        className="flex gap-1 flex-shrink-0 px-6 py-2"
        style={{ borderBottom: "1px solid var(--gray-a3)" }}
      >
        {channelSubTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer"
            style={{
              background: subTab === t.key ? "var(--gray-3)" : "transparent",
              border: subTab === t.key ? "1px solid var(--gray-a5)" : "1px solid transparent",
              color: subTab === t.key ? "var(--gray-12)" : "var(--gray-9)",
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
