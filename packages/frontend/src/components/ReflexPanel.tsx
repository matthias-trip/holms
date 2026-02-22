import { Zap, X } from "lucide-react";
import { Switch, Card, CardBody, Chip, Button } from "@heroui/react";
import { trpc } from "../trpc";

export default function ReflexPanel() {
  const { data: reflexes, refetch } = trpc.reflex.list.useQuery(undefined, {
    refetchInterval: 5000,
  });

  const toggleMutation = trpc.reflex.toggle.useMutation({
    onSuccess: () => refetch(),
  });

  const deleteMutation = trpc.reflex.delete.useMutation({
    onSuccess: () => refetch(),
  });

  return (
    <div className="h-full flex flex-col p-6" style={{ background: "var(--gray-2)" }}>
      <div className="mb-5">
        <h3 className="text-base font-bold mb-2" style={{ color: "var(--gray-12)" }}>Reflex Rules</h3>
        <p className="text-xs" style={{ color: "var(--gray-9)", maxWidth: "500px", lineHeight: "1.6" }}>
          Instant rules that react to events without AI reasoning. Proven patterns promoted from automations.
        </p>
      </div>

      <div className="flex-1 overflow-auto space-y-2">
        {(!reflexes || reflexes.length === 0) ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Zap size={18} />
            </div>
            <div className="empty-state-text">
              No reflex rules yet. Reflexes are created by the assistant after automations have been handled consistently.
            </div>
          </div>
        ) : (
          reflexes.map((rule, i) => (
            <Card
              key={rule.id}
              className="group animate-fade-in"
              style={{
                opacity: rule.enabled ? 1 : 0.5,
                animationDelay: `${i * 40}ms`,
                background: "var(--gray-3)",
                border: "1px solid var(--gray-a5)",
              }}
            >
              <CardBody>
                <div className="flex justify-between gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium mb-3" style={{ color: "var(--gray-12)" }}>
                      {rule.reason}
                    </p>
                    <div
                      className="rounded-lg p-3 space-y-2"
                      style={{
                        fontSize: "12px",
                        background: "var(--gray-a3)",
                        border: "1px solid var(--gray-a5)",
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <Chip variant="flat" color="primary" size="sm">When</Chip>
                        <span className="text-xs" style={{ color: "var(--gray-12)" }}>
                          {rule.trigger.deviceId ?? "any device"}
                          {rule.trigger.eventType ? ` fires ${rule.trigger.eventType}` : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Chip variant="flat" color="success" size="sm">Then</Chip>
                        <span className="text-xs" style={{ color: "var(--gray-12)" }}>
                          {rule.action.command} &rarr; {rule.action.deviceId}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-3">
                      <span className="text-xs" style={{ color: "var(--gray-9)" }}>
                        {rule.createdBy === "coordinator" ? "Created by assistant" : `by ${rule.createdBy}`}
                        {" \u00b7 "}
                        {new Date(rule.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Switch
                      isSelected={rule.enabled}
                      onValueChange={(checked) => toggleMutation.mutate({ id: rule.id, enabled: checked })}
                      size="sm"
                    />
                    <Button
                      isIconOnly
                      variant="light"
                      color="danger"
                      size="sm"
                      onPress={() => deleteMutation.mutate({ id: rule.id })}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete rule"
                    >
                      <X size={14} />
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
