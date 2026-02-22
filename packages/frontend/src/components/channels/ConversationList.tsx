import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { Card, CardBody, Chip, Button } from "@heroui/react";
import { trpc } from "../../trpc";

export default function ConversationList() {
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

  // Group by provider
  const grouped = new Map<string, typeof conversations>();
  for (const conv of conversations ?? []) {
    const list = grouped.get(conv.providerId) ?? [];
    list.push(conv);
    grouped.set(conv.providerId, list);
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 px-6 pt-6 pb-4">
        <h3 className="text-base font-bold mb-2" style={{ color: "var(--gray-12)" }}>Conversations</h3>
        <p className="text-xs" style={{ color: "var(--gray-9)", maxWidth: "500px", lineHeight: "1.6" }}>
          Active conversations across all channel providers.
          Set topics to give the assistant context about each conversation's purpose.
        </p>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
      {!conversations || conversations.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <MessageSquare size={18} />
          </div>
          <div className="empty-state-text">
            No conversations. The web channel creates a default conversation on startup.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {Array.from(grouped.entries()).map(([providerId, convs]) => (
            <div key={providerId}>
              <span
                className="text-xs font-medium mb-2 block"
                style={{ color: "var(--gray-9)", textTransform: "uppercase", letterSpacing: "0.05em" }}
              >
                {providerId}
              </span>
              <div className="space-y-2">
                {convs!.map((conv, i) => (
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
                          <span className="text-base font-medium" style={{ color: "var(--gray-12)" }}>
                            {conv.displayName}
                          </span>
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
                            <input
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitEdit(conv.id);
                                if (e.key === "Escape") cancelEdit();
                              }}
                              placeholder="Conversation topic..."
                              autoFocus
                              className="flex-1 text-xs px-3 py-2 rounded-lg outline-none transition-colors duration-150"
                              style={{
                                background: "var(--gray-2)",
                                border: "1px solid var(--gray-a5)",
                                color: "var(--gray-12)",
                              }}
                              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent-a5)"; }}
                              onBlur={(e) => { e.currentTarget.style.borderColor = "var(--gray-a5)"; }}
                            />
                            <Button variant="flat" color="primary" size="sm" onPress={() => commitEdit(conv.id)}>
                              Save
                            </Button>
                            <Button variant="bordered" size="sm" onPress={cancelEdit}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span
                              className="text-sm"
                              style={{
                                color: conv.topic ? "var(--gray-12)" : "var(--gray-9)",
                                lineHeight: "1.5",
                              }}
                            >
                              {conv.topic || "No topic set"}
                            </span>
                            <Button variant="bordered" size="sm" onPress={() => startEdit(conv.id, conv.topic)}>
                              Edit
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
