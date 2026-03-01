import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Loader2, SendHorizonal, X } from "lucide-react";
import { trpc } from "../trpc";
import type { ChatMessage, QuestionMessageData } from "@holms/shared";
import MarkdownMessage from "./MarkdownMessage";
import { LiveReasoningBlock, ReasoningBlock } from "./ReasoningBlocks";
import QuestionCard from "./QuestionCard";

interface SetupChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  adapterName: string;
  adapterType?: string;
  instanceId?: string;
}

interface StreamingMessage extends ChatMessage {
  streaming?: boolean;
  reasoning?: string;
  thinkingStartedAt?: number;
  statusHint?: string;
}

function parseQuestionData(content: string): QuestionMessageData | null {
  try {
    const data = JSON.parse(content);
    if (data && typeof data.questionId === "string" && Array.isArray(data.options)) return data as QuestionMessageData;
  } catch { /* not JSON */ }
  return null;
}

export default function SetupChatModal({ isOpen, onClose, adapterName, adapterType, instanceId }: SetupChatModalProps) {
  const [messages, setMessages] = useState<StreamingMessage[]>([]);
  const [input, setInput] = useState("");
  const [confirmingClose, setConfirmingClose] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamPlaceholderIdRef = useRef<string | null>(null);
  const sentInitialRef = useRef(false);

  const isTweak = !!instanceId;

  const handleRequestClose = useCallback(() => {
    if (messages.length > 0) {
      setConfirmingClose(true);
    } else {
      onClose();
    }
  }, [messages.length, onClose]);

  // Each time the modal opens, derive a fresh channel so the agent starts without prior context
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setupChannel = useMemo(() => {
    if (!isOpen) return "";
    return isTweak
      ? `web:tweak-${instanceId}-${Date.now()}`
      : `web:setup-${adapterName}-${Date.now()}`;
  }, [isOpen]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleRequestClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, handleRequestClose]);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Subscribe to streaming events
  trpc.chat.onChatStream.useSubscription(undefined, {
    enabled: isOpen,
    onData: (event) => {
      if (event.type === "token") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.messageId ? { ...m, reasoning: (m.reasoning ?? "") + event.token } : m,
          ),
        );
      } else if (event.type === "status") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.messageId ? { ...m, statusHint: event.status } : m,
          ),
        );
      } else if (event.type === "end") {
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
            return [...prev, {
              id: event.messageId,
              role: "assistant" as const,
              content: event.content,
              timestamp: Date.now(),
              status: "question_pending" as const,
            }];
          }
          return prev;
        });
      }
    },
  });

  const sendMutation = trpc.chat.send.useMutation({
    onSuccess: (data) => {
      const placeholderId = streamPlaceholderIdRef.current;
      streamPlaceholderIdRef.current = null;
      setMessages((prev) =>
        prev.map((m) => (m.id === placeholderId ? { ...m, id: data.assistantMsg.id } : m)),
      );
    },
    onError: () => {
      streamPlaceholderIdRef.current = null;
      setMessages((prev) => prev.filter((m) => !m.streaming));
    },
  });

  const sendMutationRef = useRef(sendMutation);
  sendMutationRef.current = sendMutation;

  const setupChannelRef = useRef(setupChannel);
  setupChannelRef.current = setupChannel;

  const isTweakRef = useRef(isTweak);
  isTweakRef.current = isTweak;
  const instanceIdRef = useRef(instanceId);
  instanceIdRef.current = instanceId;
  const adapterNameRef = useRef(adapterName);
  adapterNameRef.current = adapterName;
  const adapterTypeRef = useRef(adapterType);
  adapterTypeRef.current = adapterType;

  const sendText = useCallback(
    (text: string) => {
      if (!text.trim() || sendMutationRef.current.isPending) return;

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

      streamPlaceholderIdRef.current = placeholderId;
      setMessages((prev) => [...prev, userMsg, placeholder]);
      sendMutationRef.current.mutate({
        message: text.trim(),
        channel: setupChannelRef.current,
        flow: isTweakRef.current
          ? { kind: "tweak" as const, instanceId: instanceIdRef.current! }
          : { kind: "setup" as const, adapterType: adapterTypeRef.current ?? adapterNameRef.current },
      });
    },
    [],
  );

  // Auto-send initial message on open
  useEffect(() => {
    if (isOpen && adapterName && !sentInitialRef.current) {
      sentInitialRef.current = true;
      sendText(
        isTweak
          ? `Tweak my ${adapterName} adapter instance "${instanceId}".`
          : `Set up my ${adapterName} adapter`,
      );
    }
    if (!isOpen) {
      sentInitialRef.current = false;
      setMessages([]);
      setInput("");
      setConfirmingClose(false);
    }
  }, [isOpen, adapterName, isTweak, instanceId, sendText]);

  const handleSend = () => {
    if (!input.trim()) return;
    sendText(input.trim());
    setInput("");
  };

  const isProcessing = messages.some((m) => m.streaming);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0, 0, 0, 0.6)", backdropFilter: "blur(4px)" }}
      onClick={handleRequestClose}
    >
      <div
        className="flex flex-col rounded-2xl overflow-hidden animate-fade-in"
        style={{
          width: "min(600px, 90vw)",
          height: "min(70vh, 700px)",
          background: "var(--gray-2)",
          border: "1px solid var(--gray-a5)",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 h-12 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--gray-a3)", background: "var(--gray-1)" }}
        >
          <div className="flex items-center gap-2.5">
            <img src="/chaticon.png" alt="Holms" className="w-6 h-6 rounded-md" />
            <span className="text-sm font-semibold" style={{ color: "var(--gray-12)" }}>
              {isTweak ? "Tweak" : "Setup"} &middot; {adapterName}{isTweak ? ` (${instanceId})` : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isProcessing && (
              <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--gray-9)" }}>
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
            )}
            <button
              onClick={handleRequestClose}
              className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors hover:bg-[var(--gray-a3)]"
              style={{ color: "var(--gray-9)" }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Close confirmation bar */}
        {confirmingClose && (
          <div
            className="flex items-center justify-between px-5 py-2.5 flex-shrink-0"
            style={{ background: "var(--gray-3)", borderBottom: "1px solid var(--gray-a3)" }}
          >
            <span className="text-xs" style={{ color: "var(--gray-11)" }}>
              End this session? Progress will be lost.
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setConfirmingClose(false)}
                className="px-3 py-1 rounded-md text-xs font-medium transition-colors hover:bg-[var(--gray-a3)]"
                style={{ color: "var(--gray-11)" }}
              >
                Cancel
              </button>
              <button
                onClick={onClose}
                className="px-3 py-1 rounded-md text-xs font-medium transition-colors"
                style={{ background: "var(--err)", color: "white" }}
              >
                End session
              </button>
            </div>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-auto px-5 py-4">
          <div className="space-y-4">
            {messages.map((msg, i) => {
              const isQuestion = msg.status === "question_pending" || msg.status === "question_answered";
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
                        onSend={sendText}
                        answered={isAnswered}
                      />
                    </div>
                  );
                }
              }

              // Skip empty finalized assistant messages (ask_user placeholder with no reasoning)
              if (msg.role === "assistant" && !msg.streaming && !msg.content && !msg.reasoning && !isQuestion) {
                return null;
              }
              return (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "assistant" && (
                  <img
                    src="/chaticon.png"
                    alt="Holms"
                    className={`w-8 h-8 rounded-lg mr-2 mt-0.5 flex-shrink-0${msg.streaming ? " animate-breathe" : ""}`}
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
                  {!msg.streaming && msg.content && (
                    <p
                      className="text-xs mt-1"
                      style={{ fontFamily: "var(--font-mono)", opacity: 0.4 }}
                    >
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </p>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        </div>

        {/* Input */}
        <div className="flex-shrink-0 px-5 py-3" style={{ borderTop: "1px solid var(--gray-a3)" }}>
          <div
            className="flex items-end gap-2 rounded-xl px-3 py-2"
            style={{
              background: "var(--gray-3)",
              border: "1px solid var(--gray-a5)",
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
              placeholder="Follow up..."
              disabled={sendMutation.isPending}
              className="flex-1 bg-transparent outline-none text-sm"
              style={{
                color: "var(--gray-12)",
                caretColor: "var(--accent-9)",
                resize: "none",
                maxHeight: "100px",
                overflowY: "auto",
                lineHeight: "28px",
              }}
            />
            <button
              onClick={handleSend}
              disabled={sendMutation.isPending || !input.trim()}
              className="flex items-center justify-center w-7 h-7 rounded-full transition-all duration-150 flex-shrink-0"
              style={{
                background: input.trim() ? "var(--accent-9)" : "var(--gray-a3)",
                color: input.trim() ? "white" : "var(--gray-8)",
                cursor: input.trim() ? "pointer" : "default",
              }}
            >
              <SendHorizonal size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
