import { useState } from "react";
import { trpc } from "../trpc";
import type { PendingApproval } from "@holms/shared";

function formatApprovalAction(command: string, params: unknown, deviceId: string): string {
  const p = params as Record<string, unknown>;
  // Try to produce a human-readable description
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
  // Fallback: readable command + device
  return `${command.replace(/_/g, " ")} on ${deviceId}`;
}

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
        <span className="section-label">Needs Your OK</span>
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
              All clear! The assistant will ask for your OK before doing anything unusual or important.
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
  return (
    <div
      className="rounded-xl p-4 animate-fade-in"
      style={{
        background: "var(--obsidian)",
        border: "1px solid var(--graphite)",
        animationDelay: `${index * 60}ms`,
      }}
    >
      {/* Time */}
      <div className="flex items-center gap-2 mb-3">
        <span className="badge" style={{ background: "var(--warn-dim)", color: "var(--warn)" }}>
          Awaiting approval
        </span>
        <span
          className="text-[10px] ml-auto"
          style={{ color: "var(--pewter)" }}
        >
          {new Date(item.createdAt).toLocaleTimeString()}
        </span>
      </div>

      {/* Action detail */}
      <div
        className="rounded-lg p-3 mb-3"
        style={{
          fontSize: "12px",
          background: "var(--abyss)",
          border: "1px solid var(--graphite)",
          color: "var(--frost)",
        }}
      >
        {formatApprovalAction(item.command, item.params, item.deviceId)}
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
            background: "var(--ok-dim)",
            color: "var(--ok)",
            border: "1px solid rgba(22,163,74,0.15)",
          }}
        >
          Approve
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
            background: "var(--err-dim)",
            color: "var(--err)",
            border: "1px solid rgba(220,38,38,0.15)",
          }}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
