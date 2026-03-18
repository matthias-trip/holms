import { useState, useEffect } from "react";
import { trpc } from "../../trpc";

type AgentState = "idle" | "thinking" | "acting";

const IDLE_PHRASES = [
  "All quiet",
  "Watching over your home",
  "Standing by",
];

export default function AgentStatusBar() {
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [statusText, setStatusText] = useState(IDLE_PHRASES[0]);
  const [lastAction, setLastAction] = useState<number | null>(null);

  trpc.chat.onActivity.useSubscription(undefined, {
    onData: (activity) => {
      const data = activity.data as Record<string, unknown>;
      if (activity.type === "turn_start") {
        const trigger = data.trigger as string | undefined;
        setAgentState("thinking");
        if (trigger === "proactive_reflection") setStatusText("Reflecting...");
        else if (trigger === "proactive_situational") setStatusText("Checking on things...");
        else if (trigger === "proactive_goal_review") setStatusText("Reviewing goals...");
        else if (trigger === "proactive_daily_summary") setStatusText("Writing daily summary...");
        else if (trigger === "chat") setStatusText("Thinking...");
        else setStatusText("Processing event...");
      } else if (activity.type === "tool_use") {
        setAgentState("acting");
      } else if (activity.type === "result") {
        setAgentState("idle");
        setLastAction(Date.now());
        setStatusText(IDLE_PHRASES[Math.floor(Math.random() * IDLE_PHRASES.length)]);
      }
    },
  });

  useEffect(() => {
    if (agentState === "idle") return;
    const t = setTimeout(() => {
      setAgentState("idle");
      setStatusText(IDLE_PHRASES[0]);
    }, 30000);
    return () => clearTimeout(t);
  }, [agentState]);

  const lastActionStr = lastAction
    ? new Date(lastAction).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div
      className="flex items-center gap-4 px-6 py-3.5 flex-shrink-0"
      style={{
        background: agentState !== "idle"
          ? `linear-gradient(135deg, var(--surface-warm), var(--gray-1))`
          : "var(--gray-1)",
        borderBottom: "1px solid var(--gray-a3)",
        transition: "background 0.5s ease",
      }}
    >
      {/* Agent indicator */}
      <div className="relative flex-shrink-0">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{
            background: "var(--accent-a3)",
            border: "1px solid var(--accent-a5)",
          }}
        >
          <img src="/logo.png" alt="" className="w-5 h-5 rounded" />
        </div>
        {agentState !== "idle" && (
          <div
            className="absolute inset-0 rounded-full animate-agent-breathe"
            style={{ animationDuration: agentState === "acting" ? "1.5s" : "3s" }}
          />
        )}
      </div>

      {/* Status text */}
      <span
        className="text-sm font-medium flex-1"
        style={{
          fontFamily: "var(--font-display)",
          color: agentState === "idle" ? "var(--gray-9)" : "var(--gray-12)",
          transition: "color 0.3s ease",
        }}
      >
        {statusText}
      </span>

      {/* Last action */}
      {lastActionStr && (
        <span
          className="text-[11px] tabular-nums flex-shrink-0"
          style={{ fontFamily: "var(--font-mono)", color: "var(--gray-8)" }}
        >
          Last active {lastActionStr}
        </span>
      )}
    </div>
  );
}
