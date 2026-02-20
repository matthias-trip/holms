import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { Tabs, Tab, Card, CardBody, Chip, Button, Input } from "@heroui/react";
import { trpc } from "../trpc";
import PluginsPanel from "./PluginsPanel";

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
        <h3 className="text-base font-bold mb-2" style={{ color: "var(--gray-12)" }}>Channels</h3>
        <p className="text-xs" style={{ color: "var(--gray-9)", maxWidth: "500px", lineHeight: "1.6" }}>
          Communication channels connect the assistant to different interfaces.
          Each channel can have conversations with their own topic for context.
        </p>
      </div>

      <div className="space-y-2">
        {!conversations || conversations.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <MessageSquare size={18} />
            </div>
            <div className="empty-state-text">
              No channels registered. The web channel is created automatically on startup.
            </div>
          </div>
        ) : (
          conversations.map((conv, i) => (
            <Card
              key={conv.id}
              className="animate-fade-in"
              style={{
                animationDelay: `${i * 40}ms`,
                background: "var(--gray-3)",
                border: "1px solid var(--gray-a5)",
              }}
            >
              <CardBody>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-base font-medium" style={{ color: "var(--gray-12)" }}>{conv.displayName}</span>
                    <Chip variant="flat" color="primary" size="sm">
                      {conv.providerId}
                    </Chip>
                  </div>

                  <p
                    className="text-xs mb-2"
                    style={{ fontFamily: "var(--font-mono)", color: "var(--gray-8)" }}
                  >
                    {conv.id}
                  </p>

                  {editingId === conv.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit(conv.id);
                          if (e.key === "Escape") cancelEdit();
                        }}
                        placeholder="Conversation topic..."
                        size="sm"
                        className="flex-1"
                        autoFocus
                      />
                      <Button
                        variant="flat"
                        color="success"
                        size="sm"
                        onPress={() => commitEdit(conv.id)}
                      >
                        Save
                      </Button>
                      <Button
                        variant="flat"
                        color="default"
                        size="sm"
                        onPress={cancelEdit}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm" style={{ color: conv.topic ? "var(--gray-12)" : "var(--gray-9)", lineHeight: "1.5" }}>
                        {conv.topic || "No topic set"}
                      </span>
                      <Button
                        variant="light"
                        color="default"
                        size="sm"
                        onPress={() => startEdit(conv.id, conv.topic)}
                      >
                        Edit
                      </Button>
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

export default function SettingsPanel() {
  const [activeTab, setActiveTab] = useState<string>("channels");

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--gray-2)" }}>
      <div
        className="px-6 py-2.5 flex-shrink-0 overflow-x-auto"
        style={{ borderBottom: "1px solid var(--gray-a3)", background: "var(--gray-1)" }}
      >
        <Tabs
          selectedKey={activeTab}
          onSelectionChange={(key) => setActiveTab(key as string)}
          size="sm"
          variant="light"
          classNames={{ tabList: "flex-nowrap" }}
        >
          <Tab key="channels" title="Channels" />
          <Tab key="plugins" title="Plugins" />
        </Tabs>
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === "channels" && <ChannelsSection />}
        {activeTab === "plugins" && <PluginsPanel />}
      </div>
    </div>
  );
}
