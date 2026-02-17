import { useState, useRef, useEffect } from "react";
import { trpc } from "../trpc";
import type { AgentActivity } from "@holms/shared";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [showReasoning, setShowReasoning] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sendMutation = trpc.chat.send.useMutation({
    onSuccess: (data) => {
      setMessages((prev) => [...prev, data]);
    },
  });

  trpc.chat.onActivity.useSubscription(undefined, {
    onData: (activity) => {
      setActivities((prev) => [...prev.slice(-49), activity]);
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, activities]);

  const handleSend = () => {
    if (!input.trim() || sendMutation.isPending) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    sendMutation.mutate({ message: input.trim() });
    setInput("");
  };

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--void)" }}>
      {/* Header */}
      <div
        className="px-6 py-4 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: "1px solid var(--graphite)" }}
      >
        <div>
          <div className="text-[15px] font-medium" style={{ color: "var(--white)" }}>
            Coordinator
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: "var(--steel)", fontFamily: "var(--font-mono)" }}>
            {sendMutation.isPending ? "thinking..." : "ready"}
          </div>
        </div>
        <button
          onClick={() => setShowReasoning(!showReasoning)}
          className="btn-ghost"
        >
          {showReasoning ? "Hide" : "Show"} reasoning
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-6 py-4">
        {messages.length === 0 ? (
          <div className="empty-state" style={{ paddingTop: "80px" }}>
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center mb-2"
              style={{
                background: "linear-gradient(135deg, var(--glow-wash), transparent)",
                border: "1px solid var(--glow-border)",
              }}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                  d="M3 4c0-1 .8-1.8 1.8-1.8h10.4c1 0 1.8.8 1.8 1.8v8.5c0 1-.8 1.8-1.8 1.8H8L4 17.5V4z"
                  stroke="var(--glow-bright)"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="text-[13px] font-medium" style={{ color: "var(--mist)" }}>
              Talk to your home
            </div>
            <div className="empty-state-text">
              Ask the coordinator to control devices, set preferences, or check what's happening.
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, i) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-fade-in`}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                {msg.role === "assistant" && (
                  <div
                    className="w-6 h-6 rounded-lg flex items-center justify-center mr-2 mt-1 flex-shrink-0"
                    style={{ background: "var(--glow-wash)", border: "1px solid var(--glow-border)" }}
                  >
                    <div className="w-2 h-2 rounded-full" style={{ background: "var(--glow)" }} />
                  </div>
                )}
                <div
                  className="max-w-[65%] rounded-xl px-4 py-2.5"
                  style={{
                    background: msg.role === "user" ? "var(--glow)" : "var(--slate)",
                    border: msg.role === "user" ? "none" : "1px solid var(--graphite)",
                    color: msg.role === "user" ? "white" : "var(--frost)",
                    fontSize: "13px",
                    lineHeight: "1.6",
                  }}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  <p
                    className="mt-1"
                    style={{
                      fontSize: "10px",
                      fontFamily: "var(--font-mono)",
                      opacity: 0.4,
                    }}
                  >
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))}

            {/* Thinking indicator */}
            {sendMutation.isPending && (
              <div className="flex justify-start animate-fade-in">
                <div
                  className="w-6 h-6 rounded-lg flex items-center justify-center mr-2 mt-1 flex-shrink-0"
                  style={{ background: "var(--glow-wash)", border: "1px solid var(--glow-border)" }}
                >
                  <div className="w-2 h-2 rounded-full animate-breathe" style={{ background: "var(--glow)" }} />
                </div>
                <div
                  className="rounded-xl px-4 py-3"
                  style={{ background: "var(--slate)", border: "1px solid var(--graphite)" }}
                >
                  <div className="flex gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="w-1.5 h-1.5 rounded-full animate-breathe"
                        style={{
                          background: "var(--steel)",
                          animationDelay: `${i * 200}ms`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Reasoning panel */}
        {showReasoning && activities.length > 0 && (
          <div
            className="mt-4 rounded-lg p-3"
            style={{ background: "var(--abyss)", border: "1px solid var(--graphite)" }}
          >
            <span className="section-label">Agent Reasoning</span>
            <div className="mt-2 space-y-1">
              {activities.slice(-5).map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 py-0.5"
                  style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}
                >
                  <span
                    className="badge"
                    style={{
                      background: a.type === "tool_use" ? "var(--glow-wash)" : a.type === "result" ? "var(--ok-dim)" : "var(--warn-dim)",
                      color: a.type === "tool_use" ? "var(--glow-bright)" : a.type === "result" ? "var(--ok)" : "var(--warn)",
                    }}
                  >
                    {a.type === "tool_use" ? "MCP" : a.type === "result" ? "RES" : "THK"}
                  </span>
                  <span className="truncate" style={{ color: "var(--silver)" }}>
                    {a.type === "tool_use"
                      ? String((a.data as Record<string, unknown>).tool ?? "")
                      : a.type === "result"
                        ? String((a.data as Record<string, unknown>).result ?? "").slice(0, 60)
                        : "Processing..."}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div
        className="px-6 py-4 flex-shrink-0"
        style={{ borderTop: "1px solid var(--graphite)" }}
      >
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Talk to your home..."
            className="input-base flex-1"
            disabled={sendMutation.isPending}
          />
          <button
            onClick={handleSend}
            disabled={sendMutation.isPending || !input.trim()}
            className="btn-primary"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ display: "block" }}>
              <path d="M2 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
