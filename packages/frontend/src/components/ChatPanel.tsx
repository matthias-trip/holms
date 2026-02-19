import { useState, useRef, useEffect } from "react";
import { trpc } from "../trpc";
import type { ChatMessage, ApprovalMessageData } from "@holms/shared";
import MarkdownMessage from "./MarkdownMessage";

interface StreamingMessage extends ChatMessage {
  streaming?: boolean;
  reasoning?: string;
  thinkingStartedAt?: number;
}

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

function parseApprovalData(content: string): ApprovalMessageData | null {
  try {
    const data = JSON.parse(content);
    if (data && typeof data.approvalId === "string") return data as ApprovalMessageData;
  } catch { /* not JSON */ }
  return null;
}

/** Live reasoning — streams as plain text (no markdown re-parse flicker), auto-scrolls */
function LiveReasoningBlock({ reasoning, startedAt }: { reasoning: string; startedAt: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [reasoning]);

  return (
    <div className="mb-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="animate-spin-slow flex-shrink-0">
          <circle cx="8" cy="8" r="6" stroke="var(--graphite)" strokeWidth="1.5" />
          <path d="M8 2a6 6 0 0 1 6 6" stroke="var(--steel)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="text-[11px] font-medium" style={{ color: "var(--steel)" }}>
          Thinking{elapsed > 0 ? ` (${elapsed}s)` : ""}...
        </span>
      </div>
      <div
        ref={scrollRef}
        className="pl-4 text-[11px] overflow-auto whitespace-pre-wrap"
        style={{
          color: "var(--silver)",
          maxHeight: "200px",
          lineHeight: 1.6,
          borderLeft: "2px solid var(--graphite)",
        }}
      >
        {reasoning}
      </div>
    </div>
  );
}

/** Collapsed reasoning toggle — shows "Thought for Xs", click to expand full markdown */
function ReasoningBlock({ reasoning, durationSec }: { reasoning: string; durationSec?: number }) {
  const [expanded, setExpanded] = useState(false);

  const label = durationSec != null && durationSec > 0
    ? `Thought for ${durationSec}s`
    : "Reasoning";

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-left"
      >
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          className="flex-shrink-0 transition-transform duration-150"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          <path d="M3.5 2l3 3-3 3" stroke="var(--pewter)" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <span className="text-[11px] font-medium" style={{ color: "var(--steel)" }}>
          {label}
        </span>
      </button>
      <div
        className="overflow-hidden transition-all duration-200 ease-in-out"
        style={{ maxHeight: expanded ? "400px" : "0px", opacity: expanded ? 1 : 0 }}
      >
        <div
          className="mt-1.5 pl-4 text-[11px] overflow-auto"
          style={{
            color: "var(--silver)",
            maxHeight: "380px",
            lineHeight: 1.6,
            borderLeft: "2px solid var(--graphite)",
          }}
        >
          <MarkdownMessage content={reasoning} />
        </div>
      </div>
    </div>
  );
}

