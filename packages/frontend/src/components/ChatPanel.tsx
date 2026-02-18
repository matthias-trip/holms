import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "../trpc";
import type { ChatMessage, PendingApproval } from "@holms/shared";
import MarkdownMessage from "./MarkdownMessage";

interface StreamingMessage extends ChatMessage {
  streaming?: boolean;
}

interface ApprovalEntry {
  kind: "approval";
  approval: PendingApproval;
  resolved?: { approved: boolean };
}

type ChatEntry =
  | { kind: "message"; message: StreamingMessage }
  | ApprovalEntry;

function formatApprovalAction(command: string, params: unknown, deviceId: string): string {
  const p = params as Record<string, unknown>;
  if (command.startsWith("set_")) {
    const prop = command.replace("set_", "").replace(/_/g, " ");
    const val = Object.values(p)[0];
    const valStr = typeof val === "number" ? `${val}%` : String(val);
    return `Set ${deviceId} ${prop} to ${valStr}`;
  }
  if (command === "turn_on") return `Turn on ${deviceId}`;
  if (command === "turn_off") return `Turn off ${deviceId}`;
  if (command === "lock") return `Lock ${deviceId}`;
  if (command === "unlock") return `Unlock ${deviceId}`;
  return `${command.replace(/_/g, " ")} on ${deviceId}`;
}


function buildChatEntries(
  messages: StreamingMessage[],
  approvals: ApprovalEntry[],
): ChatEntry[] {
  const msgEntries: ChatEntry[] = messages.map((m) => ({ kind: "message" as const, message: m }));
  const apprEntries: ChatEntry[] = approvals.map((a) => a);

  const all = [...msgEntries, ...apprEntries];
  all.sort((a, b) => {
    const tsA = a.kind === "message" ? a.message.timestamp : a.approval.createdAt;
    const tsB = b.kind === "message" ? b.message.timestamp : b.approval.createdAt;
    return tsA - tsB;
  });
  return all;
}

