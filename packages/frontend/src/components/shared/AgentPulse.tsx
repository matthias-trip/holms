import { trpc } from "../../trpc";
import { useState, useEffect } from "react";

type AgentState = "idle" | "thinking" | "acting";

export default function AgentPulse() {
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [statusText, setStatusText] = useState("Watching over your home");

  trpc.chat.onActivity.useSubscription(undefined, {
    onData: (activity) => {
      const data = activity.data as Record<string, unknown>;
      if (activity.type === "turn_start") {
        const trigger = data.trigger as string | undefined;
        if (trigger === "chat") {
          setAgentState("thinking");
          setStatusText("Thinking...");
        } else if (trigger === "proactive_reflection") {
          setAgentState("thinking");
          setStatusText("Reflecting...");
        } else if (trigger === "proactive_situational") {
          setAgentState("thinking");
          setStatusText("Checking on things...");
        } else if (trigger === "proactive_goal_review") {
          setAgentState("thinking");
          setStatusText("Reviewing goals...");
        } else if (trigger === "proactive_daily_summary") {
          setAgentState("thinking");
          setStatusText("Writing daily summary...");
        } else {
          setAgentState("acting");
          setStatusText("Processing...");
        }
      } else if (activity.type === "tool_use") {
        setAgentState("acting");
        const tool = String(data.tool ?? "");
        if (tool.includes("device") || tool.includes("influence")) {
          setStatusText("Adjusting devices...");
        } else if (tool.includes("memory")) {
          setStatusText("Checking memories...");
        } else {
          setStatusText("Working...");
        }
      } else if (activity.type === "result") {
        setAgentState("idle");
        setStatusText("All quiet");
        // Rotate idle phrases
        setTimeout(() => {
          setStatusText("Watching over your home");
        }, 5000);
      }
    },
  });

  // Fade back to idle if no activity for 30s
  useEffect(() => {
    if (agentState === "idle") return;
    const t = setTimeout(() => {
      setAgentState("idle");
      setStatusText("All quiet");
    }, 30000);
    return () => clearTimeout(t);
  }, [agentState]);

  return (
    <div className="flex items-center gap-2.5 px-4 pt-5 pb-5">
      {/* Logo with breathing glow */}
      <div className="relative">
        <img
          src="/logo.png"
          alt="Holms"
          className="w-7 h-7 rounded-lg relative"
          style={{ zIndex: 1 }}
        />
        {agentState !== "idle" && (
          <div
            className="absolute inset-0 rounded-lg animate-agent-breathe"
            style={{
              animationDuration: agentState === "acting" ? "1.5s" : "3s",
            }}
          />
        )}
      </div>

      {/* Name + status */}
      <div className="flex flex-col min-w-0">
        <span
          className="text-base font-semibold leading-tight"
          style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.01em", color: "var(--gray-12)" }}
        >
          holms
        </span>
        <span
          className="text-[10px] truncate leading-tight mt-0.5"
          style={{
            color: agentState === "idle" ? "var(--gray-8)" : "var(--accent-9)",
            transition: "color 0.3s ease",
          }}
        >
          {statusText}
        </span>
      </div>
    </div>
  );
}
