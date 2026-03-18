import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button, Input } from "@heroui/react";
import { trpc } from "../../trpc";
import type { PendingApproval } from "@holms/shared";
import AgentStatusBar from "./AgentStatusBar";
import SpaceGrid from "./SpaceGrid";
import CompactCycleList from "./CompactCycleList";

// ── Inline Approval Banner ──

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

function InlineApproval({ item, onApprove, onReject }: {
  item: PendingApproval;
  onApprove: () => void;
  onReject: (reason?: string) => void;
}) {
  const [rejectReason, setRejectReason] = useState("");

  return (
    <div
      className="flex items-center gap-4 px-4 py-3 rounded-xl animate-fade-in"
      style={{
        background: "var(--gray-3)",
        border: "1px solid var(--gray-a5)",
        borderLeft: "3px solid var(--warm)",
      }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: "var(--gray-12)" }}>
          {formatApprovalAction(item.command, item.params, item.deviceId)}
        </p>
        <p className="text-xs mt-0.5 truncate" style={{ color: "var(--gray-9)" }}>
          {item.reason}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Input
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Reason..."
          size="sm"
          className="w-28"
        />
        <Button size="sm" variant="flat" color="success" onPress={onApprove}>
          Approve
        </Button>
        <Button
          size="sm"
          variant="flat"
          color="danger"
          onPress={() => onReject(rejectReason || undefined)}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

function ApprovalsBanner() {
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

  if (!pending || pending.length === 0) return null;

  return (
    <div className="space-y-2">
      {pending.map((item) => (
        <InlineApproval
          key={item.id}
          item={item}
          onApprove={() => approveMutation.mutate({ id: item.id })}
          onReject={(reason) => rejectMutation.mutate({ id: item.id, reason })}
        />
      ))}
    </div>
  );
}

// ── Main Home View ──

export default function HomeView() {
  return (
    <div className="h-full flex flex-col" style={{ background: "var(--gray-2)" }}>
      {/* Agent Status Bar */}
      <AgentStatusBar />

      {/* Scrollable content */}
      <div className="flex-1 overflow-auto px-6 py-5 space-y-6 content-reveal">
        {/* Pending Approvals */}
        <ApprovalsBanner />

        {/* Spaces Grid */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2
              className="text-sm font-semibold"
              style={{ fontFamily: "var(--font-display)", color: "var(--gray-12)" }}
            >
              Spaces
            </h2>
            <a
              href="#spaces"
              className="flex items-center gap-1 text-xs transition-colors duration-150"
              style={{ color: "var(--gray-8)" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent-9)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--gray-8)"; }}
            >
              View all <ChevronRight size={12} />
            </a>
          </div>
          <SpaceGrid />
        </section>

        {/* Recent Agent Activity */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2
              className="text-sm font-semibold"
              style={{ fontFamily: "var(--font-display)", color: "var(--gray-12)" }}
            >
              Recent Agent Activity
            </h2>
            <a
              href="#activity"
              className="flex items-center gap-1 text-xs transition-colors duration-150"
              style={{ color: "var(--gray-8)" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent-9)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--gray-8)"; }}
            >
              View all <ChevronRight size={12} />
            </a>
          </div>
          <CompactCycleList />
        </section>
      </div>
    </div>
  );
}