function ApprovalCard({
  data,
  timestamp,
  onApprove,
  onReject,
  isLoading,
}: {
  data: ApprovalMessageData;
  timestamp: number;
  onApprove: () => void;
  onReject: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="flex justify-start">
      <img
        src="/chaticon.png"
        alt="Holms"
        className="w-10 h-10 rounded-lg mr-2.5 mt-0.5 flex-shrink-0"
      />
      <div
        className="max-w-[65%] rounded-xl px-4 py-2.5"
        style={{
          background: "var(--slate)",
          border: "1px solid var(--graphite)",
          fontSize: "13px",
          lineHeight: "1.6",
        }}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
            <circle cx="8" cy="8" r="6.5" stroke="var(--warn)" strokeWidth="1.3" />
            <path d="M8 5v3.5M8 10.5h.01" stroke="var(--warn)" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <span className="text-[12px] font-medium" style={{ color: "var(--frost)" }}>
            Requesting approval
          </span>
        </div>

        <p className="text-[13px] mb-2" style={{ color: "var(--frost)", lineHeight: "1.6" }}>
          {data.reason}
        </p>

        <div
          className="rounded-lg px-3 py-2 mb-2.5"
          style={{
            fontSize: "12px",
            fontWeight: 500,
            fontFamily: "var(--font-mono)",
            background: "var(--abyss)",
            border: "1px solid var(--graphite)",
            color: "var(--mist)",
          }}
        >
          {formatApprovalAction(data.command, data.params, data.deviceId)}
        </div>

        {data.resolved ? (
          <div
            className="text-[11px] font-medium px-2.5 py-1.5 rounded-md inline-block"
            style={{
              background: data.resolved.approved ? "var(--ok-dim)" : "var(--err-dim)",
              color: data.resolved.approved ? "var(--ok)" : "var(--err)",
            }}
          >
            {data.resolved.approved ? "Approved" : "Rejected"}
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={onApprove}
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
              onClick={onReject}
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

        <p
          className="mt-1"
          style={{
            fontSize: "10px",
            fontFamily: "var(--font-mono)",
            opacity: 0.4,
          }}
        >
          {new Date(timestamp).toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
}

export default function ChatPanel() {
  const [messages, setMessages] = useState<StreamingMessage[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const historyLoadedRef = useRef(false);
  const liveMessageIdsRef = useRef<Set<string>>(new Set());
  const streamEndReceivedRef = useRef(false);
  const pendingApprovalActionRef = useRef<{ approvalId: string; approved: boolean } | null>(null);

  const utils = trpc.useUtils();
  const historyQuery = trpc.chat.history.useQuery({ limit: 100 });

  const approveMutation = trpc.approval.approve.useMutation({
    onSuccess: (data) => {
      utils.approval.pending.invalidate();
      const action = pendingApprovalActionRef.current;
      pendingApprovalActionRef.current = null;
      if (!action) return;

      // Optimistically update the approval card
      setMessages((prev) =>
        prev.map((m) => {
          if (m.status !== "approval_pending" && m.status !== "approval_resolved") return m;
          const parsed = parseApprovalData(m.content);
          if (!parsed || parsed.approvalId !== action.approvalId) return m;
          const updated = { ...parsed, resolved: { approved: true } };
          return { ...m, content: JSON.stringify(updated), status: "approval_resolved" as const };
        }),
      );

      // Append streaming placeholder for the coordinator response
      if (data.thinkingMessageId) {
        const now = Date.now();
        const placeholder: StreamingMessage = {
          id: data.thinkingMessageId,
          role: "assistant",
          content: "",
          timestamp: now,
          streaming: true,
          thinkingStartedAt: now,
        };
        liveMessageIdsRef.current.add(data.thinkingMessageId);
        streamPlaceholderIdRef.current = data.thinkingMessageId;
        setMessages((prev) => [...prev, placeholder]);
      }
    },
  });

  const rejectMutation = trpc.approval.reject.useMutation({
    onSuccess: (data) => {
      utils.approval.pending.invalidate();
      const action = pendingApprovalActionRef.current;
      pendingApprovalActionRef.current = null;
      if (!action) return;

      // Optimistically update the approval card
      setMessages((prev) =>
        prev.map((m) => {
          if (m.status !== "approval_pending" && m.status !== "approval_resolved") return m;
          const parsed = parseApprovalData(m.content);
          if (!parsed || parsed.approvalId !== action.approvalId) return m;
          const updated = { ...parsed, resolved: { approved: false } };
          return { ...m, content: JSON.stringify(updated), status: "approval_resolved" as const };
        }),
      );

      // Append streaming placeholder for the coordinator response
      if (data.thinkingMessageId) {
        const now = Date.now();
        const placeholder: StreamingMessage = {
          id: data.thinkingMessageId,
          role: "assistant",
          content: "",
          timestamp: now,
          streaming: true,
          thinkingStartedAt: now,
        };
        liveMessageIdsRef.current.add(data.thinkingMessageId);
        streamPlaceholderIdRef.current = data.thinkingMessageId;
        setMessages((prev) => [...prev, placeholder]);
      }
    },
  });

  useEffect(() => {
    if (historyQuery.data) {
      // If any message has status="thinking", mark it as streaming so the indicator shows
      const loaded = historyQuery.data.map((m): StreamingMessage => {
        if (m.status === "thinking") {
          return { ...m, streaming: true };
        }
        return m;
      });
      setMessages(loaded);

      // If there's a thinking message from the DB, wire up the stream placeholder ref
      const thinkingMsg = loaded.find((m) => m.streaming);
      if (thinkingMsg) {
        streamPlaceholderIdRef.current = thinkingMsg.id;
      }

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
              ? { ...m, reasoning: (m.reasoning ?? "") + event.token }
              : m,
          ),
        );
      } else if (event.type === "end") {
        streamEndReceivedRef.current = true;
        setMessages((prev) => {
          const hasStreaming = prev.some((m) => m.streaming);
          if (hasStreaming) {
            return prev.map((m) =>
              m.streaming
                ? { ...m, content: event.content, streaming: false, reasoning: event.reasoning, thinkingStartedAt: m.thinkingStartedAt }
                : m,
            );
          }
          return prev;
        });
      }
    },
  });

  // Subscribe to new approval proposals so the card appears in real-time
  trpc.approval.onProposal.useSubscription(undefined, {
    onData: (proposal) => {
      const approvalMsg: StreamingMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: JSON.stringify({
          approvalId: proposal.id,
          deviceId: proposal.deviceId,
          command: proposal.command,
          params: proposal.params,
          reason: proposal.reason,
        }),
        timestamp: proposal.createdAt,
        status: "approval_pending",
        approvalId: proposal.id,
      };
      liveMessageIdsRef.current.add(approvalMsg.id);
      setMessages((prev) => [...prev, approvalMsg]);
    },
  });

  const sendMutation = trpc.chat.send.useMutation({
    onSuccess: (data) => {
      streamEndReceivedRef.current = false;
      const placeholderId = streamPlaceholderIdRef.current;
      streamPlaceholderIdRef.current = null;
      // Silently swap placeholder with canonical server data, keeping the same position
      // Preserve reasoning from stream_end event
      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderId
            ? { ...data.assistantMsg, reasoning: m.reasoning, thinkingStartedAt: m.thinkingStartedAt }
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

  // Derive isProcessing purely from message state — no polling needed
  const isProcessing = messages.some((m) => m.streaming);

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
    const now = Date.now();
    const placeholder: StreamingMessage = {
      id: placeholderId,
      role: "assistant",
      content: "",
      timestamp: now,
      streaming: true,
      thinkingStartedAt: now,
    };

    liveMessageIdsRef.current.add(userMsg.id);
    liveMessageIdsRef.current.add(placeholderId);
    streamPlaceholderIdRef.current = placeholderId;
    streamEndReceivedRef.current = false;

    setMessages((prev) => [...prev, userMsg, placeholder]);
    sendMutation.mutate({ message: input.trim() });
    setInput("");
  };

  const handleApprove = (approvalId: string) => {
    pendingApprovalActionRef.current = { approvalId, approved: true };
    approveMutation.mutate({ id: approvalId });
  };

  const handleReject = (approvalId: string) => {
    pendingApprovalActionRef.current = { approvalId, approved: false };
    rejectMutation.mutate({ id: approvalId });
  };

  const isApprovalLoading = approveMutation.isPending || rejectMutation.isPending;

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--void)" }}>
      {/* Header */}
      <div
        className="px-6 py-4 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: "1px solid var(--graphite)" }}
      >
        <div>
          <div className="text-[15px] font-medium" style={{ color: "var(--white)" }}>
            Assistant
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: "var(--steel)" }}>
            {isProcessing ? (
              <span className="inline-flex items-center gap-1">
                thinking
                <span className="inline-flex gap-[3px]">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="inline-block w-[3px] h-[3px] rounded-full"
                      style={{
                        background: "var(--steel)",
                        animation: "thinking-dot 1.4s ease-in-out infinite",
                        animationDelay: `${i * 0.2}s`,
                      }}
                    />
                  ))}
                </span>
              </span>
            ) : "ready"}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-6 py-4">
        {messages.length === 0 ? (
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
            {messages.map((msg) => {
              // Approval card messages
              const isApproval = msg.status === "approval_pending" || msg.status === "approval_resolved";
              if (isApproval) {
                const approvalData = parseApprovalData(msg.content);
                if (approvalData) {
                  return (
                    <ApprovalCard
                      key={msg.id}
                      data={approvalData}
                      timestamp={msg.timestamp}
                      onApprove={() => handleApprove(approvalData.approvalId)}
                      onReject={() => handleReject(approvalData.approvalId)}
                      isLoading={isApprovalLoading}
                    />
                  );
                }
              }

              // Regular messages
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
                    msg.streaming ? (
                      msg.reasoning ? (
                        <LiveReasoningBlock
                          reasoning={msg.reasoning}
                          startedAt={msg.thinkingStartedAt ?? msg.timestamp}
                        />
                      ) : (
                        <div className="flex items-center gap-2 py-0.5">
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="animate-spin-slow flex-shrink-0">
                            <circle cx="8" cy="8" r="6" stroke="var(--graphite)" strokeWidth="1.5" />
                            <path d="M8 2a6 6 0 0 1 6 6" stroke="var(--steel)" strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                          <span className="text-[11px]" style={{ color: "var(--steel)" }}>Thinking...</span>
                        </div>
                      )
                    ) : (
                      <>
                        {msg.reasoning && (
                          <ReasoningBlock
                            reasoning={msg.reasoning}
                            durationSec={msg.thinkingStartedAt
                              ? Math.round((msg.timestamp - msg.thinkingStartedAt) / 1000)
                              : undefined}
                          />
                        )}
                        <MarkdownMessage content={msg.content} />
                      </>
                    )
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                  {!msg.streaming && (
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
