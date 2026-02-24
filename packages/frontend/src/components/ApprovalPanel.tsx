import { useState } from "react";
import { CheckSquare } from "lucide-react";
import { Card, CardBody, Chip, Button, Input } from "@heroui/react";
import { trpc } from "../trpc";
import type { PendingApproval } from "@holms/shared";

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
    <div className="h-full flex flex-col" style={{ background: "var(--gray-2)" }}>
      <div
        className="flex justify-between items-center flex-shrink-0 px-6 h-14"
        style={{ borderBottom: "1px solid var(--gray-a3)", background: "var(--gray-1)" }}
      >
        <h3 className="text-base font-bold" style={{ color: "var(--gray-12)" }}>Approvals</h3>
        {pending && pending.length > 0 && (
          <Chip variant="flat" color="danger" size="sm">
            {pending.length} pending
          </Chip>
        )}
      </div>

      <div className="flex-1 overflow-auto space-y-2 p-6">
        {(!pending || pending.length === 0) ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <CheckSquare size={18} />
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
    <Card
      className="animate-fade-in"
      style={{
        animationDelay: `${index * 60}ms`,
        background: "var(--gray-3)",
        border: "1px solid var(--gray-a5)",
      }}
    >
      <CardBody>
        <div className="flex items-center gap-2 mb-3">
          <Chip variant="flat" color="warning" size="sm">
            Awaiting approval
          </Chip>
          <span className="text-xs ml-auto" style={{ color: "var(--gray-9)" }}>
            {new Date(item.createdAt).toLocaleTimeString()}
          </span>
        </div>

        <div
          className="rounded-lg p-3 mb-3"
          style={{
            fontSize: "12px",
            background: "var(--gray-a3)",
            border: "1px solid var(--gray-a5)",
          }}
        >
          <span className="text-xs" style={{ color: "var(--gray-12)" }}>{formatApprovalAction(item.command, item.params, item.deviceId)}</span>
        </div>

        <p className="text-xs mb-3" style={{ color: "var(--gray-9)", lineHeight: "1.5" }}>
          {item.reason}
        </p>

        <div className="flex gap-2 items-center">
          <Button
            variant="flat"
            color="success"
            size="sm"
            onPress={onApprove}
            isDisabled={isLoading}
          >
            Approve
          </Button>
          <Input
            value={rejectReason}
            onChange={(e) => onRejectReasonChange(e.target.value)}
            placeholder="Reason..."
            size="sm"
            className="flex-1"
          />
          <Button
            variant="flat"
            color="danger"
            size="sm"
            onPress={onReject}
            isDisabled={isLoading}
          >
            Reject
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
