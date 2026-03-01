import { useState, useEffect } from "react";
import { Loader2, ChevronRight } from "lucide-react";
import MarkdownMessage from "./MarkdownMessage";

/** Live reasoning — renders as normal markdown bubble with subtle spinner footer */
export function LiveReasoningBlock({ reasoning, startedAt, statusHint }: { reasoning: string; startedAt: number; statusHint?: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const label = statusHint
    ? `${statusHint}${elapsed > 0 ? ` (${elapsed}s)` : ""}`
    : `Thinking${elapsed > 0 ? ` (${elapsed}s)` : ""}...`;

  return (
    <div>
      <MarkdownMessage content={reasoning} />
      <div className="flex items-center gap-1.5 mt-1.5">
        <Loader2 size={10} className="animate-spin-slow flex-shrink-0" style={{ color: "var(--gray-8)" }} />
        <span className="text-[11px]" style={{ color: "var(--gray-8)" }}>{label}</span>
      </div>
    </div>
  );
}

/** Collapsed reasoning toggle — shows "Thought for Xs", click to expand full markdown */
export function ReasoningBlock({ reasoning, durationSec }: { reasoning: string; durationSec?: number }) {
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
        style={{ maxHeight: expanded ? "none" : "0px", opacity: expanded ? 1 : 0 }}
      >
        <div className="mt-1.5">
          <MarkdownMessage content={reasoning} />
        </div>
      </div>
    </div>
  );
}