export default function ChatPanel() {
  const [messages, setMessages] = useState<StreamingMessage[]>([]);
  const [approvalEntries, setApprovalEntries] = useState<ApprovalEntry[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const historyLoadedRef = useRef(false);
  const liveMessageIdsRef = useRef<Set<string>>(new Set());
  const streamEndReceivedRef = useRef(false);

  const utils = trpc.useUtils();
  const historyQuery = trpc.chat.history.useQuery({ limit: 100 });

  // Subscribe to new approval proposals
  const onApprovalProposal = useCallback((approval: PendingApproval) => {
    setApprovalEntries((prev) => {
      if (prev.some((e) => e.approval.id === approval.id)) return prev;
      return [...prev, { kind: "approval", approval }];
    });
  }, []);

  trpc.approval.onProposal.useSubscription(undefined, {
    onData: onApprovalProposal,
  });

  const approveMutation = trpc.approval.approve.useMutation({
    onSuccess: (_data, variables) => {
      setApprovalEntries((prev) =>
        prev.map((e) =>
          e.approval.id === variables.id ? { ...e, resolved: { approved: true } } : e,
        ),
      );
      utils.approval.pending.invalidate();
    },
  });

  const rejectMutation = trpc.approval.reject.useMutation({
    onSuccess: (_data, variables) => {
      setApprovalEntries((prev) =>
        prev.map((e) =>
          e.approval.id === variables.id ? { ...e, resolved: { approved: false } } : e,
        ),
      );
      utils.approval.pending.invalidate();
    },
  });

  useEffect(() => {
    if (historyQuery.data) {
      setMessages(historyQuery.data);
      // After first history load, scroll instantly (no animation)
      if (!historyLoadedRef.current) {
        historyLoadedRef.current = true;
        requestAnimationFrame(() => {
          scrollRef.current?.scrollTo({ top: scrollRef.current!.scrollHeight });
        });
      }
    }
  }, [historyQuery.data]);

  // Subscribe to streaming events
  const streamPlaceholderIdRef = useRef<string | null>(null);

  trpc.chat.onChatStream.useSubscription(undefined, {
    onData: (event) => {
      if (event.type === "token") {
        setMessages((prev) =>
          prev.map((m) =>
            m.streaming
              ? { ...m, content: m.content + event.token }
              : m,
          ),
        );
      } else if (event.type === "end") {
        streamEndReceivedRef.current = true;
        setMessages((prev) =>
          prev.map((m) =>
            m.streaming
              ? { ...m, content: event.content, streaming: false }
              : m,
          ),
        );
      }
    },
  });

  const sendMutation = trpc.chat.send.useMutation({
    onSuccess: (data) => {
      streamEndReceivedRef.current = false;
      const placeholderId = streamPlaceholderIdRef.current;
      streamPlaceholderIdRef.current = null;
      // Silently swap placeholder with canonical server data, keeping the same position
      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderId
            ? { ...data.assistantMsg }
            : m,
        ),
      );
    },
    onError: () => {
      streamEndReceivedRef.current = false;
      streamPlaceholderIdRef.current = null;
      setMessages((prev) => prev.filter((m) => !m.streaming));
    },
  });

  useEffect(() => {
    // Skip the initial history scroll (handled above)
    if (!historyLoadedRef.current) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || sendMutation.isPending) return;

    const userMsg: StreamingMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      timestamp: Date.now(),
    };

    const placeholderId = crypto.randomUUID();
    const placeholder: StreamingMessage = {
      id: placeholderId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      streaming: true,
    };

    liveMessageIdsRef.current.add(userMsg.id);
    liveMessageIdsRef.current.add(placeholderId);
    streamPlaceholderIdRef.current = placeholderId;
    streamEndReceivedRef.current = false;

    setMessages((prev) => [...prev, userMsg, placeholder]);
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
        <div className="flex items-center gap-3">
          <img
            src="/chaticon.png"
            alt="Holms"
            className={`w-8 h-8 rounded-lg${sendMutation.isPending ? " animate-breathe" : ""}`}
          />
          <div>
            <div className="text-[15px] font-medium" style={{ color: "var(--white)" }}>
              Assistant
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: "var(--steel)" }}>
              {sendMutation.isPending ? "thinking..." : "ready"}
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-6 py-4">
        {messages.length === 0 && approvalEntries.length === 0 ? (
          <div className="empty-state" style={{ paddingTop: "80px" }}>
            <img
              src="/chaticon.png"
              alt="Holms"
              className="w-12 h-12 rounded-2xl mb-2"
              style={{ boxShadow: "0 0 24px rgba(14, 165, 233, 0.15)" }}
            />
            <div className="text-[13px] font-medium" style={{ color: "var(--mist)" }}>
              Talk to your home
            </div>
            <div className="empty-state-text">
              Ask me to control your devices, set preferences, or check what's happening at home.
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {buildChatEntries(messages, approvalEntries).map((entry) => {
              if (entry.kind === "approval") {
                const { approval, resolved } = entry;
                const isLoading = approveMutation.isPending || rejectMutation.isPending;

                return (
                  <div key={`approval-${approval.id}`} className="flex justify-center animate-fade-in">
                    <div
                      className="w-[85%] rounded-xl p-4"
                      style={{
                        background: "var(--obsidian)",
                        border: `1px solid ${
                          resolved
                            ? resolved.approved
                              ? "rgba(22,163,74,0.2)"
                              : "rgba(220,38,38,0.2)"
                            : "var(--graphite)"
                        }`,
                      }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[11px] font-medium" style={{ color: "var(--warn)" }}>
                          Approval requested
                        </span>
                        <span className="text-[10px] ml-auto" style={{ color: "var(--pewter)" }}>
                          {new Date(approval.createdAt).toLocaleTimeString()}
                        </span>
                      </div>

                      <div
                        className="rounded-lg px-3 py-2 mb-2"
                        style={{
                          fontSize: "12px",
                          fontWeight: 500,
                          background: "var(--abyss)",
                          border: "1px solid var(--graphite)",
                          color: "var(--frost)",
                        }}
                      >
                        {formatApprovalAction(approval.command, approval.params, approval.deviceId)}
                      </div>

                      <p className="text-[12px] mb-3" style={{ color: "var(--silver)", lineHeight: "1.5" }}>
                        {approval.reason}
                      </p>

                      {resolved ? (
                        <div
                          className="text-[11px] font-medium px-2.5 py-1.5 rounded-md inline-block"
                          style={{
                            background: resolved.approved ? "var(--ok-dim)" : "var(--err-dim)",
                            color: resolved.approved ? "var(--ok)" : "var(--err)",
                          }}
                        >
                          {resolved.approved ? "Approved" : "Rejected"}
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            onClick={() => approveMutation.mutate({ id: approval.id })}
                            disabled={isLoading}
                            className="px-3 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition-all"
                            style={{
                              background: "var(--ok-dim)",
                              color: "var(--ok)",
                              border: "1px solid rgba(22,163,74,0.15)",
                            }}
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => rejectMutation.mutate({ id: approval.id })}
                            disabled={isLoading}
                            className="px-3 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition-all"
                            style={{
                              background: "var(--err-dim)",
                              color: "var(--err)",
                              border: "1px solid rgba(220,38,38,0.15)",
                            }}
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              const msg = entry.message;
              const isLive = liveMessageIdsRef.current.has(msg.id);
              return (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}${isLive ? " animate-fade-in" : ""}`}
              >
                {msg.role === "assistant" && (
                  <img
                    src="/chaticon.png"
                    alt="Holms"
                    className={`w-10 h-10 rounded-lg mr-2.5 mt-0.5 flex-shrink-0${msg.streaming ? " animate-breathe" : ""}`}
                  />
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
                  {msg.role === "assistant" ? (
                    msg.streaming && !msg.content ? (
                      <div className="flex gap-1.5 py-1">
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
                    ) : (
                      <MarkdownMessage content={msg.content} />
                    )
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                  {!(msg.streaming && !msg.content) && (
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
                  )}
                </div>
              </div>
              );
            })}
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
