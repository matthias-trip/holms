import { useState, useRef, useEffect, useCallback } from "react";
import { Loader2, ChevronRight, AlertCircle, SendHorizonal, Lightbulb, Cloud, Moon, Activity, Sparkles, ThumbsUp, ThumbsDown } from "lucide-react";
import { Button, Chip } from "@heroui/react";
import { trpc } from "../trpc";
import type { ChatMessage, ChatMessageFeedback, ApprovalMessageData, QuestionMessageData } from "@holms/shared";
import MarkdownMessage from "./MarkdownMessage";
import { LiveReasoningBlock, ReasoningBlock } from "./ReasoningBlocks";
import FeedbackModal from "./FeedbackModal";
import QuestionCard from "./QuestionCard";

interface StreamingMessage extends ChatMessage {
  streaming?: boolean;
  reasoning?: string;
  thinkingStartedAt?: number;
  statusHint?: string;
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

function parseQuestionData(content: string): QuestionMessageData | null {
  try {
    const data = JSON.parse(content);
    if (data && typeof data.questionId === "string" && Array.isArray(data.options)) return data as QuestionMessageData;
  } catch { /* not JSON */ }
  return null;
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
        className="max-w-[85%] rounded-xl px-4 py-2.5"
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


/** Expandable reflection text — click truncated text to show full version */
function FeedbackReflection({ response }: { response: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-start gap-1.5 text-left w-full"
      >
        <Sparkles size={10} className="flex-shrink-0 mt-0.5" style={{ color: "var(--accent-9)" }} />
        <span
          className="text-[11px] flex-1"
          style={{
            color: "var(--gray-10)",
            lineHeight: "1.5",
            ...(!expanded ? {
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical" as const,
              overflow: "hidden",
            } : {}),
          }}
        >
          {response}
        </span>
        <ChevronRight
          size={10}
          className="flex-shrink-0 mt-0.5 transition-transform duration-150"
          style={{
            color: "var(--gray-8)",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
          }}
        />
      </button>
    </div>
  );
}

/** Feedback display shown below the message when feedback has been submitted */
function MessageFeedbackDisplay({
  messageId,
  feedback,
  onFeedbackUpdate,
}: {
  messageId: string;
  feedback: ChatMessageFeedback;
  onFeedbackUpdate: (messageId: string, feedback: ChatMessageFeedback) => void;
}) {
  return (
    <div className="mt-1.5 pt-1.5" style={{ borderTop: "1px solid var(--gray-a3)" }}>
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
        <FeedbackReflection response={feedback.response} />
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

  const [feedbackModal, setFeedbackModal] = useState<{ messageId: string; sentiment: "positive" | "negative" } | null>(null);

  const feedbackMutation = trpc.chat.messageFeedback.useMutation();
  const submitSecretMutation = trpc.chat.submitSecret.useMutation();

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
      } else if (event.type === "status") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.messageId
              ? { ...m, statusHint: event.status }
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
                ? { ...m, content: event.content, streaming: false, reasoning: event.reasoning, statusHint: undefined, thinkingStartedAt: m.thinkingStartedAt }
                : m,
            );
          }
          // New message not yet in the list (e.g., question from ask_user tool)
          const questionData = parseQuestionData(event.content);
          if (questionData) {
            const newMsg: StreamingMessage = {
              id: event.messageId,
              role: "assistant",
              content: event.content,
              timestamp: Date.now(),
              status: "question_pending",
            };
            liveMessageIdsRef.current.add(newMsg.id);
            return [...prev, newMsg];
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

  const handleFeedbackSubmit = useCallback((comment?: string) => {
    if (!feedbackModal) return;
    const { messageId, sentiment } = feedbackModal;
    feedbackMutation.mutate(
      { messageId, sentiment, comment },
      {
        onSuccess: () => {
          handleFeedbackUpdate(messageId, { sentiment, comment });
          setFeedbackModal(null);
        },
      },
    );
  }, [feedbackModal, feedbackMutation, handleFeedbackUpdate]);

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

  const handleSendSecret = async (questionId: string, value: string) => {
    await submitSecretMutation.mutateAsync({ questionId, value });
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
    { enabled: historyQuery.isSuccess && messages.length > 0 && !isProcessing, staleTime: Infinity },
  );
  const suggestions = suggestionsQuery.data?.suggestions ?? [];

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--gray-2)" }}>
      {/* Header */}
      <div
        className="flex justify-between items-center flex-shrink-0 px-6 h-14"
        style={{ borderBottom: "1px solid var(--gray-a3)", background: "var(--gray-1)" }}
      >
        <h3 className="text-base font-bold" style={{ color: "var(--gray-12)" }}>Chat</h3>
        <span className="text-xs" style={{ color: "var(--gray-9)" }}>
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
        </span>
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
              const isQuestion = msg.status === "question_pending" || msg.status === "question_answered";
              // Determine if this assistant message is eligible for feedback
              const showFeedback = !isApproval && !isQuestion && msg.role === "assistant" && !msg.streaming && msg.content && (() => {
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

              if (isQuestion) {
                const questionData = parseQuestionData(msg.content);
                if (questionData) {
                  const nextMsg = messages[i + 1];
                  const isAnswered = !!nextMsg && nextMsg.role === "user";
                  return (
                    <div key={msg.id} className="space-y-3">
                      {msg.reasoning && (
                        <div className="flex justify-start">
                          <img src="/chaticon.png" alt="Holms" className="w-8 h-8 rounded-lg mr-2 mt-0.5 flex-shrink-0" />
                          <div
                            className="max-w-[85%] rounded-xl px-4 py-2.5"
                            style={{ background: "var(--gray-3)", border: "1px solid var(--gray-a5)", color: "var(--gray-12)", fontSize: "13px", lineHeight: "1.6" }}
                          >
                            <MarkdownMessage content={msg.reasoning} />
                          </div>
                        </div>
                      )}
                      <QuestionCard
                        data={questionData}
                        onSend={handleSendText}
                        onSendSecret={handleSendSecret}
                        answered={isAnswered}
                      />
                    </div>
                  );
                }
              }

              // Skip empty finalized assistant messages (ask_user placeholder with no reasoning)
              if (msg.role === "assistant" && !msg.streaming && !msg.content && !msg.reasoning && !isApproval && !isQuestion) {
                return null;
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
                  className={`${msg.role === "user" ? "max-w-[65%]" : "max-w-[85%]"} rounded-xl px-4 py-2.5`}
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
                          statusHint={msg.statusHint}
                        />
                      ) : (
                        <div className="flex items-center gap-2 py-0.5">
                          <Loader2 size={12} className="animate-spin-slow flex-shrink-0" style={{ color: "var(--gray-9)" }} />
                          <span className="text-xs" style={{ color: "var(--gray-9)" }}>{msg.statusHint ?? "Thinking..."}</span>
                        </div>
                      )
                    ) : (
                      <>
                        {msg.reasoning && msg.content && (
                          <ReasoningBlock
                            reasoning={msg.reasoning}
                            durationSec={msg.thinkingStartedAt
                              ? Math.round((msg.timestamp - msg.thinkingStartedAt) / 1000)
                              : undefined}
                          />
                        )}
                        {msg.content ? (
                          <MarkdownMessage content={msg.content} />
                        ) : msg.reasoning ? (
                          <MarkdownMessage content={msg.reasoning} />
                        ) : null}
                      </>
                    )
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                  {!msg.streaming && (
                    <div className="flex items-center justify-between mt-1">
                      <p
                        className="text-xs"
                        style={{ fontFamily: "var(--font-mono)", opacity: 0.4 }}
                      >
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </p>
                      {showFeedback && !msg.feedback && (
                        <div className="flex items-center gap-0.5 feedback-buttons">
                          <button
                            onClick={() => setFeedbackModal({ messageId: msg.id, sentiment: "positive" })}
                            className="p-0.5 rounded transition-colors hover:bg-[var(--gray-a3)]"
                            style={{ color: "var(--gray-7)" }}
                            title="Helpful"
                          >
                            <ThumbsUp size={11} />
                          </button>
                          <button
                            onClick={() => setFeedbackModal({ messageId: msg.id, sentiment: "negative" })}
                            className="p-0.5 rounded transition-colors hover:bg-[var(--gray-a3)]"
                            style={{ color: "var(--gray-7)" }}
                            title="Not helpful"
                          >
                            <ThumbsDown size={11} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {showFeedback && msg.feedback && (
                    <MessageFeedbackDisplay
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

      {feedbackModal && (
        <FeedbackModal
          isOpen
          sentiment={feedbackModal.sentiment}
          onSubmit={handleFeedbackSubmit}
          onClose={() => setFeedbackModal(null)}
          isPending={feedbackMutation.isPending}
        />
      )}
    </div>
  );
}
