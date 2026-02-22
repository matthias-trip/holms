import { useState, useRef, useEffect, useCallback } from "react";
import { Loader2, ChevronRight, AlertCircle, SendHorizonal, Lightbulb, Cloud, Moon, Activity, Sparkles, ThumbsUp, ThumbsDown } from "lucide-react";
import { Button, Chip } from "@heroui/react";
import { trpc } from "../trpc";
import type { ChatMessage, ChatMessageFeedback, ApprovalMessageData } from "@holms/shared";
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
      <div className="flex items-center gap-1 mb-1">
        <Loader2 size={12} className="animate-spin-slow flex-shrink-0" style={{ color: "var(--gray-9)" }} />
        <span className="text-xs font-medium" style={{ color: "var(--gray-9)" }}>
          Thinking{elapsed > 0 ? ` (${elapsed}s)` : ""}...
        </span>
      </div>
      <div
        ref={scrollRef}
        className="pl-4 text-[11px] overflow-auto whitespace-pre-wrap"
        style={{
          color: "var(--gray-11)",
          maxHeight: "200px",
          lineHeight: 1.6,
          borderLeft: "2px solid var(--gray-a5)",
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
        <ChevronRight
          size={10}
          className="flex-shrink-0 transition-transform duration-150"
          style={{
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            color: "var(--gray-8)",
          }}
        />
        <span className="text-xs font-medium" style={{ color: "var(--gray-9)" }}>{label}</span>
      </button>
      <div
        className="overflow-hidden transition-all duration-200 ease-in-out"
        style={{ maxHeight: expanded ? "400px" : "0px", opacity: expanded ? 1 : 0 }}
      >
        <div
          className="mt-1.5 pl-4 text-[11px] overflow-auto"
          style={{
            color: "var(--gray-11)",
            maxHeight: "380px",
            lineHeight: 1.6,
            borderLeft: "2px solid var(--gray-a5)",
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
          background: "var(--gray-3)",
          border: "1px solid var(--gray-a5)",
          fontSize: "13px",
          lineHeight: "1.6",
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <AlertCircle size={14} style={{ color: "var(--warn)" }} className="flex-shrink-0" />
          <span className="text-sm font-medium" style={{ color: "var(--gray-12)" }}>
            {data.message ? "Approval" : "Requesting approval"}
          </span>
        </div>

        <p className="text-sm mb-2" style={{ lineHeight: "1.6", color: "var(--gray-12)" }}>
          {data.message ?? data.reason}
        </p>

        <div
          className="rounded-lg px-3 py-2 mb-2.5"
          style={{
            fontSize: "12px",
            fontWeight: 500,
            fontFamily: "var(--font-mono)",
            background: "var(--gray-a3)",
            border: "1px solid var(--gray-a5)",
            color: "var(--gray-12)",
          }}
        >
          {formatApprovalAction(data.command, data.params, data.deviceId)}
        </div>

        {data.resolved ? (
          <Chip
            variant="flat"
            color={data.resolved.approved ? "success" : "danger"}
            size="md"
          >
            {data.resolved.approved
              ? (data.approveLabel ?? "Approved")
              : (data.rejectLabel ?? "Rejected")}
          </Chip>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="flat"
              color="success"
              size="sm"
              onPress={onApprove}
              isDisabled={isLoading}
            >
              {data.approveLabel ?? "Approve"}
            </Button>
            <Button
              variant="flat"
              color="danger"
              size="sm"
              onPress={onReject}
              isDisabled={isLoading}
            >
              {data.rejectLabel ?? "Reject"}
            </Button>
          </div>
        )}

        <p
          className="text-xs mt-1"
          style={{ fontFamily: "var(--font-mono)", opacity: 0.4, color: "var(--gray-12)" }}
        >
          {new Date(timestamp).toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
}

const SUGGESTED_PROMPTS = [
  { label: "Turn on all lights", icon: Lightbulb },
  { label: "What's the weather like?", icon: Cloud },
  { label: "Set a bedtime routine", icon: Moon },
  { label: "Show device status", icon: Activity },
];

function MessageFeedback({
  messageId,
  feedback,
  onFeedbackUpdate,
}: {
  messageId: string;
  feedback?: ChatMessageFeedback;
  onFeedbackUpdate: (messageId: string, feedback: ChatMessageFeedback) => void;
}) {
  const [mode, setMode] = useState<"positive" | "negative" | null>(null);
  const [comment, setComment] = useState("");

  const mutation = trpc.chat.messageFeedback.useMutation({
    onSuccess: () => {
      onFeedbackUpdate(messageId, {
        sentiment: mode!,
        comment: comment.trim() || undefined,
      });
      setMode(null);
      setComment("");
    },
  });

  const submit = () => {
    if (!mode) return;
    mutation.mutate({
      messageId,
      sentiment: mode,
      comment: comment.trim() || undefined,
    });
  };

  if (feedback) {
    return (
      <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--gray-a3)" }}>
        <div className="flex items-center gap-2">
          {feedback.sentiment === "positive"
            ? <ThumbsUp size={11} style={{ color: "var(--ok)" }} />
            : <ThumbsDown size={11} style={{ color: "var(--warm)" }} />}
          <span className="text-[11px]" style={{ color: "var(--gray-9)" }}>
            {feedback.sentiment === "positive" ? "Helpful" : "Not helpful"}
          </span>
          {feedback.comment && (
            <span className="text-[11px]" style={{ color: "var(--gray-8)" }}>
              &mdash; {feedback.comment}
            </span>
          )}
        </div>
        {feedback.response ? (
          <details className="mt-1.5 group/reflection">
            <summary className="flex items-start gap-1.5 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
              <Sparkles size={10} className="flex-shrink-0 mt-0.5" style={{ color: "var(--accent-9)" }} />
              <span className="text-[11px] group-open/reflection:hidden" style={{ color: "var(--gray-10)", lineHeight: "1.5", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {feedback.response}
              </span>
              <ChevronRight size={10} className="chevron-rotate flex-shrink-0 mt-0.5 transition-transform duration-150 group-open/reflection:hidden" style={{ color: "var(--gray-8)" }} />
            </summary>
            <div className="text-[11px] -mt-[1px]" style={{ color: "var(--gray-10)", lineHeight: "1.5" }}>
              <MarkdownMessage content={feedback.response} />
            </div>
          </details>
        ) : (
          <div className="flex items-center gap-1.5 mt-1.5">
            <span
              className="w-[4px] h-[4px] rounded-full flex-shrink-0"
              style={{ background: "var(--gray-8)", animation: "pulse-dot 1.5s ease-in-out infinite" }}
            />
            <span className="text-[11px]" style={{ color: "var(--gray-8)" }}>Reflecting...</span>
          </div>
        )}
      </div>
    );
  }

  if (mode) {
    return (
      <div className="mt-2 pt-2 space-y-1.5" style={{ borderTop: "1px solid var(--gray-a3)" }}>
        <div className="flex items-center gap-2">
          {mode === "positive"
            ? <ThumbsUp size={11} style={{ color: "var(--ok)" }} />
            : <ThumbsDown size={11} style={{ color: "var(--warm)" }} />}
          <span className="text-[11px]" style={{ color: "var(--gray-10)" }}>
            {mode === "positive" ? "Helpful" : "Not helpful"}
          </span>
        </div>
        <input
          type="text"
          placeholder="Add a comment (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          className="w-full text-[11px] px-2 py-1 rounded-md outline-none"
          style={{
            background: "var(--gray-2)",
            border: "1px solid var(--gray-a4)",
            color: "var(--gray-12)",
          }}
          autoFocus
        />
        <div className="flex items-center gap-2">
          <button
            onClick={submit}
            disabled={mutation.isPending}
            className="text-[11px] px-2 py-0.5 rounded-md font-medium transition-colors"
            style={{
              background: "var(--accent-9)",
              color: "white",
              opacity: mutation.isPending ? 0.5 : 1,
            }}
          >
            {mutation.isPending ? "Sending..." : "Submit"}
          </button>
          <button
            onClick={() => { setMode(null); setComment(""); }}
            className="text-[11px] px-2 py-0.5 rounded-md transition-colors"
            style={{ color: "var(--gray-9)" }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 pt-2 flex items-center gap-2 feedback-buttons" style={{ borderTop: "1px solid var(--gray-a3)" }}>
      <button
        onClick={() => setMode("positive")}
        className="p-1 rounded-md transition-colors hover:bg-[var(--gray-a3)]"
        style={{ color: "var(--gray-7)" }}
        title="Helpful"
      >
        <ThumbsUp size={11} />
      </button>
      <button
        onClick={() => setMode("negative")}
        className="p-1 rounded-md transition-colors hover:bg-[var(--gray-a3)]"
        style={{ color: "var(--gray-7)" }}
        title="Not helpful"
      >
        <ThumbsDown size={11} />
      </button>
    </div>
  );
}

export default function ChatPanel() {
  const [messages, setMessages] = useState<StreamingMessage[]>([]);
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const historyLoadedRef = useRef(false);
  const liveMessageIdsRef = useRef<Set<string>>(new Set());
  const streamEndReceivedRef = useRef(false);
  const pendingApprovalActionRef = useRef<{ approvalId: string; approved: boolean } | null>(null);

  const utils = trpc.useUtils();
  const historyQuery = trpc.chat.history.useQuery({ limit: 100, channel: "web:default" });

  const approveMutation = trpc.approval.approve.useMutation({
    onSuccess: (data) => {
      utils.approval.pending.invalidate();
      const action = pendingApprovalActionRef.current;
      pendingApprovalActionRef.current = null;
      if (!action) return;

      setMessages((prev) =>
        prev.map((m) => {
          if (m.status !== "approval_pending" && m.status !== "approval_resolved") return m;
          const parsed = parseApprovalData(m.content);
          if (!parsed || parsed.approvalId !== action.approvalId) return m;
          const updated = { ...parsed, resolved: { approved: true } };
          return { ...m, content: JSON.stringify(updated), status: "approval_resolved" as const };
        }),
      );

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

      setMessages((prev) =>
        prev.map((m) => {
          if (m.status !== "approval_pending" && m.status !== "approval_resolved") return m;
          const parsed = parseApprovalData(m.content);
          if (!parsed || parsed.approvalId !== action.approvalId) return m;
          const updated = { ...parsed, resolved: { approved: false } };
          return { ...m, content: JSON.stringify(updated), status: "approval_resolved" as const };
        }),
      );

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
      const loaded = historyQuery.data.map((m): StreamingMessage => {
        if (m.status === "thinking") {
          return { ...m, streaming: true };
        }
        return m;
      });
      setMessages(loaded);

      const thinkingMsg = loaded.find((m) => m.streaming);
      if (thinkingMsg) {
        streamPlaceholderIdRef.current = thinkingMsg.id;
      }

      if (!historyLoadedRef.current) {
        historyLoadedRef.current = true;
        requestAnimationFrame(() => {
          scrollRef.current?.scrollTo({ top: scrollRef.current!.scrollHeight });
        });
      }
    }
  }, [historyQuery.data]);

  const streamPlaceholderIdRef = useRef<string | null>(null);

  trpc.chat.onChatStream.useSubscription(undefined, {
    onData: (event) => {
      if (event.type === "token") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.messageId
              ? { ...m, reasoning: (m.reasoning ?? "") + event.token }
              : m,
          ),
        );
      } else if (event.type === "end") {
        streamEndReceivedRef.current = true;
        setMessages((prev) => {
          const hasMatch = prev.some((m) => m.id === event.messageId);
          if (hasMatch) {
            return prev.map((m) =>
              m.id === event.messageId
                ? { ...m, content: event.content, streaming: false, reasoning: event.reasoning, thinkingStartedAt: m.thinkingStartedAt }
                : m,
            );
          }
          return prev;
        });
      }
    },
  });

  // Subscribe to feedback responses from the agent
  trpc.chat.onMessageFeedbackResponse.useSubscription(undefined, {
    onData: (data) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.messageId
            ? { ...m, feedback: { ...m.feedback!, response: data.response } }
            : m,
        ),
      );
    },
  });

  const handleFeedbackUpdate = useCallback((messageId: string, feedback: ChatMessageFeedback) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? { ...m, feedback }
          : m,
      ),
    );
  }, []);

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
          message: proposal.message,
          approveLabel: proposal.approveLabel,
          rejectLabel: proposal.rejectLabel,
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

      // Map client placeholder to server thinking ID — streaming events will target this ID
      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderId
            ? { ...m, id: data.assistantMsg.id }
            : m,
        ),
      );
      utils.chat.suggestions.reset();
    },
    onError: () => {
      streamEndReceivedRef.current = false;
      streamPlaceholderIdRef.current = null;
      setMessages((prev) => prev.filter((m) => !m.streaming));
    },
  });

  const isProcessing = messages.some((m) => m.streaming);

  useEffect(() => {
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

  const handleSendText = (text: string) => {
    if (!text.trim() || sendMutation.isPending) return;

    const userMsg: StreamingMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text.trim(),
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
    sendMutation.mutate({ message: text.trim() });
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

  // Dynamic suggestions via Haiku
  const suggestionsQuery = trpc.chat.suggestions.useQuery(
    { limit: 3 },
    { enabled: messages.length > 0 && !isProcessing, staleTime: Infinity },
  );
  const suggestions = suggestionsQuery.data?.suggestions ?? [];

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--gray-2)" }}>
      {/* Header */}
      <div
        className="flex justify-between items-center flex-shrink-0 px-6 py-4"
        style={{ borderBottom: "1px solid var(--gray-a3)" }}
      >
        <div>
          <h3 className="text-base font-medium" style={{ color: "var(--gray-12)" }}>Assistant</h3>
          <p className="text-xs mt-1" style={{ color: "var(--gray-9)" }}>
            {isProcessing ? (
              <span className="inline-flex items-center gap-1">
                thinking
                <span className="inline-flex gap-[3px]">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="inline-block w-[3px] h-[3px] rounded-full"
                      style={{
                        background: "var(--gray-9)",
                        animation: "thinking-dot 1.4s ease-in-out infinite",
                        animationDelay: `${i * 0.2}s`,
                      }}
                    />
                  ))}
                </span>
              </span>
            ) : "ready"}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-6 py-4">
        <div className="mx-auto w-full max-w-3xl">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center" style={{ paddingTop: "15vh" }}>
            <div
              className="relative mb-4 animate-fade-in"
            >
              <div
                className="absolute inset-0 rounded-2xl animate-pulse"
                style={{
                  background: "var(--accent-9)",
                  opacity: 0.15,
                  filter: "blur(16px)",
                  transform: "scale(1.5)",
                }}
              />
              <img
                src="/chaticon.png"
                alt="Holms"
                className="relative w-14 h-14 rounded-2xl"
                style={{ boxShadow: "0 0 32px rgba(14, 165, 233, 0.2)" }}
              />
            </div>
            <h2 className="text-lg font-semibold mb-1 animate-fade-in" style={{ color: "var(--gray-12)", animationDelay: "80ms" }}>
              How can I help?
            </h2>
            <p className="text-sm mb-6 animate-fade-in" style={{ color: "var(--gray-9)", maxWidth: "280px", animationDelay: "140ms" }}>
              Control devices, set routines, or just ask me anything about your home.
            </p>
            <div className="grid grid-cols-2 gap-2" style={{ maxWidth: "360px", width: "100%" }}>
              {SUGGESTED_PROMPTS.map((prompt, i) => {
                const Icon = prompt.icon;
                return (
                  <button
                    key={prompt.label}
                    onClick={() => handleSendText(prompt.label)}
                    className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-left transition-all duration-150 animate-fade-in"
                    style={{
                      background: "var(--gray-3)",
                      border: "1px solid var(--gray-a5)",
                      color: "var(--gray-11)",
                      fontSize: "12.5px",
                      animationDelay: `${200 + i * 60}ms`,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--accent-a3)";
                      e.currentTarget.style.borderColor = "var(--accent-a5)";
                      e.currentTarget.style.color = "var(--gray-12)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "var(--gray-3)";
                      e.currentTarget.style.borderColor = "var(--gray-a5)";
                      e.currentTarget.style.color = "var(--gray-11)";
                    }}
                  >
                    <Icon size={14} strokeWidth={1.5} style={{ color: "var(--accent-9)", flexShrink: 0 }} />
                    {prompt.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, i) => {
              const isApproval = msg.status === "approval_pending" || msg.status === "approval_resolved";
              // Determine if this assistant message is eligible for feedback
              const showFeedback = !isApproval && msg.role === "assistant" && !msg.streaming && msg.content && (() => {
                // Collect last 10 eligible assistant message IDs
                const eligible = messages
                  .filter((m) => m.role === "assistant" && !m.streaming && m.content
                    && m.status !== "approval_pending" && m.status !== "approval_resolved")
                  .slice(-10);
                return eligible.some((m) => m.id === msg.id);
              })();
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

              const isLive = liveMessageIdsRef.current.has(msg.id);
              return (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-fade-in`}
                style={!isLive ? { animationDelay: `${Math.min(i * 40, 400)}ms` } : undefined}
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
                    background: msg.role === "user" ? "var(--accent-9)" : "var(--gray-3)",
                    border: msg.role === "user" ? "none" : "1px solid var(--gray-a5)",
                    color: msg.role === "user" ? "white" : "var(--gray-12)",
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
                          <Loader2 size={12} className="animate-spin-slow flex-shrink-0" style={{ color: "var(--gray-9)" }} />
                          <span className="text-xs" style={{ color: "var(--gray-9)" }}>Thinking...</span>
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
                      className="text-xs mt-1"
                      style={{ fontFamily: "var(--font-mono)", opacity: 0.4 }}
                    >
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </p>
                  )}
                  {showFeedback && (
                    <MessageFeedback
                      messageId={msg.id}
                      feedback={msg.feedback}
                      onFeedbackUpdate={handleFeedbackUpdate}
                    />
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
        </div>
      </div>

      {/* Dynamic suggestions */}
      {messages.length > 0 && !isProcessing && !input.trim() && (suggestions.length > 0 || suggestionsQuery.isFetching || suggestionsQuery.isLoading) && (
        <div
          className="flex gap-2 px-6 pt-2 max-w-3xl mx-auto"
          style={{ borderTop: "1px solid var(--gray-a3)" }}
        >
          {suggestions.length > 0 ? suggestions.map((text, i) => (
            <button
              key={text}
              onClick={() => handleSendText(text)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-all duration-150 animate-suggestion-in"
              style={{
                animationDelay: `${i * 60}ms`,
                background: "var(--gray-3)",
                border: "1px solid var(--gray-a5)",
                color: "var(--gray-9)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--accent-a3)";
                e.currentTarget.style.borderColor = "var(--accent-a5)";
                e.currentTarget.style.color = "var(--gray-12)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--gray-3)";
                e.currentTarget.style.borderColor = "var(--gray-a5)";
                e.currentTarget.style.color = "var(--gray-9)";
              }}
            >
              <Sparkles size={10} strokeWidth={2} style={{ color: "var(--accent-9)", flexShrink: 0 }} />
              {text}
            </button>
          )) : [0, 1, 2].map((i) => (
            <div
              key={`skel-${i}`}
              className="relative rounded-full overflow-hidden"
              style={{
                width: `${100 + i * 20}px`,
                height: "28px",
                background: "var(--gray-3)",
                border: "1px solid var(--gray-a5)",
              }}
            >
              <div
                className="absolute inset-0 animate-skeleton-shimmer"
                style={{
                  background: "linear-gradient(90deg, transparent 0%, var(--gray-a3) 50%, transparent 100%)",
                  backgroundSize: "200% 100%",
                }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex-shrink-0 px-6 py-4 max-w-3xl mx-auto w-full">
        <div
          className="flex items-end gap-2 rounded-2xl px-4 py-2"
          style={{
            background: "var(--gray-3)",
            border: "1px solid var(--gray-a5)",
            boxShadow: "inset 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)",
          }}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Message your home..."
            disabled={sendMutation.isPending}
            className="flex-1 bg-transparent outline-none text-sm"
            style={{
              color: "var(--gray-12)",
              caretColor: "var(--accent-9)",
              resize: "none",
              maxHeight: "150px",
              overflowY: "auto",
              lineHeight: "32px",
            }}
          />
          <button
            onClick={handleSend}
            disabled={sendMutation.isPending || !input.trim()}
            className="flex items-center justify-center w-8 h-8 rounded-full transition-all duration-150 flex-shrink-0"
            style={{
              background: input.trim() ? "var(--accent-9)" : "var(--gray-a3)",
              color: input.trim() ? "white" : "var(--gray-8)",
              cursor: input.trim() ? "pointer" : "default",
            }}
          >
            <SendHorizonal size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
