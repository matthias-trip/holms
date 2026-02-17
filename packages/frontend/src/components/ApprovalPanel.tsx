import { useState } from "react";
import { trpc } from "../trpc";
import type { PendingApproval } from "@holms/shared";

const CONFIDENCE_CONFIG: Record<string, { color: string; bg: string }> = {
  high: { color: "var(--ok)", bg: "var(--ok-dim)" },
  medium: { color: "var(--warn)", bg: "var(--warn-dim)" },
  low: { color: "var(--err)", bg: "var(--err-dim)" },
};

const CATEGORY_CONFIG: Record<string, { color: string; bg: string }> = {
  routine: { color: "var(--ok)", bg: "var(--ok-dim)" },
  novel: { color: "var(--warn)", bg: "var(--warn-dim)" },
  critical: { color: "var(--err)", bg: "var(--err-dim)" },
};

export default function ApprovalPanel() {
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});

  const { data: pending, refetch } = trpc.approval.pending.useQuery(undefined, {
    refetchInterval: 3000,
  });

  const approveMutation = trpc.approval.approve.useMutation({
    onSuccess: () => refetch(),
  });

  const rejectMutation = trpc.approval.reject.useMutation({
    onSuccess: () => refetch(),
  });

  trpc.approval.onProposal.useSubscription(undefined, {
    onData: () => refetch(),
  });

  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex items-center gap-3 mb-3">
        <span className="section-label">Approvals</span>
        {pending && pending.length > 0 && (
          <span
            className="badge"
            style={{ background: "var(--err-dim)", color: "var(--err)" }}
          >
            {pending.length} pending
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto space-y-2">
        {(!pending || pending.length === 0) ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect x="3" y="3" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
                <path d="M6.5 9l2 2 3.5-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="empty-state-text">
              No actions need approval. The coordinator will request permission for novel or critical operations.
            </div>
          </div>
        ) : (
          pending.map((item, i) => (
            <ApprovalCard
              key={item.id}
              item={item}
              index={i}
              rejectReason={rejectReasons[item.id] ?? ""}
              onRejectReasonChange={(reason) =>
                setRejectReasons((prev) => ({ ...prev, [item.id]: reason }))
              }
              onApprove={() => approveMutation.mutate({ id: item.id })}
              onReject={() => {
                rejectMutation.mutate({
                  id: item.id,
                  reason: rejectReasons[item.id] || undefined,
                });
                setRejectReasons((prev) => {
                  const next = { ...prev };
                  delete next[item.id];
                  return next;
                });
              }}
              isLoading={approveMutation.isPending || rejectMutation.isPending}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ApprovalCard({
  item,
  index,
  rejectReason,
  onRejectReasonChange,
  onApprove,
  onReject,
  isLoading,
}: {
  item: PendingApproval;
  index: number;
  rejectReason: string;
  onRejectReasonChange: (reason: string) => void;
  onApprove: () => void;
  onReject: () => void;
  isLoading: boolean;
}) {
  const catCfg = CATEGORY_CONFIG[item.category] ?? { color: "var(--steel)", bg: "var(--graphite)" };
  const confCfg = CONFIDENCE_CONFIG[item.confidence] ?? { color: "var(--steel)", bg: "var(--graphite)" };

  return (
    <div
      className="rounded-xl p-4 animate-fade-in"
      style={{
        background: "var(--obsidian)",
        border: `1px solid ${item.category === "critical" ? "rgba(248,113,113,0.2)" : "var(--graphite)"}`,
        animationDelay: `${index * 60}ms`,
      }}
    >
      {/* Category + confidence badges */}
      <div className="flex items-center gap-2 mb-3">
        <span className="badge" style={{ background: catCfg.bg, color: catCfg.color }}>
          {item.category}
        </span>
        <span className="badge" style={{ background: confCfg.bg, color: confCfg.color }}>
          {item.confidence}
        </span>
        <span
          className="text-[10px] ml-auto"
          style={{ fontFamily: "var(--font-mono)", color: "var(--pewter)" }}
        >
          {new Date(item.createdAt).toLocaleTimeString()}
        </span>
      </div>

      {/* Action detail */}
      <div
        className="rounded-lg p-3 mb-3"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          background: "var(--abyss)",
          border: "1px solid var(--graphite)",
        }}
      >
        <div style={{ color: "var(--mist)" }}>
          <span style={{ color: "var(--glow-bright)" }}>{item.command}</span>
          <span style={{ color: "var(--pewter)" }}>(</span>
          <span style={{ color: "var(--warn)" }}>{JSON.stringify(item.params)}</span>
          <span style={{ color: "var(--pewter)" }}>)</span>
          <span style={{ color: "var(--pewter)" }}> → </span>
          <span style={{ color: "var(--info)" }}>{item.deviceId}</span>
        </div>
      </div>

      {/* Reason */}
      <p className="text-[12px] mb-3" style={{ color: "var(--silver)", lineHeight: "1.5" }}>
        {item.reason}
      </p>

      {/* Actions */}
      <div className="flex gap-2 items-center">
        <button
          onClick={onApprove}
          disabled={isLoading}
          className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer"
          style={{
            fontFamily: "var(--font-mono)",
            background: "var(--ok-dim)",
            color: "var(--ok)",
            border: "1px solid rgba(52,211,153,0.2)",
          }}
        >
          ✓ Approve
        </button>
        <input
          value={rejectReason}
          onChange={(e) => onRejectReasonChange(e.target.value)}
          placeholder="Reason..."
          className="input-base flex-1 text-[11px]"
          style={{ padding: "6px 10px" }}
        />
        <button
          onClick={onReject}
          disabled={isLoading}
          className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer"
          style={{
            fontFamily: "var(--font-mono)",
            background: "var(--err-dim)",
            color: "var(--err)",
            border: "1px solid rgba(248,113,113,0.2)",
          }}
        >
          ✕ Reject
        </button>
      </div>
    </div>
  );
}
