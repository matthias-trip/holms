import { useState } from "react";
import { trpc } from "../trpc";
import PluginsPanel from "./PluginsPanel";

type SettingsTab = "channels" | "plugins";

function ChannelsSection() {
  const { data: conversations } = trpc.channels.conversations.useQuery(undefined, {
    refetchInterval: 10000,
  });

  const utils = trpc.useUtils();
  const updateTopicMutation = trpc.channels.updateTopic.useMutation({
    onSuccess: () => utils.channels.conversations.invalidate(),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (id: string, currentTopic?: string) => {
    setEditingId(id);
    setEditValue(currentTopic ?? "");
  };

  const commitEdit = (conversationId: string) => {
    updateTopicMutation.mutate({ conversationId, topic: editValue });
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mb-5">
        <span className="section-label">Channels</span>
        <p
          className="text-[12px] mt-2"
          style={{ color: "var(--steel)", maxWidth: "500px", lineHeight: "1.6" }}
        >
          Communication channels connect the assistant to different interfaces.
          Each channel can have conversations with their own topic for context.
        </p>
      </div>

      <div className="space-y-2">
        {!conversations || conversations.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path
                  d="M3 5.5A2.5 2.5 0 0 1 5.5 3h7A2.5 2.5 0 0 1 15 5.5v5a2.5 2.5 0 0 1-2.5 2.5H7l-3 2.5V5.5z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="empty-state-text">
              No channels registered. The web channel is created automatically on startup.
            </div>
          </div>
        ) : (
          conversations.map((conv, i) => (
            <div
              key={conv.id}
              className="rounded-xl p-4 animate-fade-in"
              style={{
                background: "var(--obsidian)",
                border: "1px solid var(--graphite)",
                animationDelay: `${i * 40}ms`,
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <span
                      className="text-[14px] font-medium"
                      style={{ color: "var(--frost)" }}
                    >
                      {conv.displayName}
                    </span>
                    <span
                      className="badge"
                      style={{
                        background: "var(--glow-wash)",
                        color: "var(--glow)",
                        border: "1px solid var(--glow-border)",
                      }}
                    >
                      {conv.providerId}
                    </span>
                  </div>

                  <div
                    className="text-[11px] mb-2"
                    style={{
                      fontFamily: "var(--font-mono)",
                      color: "var(--pewter)",
                    }}
                  >
                    {conv.id}
                  </div>

                  {editingId === conv.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        className="input-base flex-1 text-[12px]"
                        style={{ padding: "5px 10px" }}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit(conv.id);
                          if (e.key === "Escape") cancelEdit();
                        }}
                        placeholder="Conversation topic..."
                        autoFocus
                      />
                      <button
                        onClick={() => commitEdit(conv.id)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition-all"
                        style={{
                          background: "var(--ok-dim)",
                          color: "var(--ok)",
                          border: "1px solid rgba(22, 163, 74, 0.15)",
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition-all"
                        style={{
                          background: "var(--slate)",
                          color: "var(--steel)",
                          border: "1px solid var(--graphite)",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[12px]"
                        style={{ color: conv.topic ? "var(--mist)" : "var(--pewter)", lineHeight: "1.5" }}
                      >
                        {conv.topic || "No topic set"}
                      </span>
                      <button
                        onClick={() => startEdit(conv.id, conv.topic)}
                        className="px-2 py-0.5 rounded text-[10px] font-medium cursor-pointer transition-all"
                        style={{
                          background: "transparent",
                          color: "var(--pewter)",
                          border: "1px solid var(--graphite)",
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "channels", label: "Channels" },
  { id: "plugins", label: "Plugins" },
];

export default function SettingsPanel() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("channels");

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--void)" }}>
      {/* Tab bar */}
      <div
        className="px-6 py-2.5 flex gap-1 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--graphite)", background: "var(--abyss)" }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150 flex-shrink-0"
              style={{
                background: isActive ? "var(--obsidian)" : "transparent",
                border: isActive ? "1px solid var(--graphite)" : "1px solid transparent",
                color: isActive ? "var(--white)" : "var(--steel)",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "channels" && <ChannelsSection />}
        {activeTab === "plugins" && <PluginsPanel />}
      </div>
    </div>
  );
}
