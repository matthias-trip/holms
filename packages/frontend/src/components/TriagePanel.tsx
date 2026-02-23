import { ListFilter } from "lucide-react";
import { Card, CardBody, Chip } from "@heroui/react";
import { trpc } from "../trpc";
import type { TriageLane } from "@holms/shared";
import { relativeTime } from "../utils/humanize";

const LANE_CHIP: Record<TriageLane, { color: string; label: string }> = {
  immediate: { color: "var(--warn)", label: "immediate" },
  batched: { color: "var(--info)", label: "batched" },
  silent: { color: "var(--gray-8)", label: "silent" },
};

export default function TriagePanel() {
  const { data: rules, refetch } = trpc.triage.list.useQuery(undefined, {
    refetchInterval: 5000,
  });


  return (
    <div className="h-full flex flex-col p-6" style={{ background: "var(--gray-2)" }}>
      <div className="mb-4">
        <h3 className="text-base font-bold mb-1" style={{ color: "var(--gray-12)" }}>Triage Rules</h3>
        <p className="text-xs" style={{ color: "var(--gray-9)", maxWidth: "500px", lineHeight: "1.6" }}>
          Rules that classify device events into lanes. Created by the assistant as it learns which events matter.
        </p>
      </div>

      <div className="flex-1 overflow-auto space-y-1.5">
        {(!rules || rules.length === 0) ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <ListFilter size={18} />
            </div>
            <div className="empty-state-text">
              No triage rules yet. Rules are created by the assistant as it learns which events matter.
            </div>
          </div>
        ) : (
          rules.map((rule, i) => {
            const lane = LANE_CHIP[rule.lane as TriageLane] ?? LANE_CHIP.batched;
            const cond = rule.condition;

            const condParts: string[] = [];
            if (cond.deviceId) condParts.push(cond.deviceId);
            if (cond.deviceDomain) condParts.push(cond.deviceDomain);
            if (cond.eventType) condParts.push(cond.eventType);
            if (cond.area) condParts.push(cond.area);
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
      </div>
    </div>
  );
}
