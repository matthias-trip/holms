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
    <div className="h-full flex flex-col p-6" style={{ background: "var(--void)" }}>
      <div className="mb-5">
        <span className="section-label">Automation Rules</span>
        <p className="text-[12px] mt-2" style={{ color: "var(--steel)", maxWidth: "500px", lineHeight: "1.6" }}>
          Quick rules that react to events in your home, without waiting for the assistant.
        </p>
      </div>

      <div className="flex-1 overflow-auto space-y-2">
        {(!reflexes || reflexes.length === 0) ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M10 2L6 10h4l-2 6L13 8H9l1-6z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="empty-state-text">
              No automation rules yet. Ask the assistant to create rules like "turn on lights when motion is detected."
            </div>
          </div>
        ) : (
          reflexes.map((rule, i) => (
            <div
              key={rule.id}
              className="rounded-xl p-4 group animate-fade-in"
              style={{
                background: rule.enabled ? "var(--obsidian)" : "var(--abyss)",
                border: `1px solid ${rule.enabled ? "var(--graphite)" : "var(--graphite)"}`,
                opacity: rule.enabled ? 1 : 0.5,
                animationDelay: `${i * 40}ms`,
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="text-[13px] font-medium mb-3" style={{ color: "var(--frost)" }}>
                    {rule.reason}
                  </div>
                  <div
                    className="rounded-lg p-3 space-y-2"
                    style={{
                      fontSize: "12px",
                      background: "var(--abyss)",
                      border: "1px solid var(--graphite)",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="badge"
                        style={{ background: "var(--info-dim)", color: "var(--info)" }}
                      >
                        When
                      </span>
                      <span style={{ color: "var(--mist)" }}>
                        {rule.trigger.deviceId ?? "any device"}
                        {rule.trigger.eventType ? ` fires ${rule.trigger.eventType}` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className="badge"
                        style={{ background: "var(--ok-dim)", color: "var(--ok)" }}
                      >
                        Then
                      </span>
                      <span style={{ color: "var(--mist)" }}>
                        {rule.action.command} → {rule.action.deviceId}
                      </span>
                    </div>
                  </div>
                  <div
                    className="flex items-center gap-3 mt-3 text-[10px]"
                    style={{ color: "var(--pewter)" }}
                  >
                    <span>{rule.createdBy === "coordinator" ? "Created by assistant" : `by ${rule.createdBy}`}</span>
                    <span>·</span>
                    <span>{new Date(rule.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => toggleMutation.mutate({ id: rule.id, enabled: !rule.enabled })}
                    className="relative w-9 h-5 rounded-full transition-all duration-200 cursor-pointer"
                    style={{
                      background: rule.enabled ? "var(--glow)" : "var(--gunmetal)",
                      border: "none",
                      padding: 0,
                    }}
                  >
                    <div
                      className="absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200"
                      style={{
                        background: "white",
                        left: rule.enabled ? "18px" : "2px",
                      }}
                    />
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate({ id: rule.id })}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[var(--err-dim)]"
                    style={{ color: "var(--steel)" }}
                    title="Delete rule"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
