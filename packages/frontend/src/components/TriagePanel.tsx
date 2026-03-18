import { ListFilter } from "lucide-react";
import { Card, CardBody, Chip } from "@heroui/react";
import { trpc } from "../trpc";
import type { TriageLane } from "@holms/shared";
import { relativeTime } from "../utils/humanize";
import PanelShell from "./shared/PanelShell";
import EmptyState from "./shared/EmptyState";

const LANE_CHIP: Record<TriageLane, { color: string; label: string }> = {
  immediate: { color: "var(--warn)", label: "immediate" },
  batched: { color: "var(--info)", label: "batched" },
  silent: { color: "var(--gray-8)", label: "silent" },
};

export default function TriagePanel({ embedded }: { embedded?: boolean }) {
  const { data: rules } = trpc.triage.list.useQuery(undefined, {
    refetchInterval: 5000,
  });

  const content = (
    <>
      {(!rules || rules.length === 0) ? (
        <EmptyState
          icon={<ListFilter size={18} />}
          description="No triage rules yet. Rules are created by the assistant as it learns which events matter."
        />
      ) : (
        rules.map((rule, i) => {
          const lane = LANE_CHIP[rule.lane as TriageLane] ?? LANE_CHIP.batched;
          const cond = rule.condition;

          const condParts: string[] = [];
          if (cond.deviceId) condParts.push(`source:${cond.deviceId}`);
          if (cond.deviceDomain) condParts.push(`property:${cond.deviceDomain}`);
          if (cond.eventType) condParts.push(cond.eventType);
          if (cond.area) condParts.push(`space:${cond.area}`);
          if (cond.deltaThreshold != null) {
            condParts.push(`\u0394 \u2265 ${cond.deltaThreshold}`);
          }
          if (rule.holdMinutes != null) {
            condParts.push(`hold ${rule.holdMinutes}min`);
          }

          return (
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
              <CardBody style={{ padding: "10px 14px" }}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium" style={{ color: "var(--gray-12)" }}>
                      {rule.reason}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      <Chip
                        variant="flat"
                        size="sm"
                        style={{
                          background: `color-mix(in srgb, ${lane.color} 12%, transparent)`,
                          color: lane.color,
                        }}
                      >
                        {lane.label}
                      </Chip>
                      {condParts.length > 0 ? (
                        <span
                          className="text-xs truncate"
                          style={{ color: "var(--gray-9)", fontFamily: "var(--font-mono)", fontSize: "11px" }}
                        >
                          {condParts.join(" · ")}
                        </span>
                      ) : (
                        <span className="text-xs" style={{ color: "var(--gray-9)" }}>any event</span>
                      )}
                      <span className="text-xs" style={{ color: "var(--gray-8)" }}>
                        · {relativeTime(rule.createdAt)}
                      </span>
                    </div>
                  </div>

                  {!rule.enabled && (
                    <Chip
                      variant="flat"
                      size="sm"
                      className="flex-shrink-0 mt-0.5"
                      style={{ background: "var(--gray-a3)", color: "var(--gray-8)" }}
                    >
                      disabled
                    </Chip>
                  )}
                </div>
              </CardBody>
            </Card>
          );
        })
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--gray-2)" }}>
        {content}
      </div>
    );
  }

  return (
    <PanelShell title="Triage" contentClassName="space-y-1.5 p-6">
      {content}
    </PanelShell>
  );
}
