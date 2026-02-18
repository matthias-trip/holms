import { trpc } from "../trpc";

export default function PluginsPanel() {
  const utils = trpc.useUtils();
  const { data: plugins } = trpc.plugins.list.useQuery(undefined, {
    refetchInterval: 10000,
  });

  const toggleMutation = trpc.plugins.toggle.useMutation({
    onSuccess: () => utils.plugins.list.invalidate(),
  });

  const refreshMutation = trpc.plugins.refresh.useMutation({
    onSuccess: () => utils.plugins.list.invalidate(),
  });

  const installMutation = trpc.plugins.install.useMutation({
    onSuccess: () => utils.plugins.list.invalidate(),
  });

  return (
    <div className="h-full flex flex-col p-6" style={{ background: "var(--void)" }}>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <span className="section-label">Plugins</span>
          <p
            className="text-[12px] mt-2"
            style={{ color: "var(--steel)", maxWidth: "500px", lineHeight: "1.6" }}
          >
            Extend the assistant with plugins from the built-in plugins/ directory and ~/.holms/plugins.
            Each plugin can provide MCP servers, commands, agents, skills, and hooks.
          </p>
        </div>
        <button
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          className="px-3 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition-all"
          style={{
            background: "var(--obsidian)",
            color: "var(--silver)",
            border: "1px solid var(--graphite)",
          }}
        >
          {refreshMutation.isPending ? "Scanning..." : "Rescan"}
        </button>
      </div>

      <div className="flex-1 overflow-auto space-y-2">
        {!plugins || plugins.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect x="3" y="6" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.3" />
                <path d="M7 6V4a2 2 0 0 1 4 0v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <circle cx="9" cy="11" r="1.5" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            </div>
            <div className="empty-state-text">
              No plugins installed. Add plugin directories to plugins/ or ~/.holms/plugins/ to extend
              the assistant.
            </div>
          </div>
        ) : (
          plugins.map((plugin, i) => (
            <div
              key={plugin.name}
              className="rounded-xl p-4 animate-fade-in"
              style={{
                background: plugin.enabled ? "var(--obsidian)" : "var(--abyss)",
                border: "1px solid var(--graphite)",
                opacity: plugin.enabled ? 1 : 0.5,
                animationDelay: `${i * 40}ms`,
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2.5 mb-2">
                    <span
                      className="text-[14px] font-medium"
                      style={{ color: "var(--frost)" }}
                    >
                      {plugin.name}
                    </span>
                    <span
                      className="badge"
                      style={{
                        background: "var(--glow-wash)",
                        color: "var(--glow)",
                        border: "1px solid var(--glow-border)",
                      }}
                    >
                      v{plugin.version}
                    </span>
                    <span
                      className="badge"
                      style={{
                        background: plugin.origin === "builtin" ? "var(--void)" : "rgba(139, 92, 246, 0.1)",
                        color: plugin.origin === "builtin" ? "var(--pewter)" : "rgb(167, 139, 250)",
                        border: `1px solid ${plugin.origin === "builtin" ? "var(--graphite)" : "rgba(139, 92, 246, 0.3)"}`,
                      }}
                    >
                      {plugin.origin === "builtin" ? "Built-in" : "User"}
                    </span>
                  </div>

                  {plugin.description && (
                    <div
                      className="text-[13px] leading-relaxed mb-2.5"
                      style={{ color: "var(--mist)" }}
                    >
                      {plugin.description}
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {plugin.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="badge"
                        style={{
                          background: "var(--void)",
                          color: "var(--pewter)",
                          border: "1px solid var(--graphite)",
                        }}
                      >
                        {cap}
                      </span>
                    ))}
                    {plugin.author && (
                      <span
                        className="text-[10px] ml-1"
                        style={{ color: "var(--pewter)" }}
                      >
                        by {plugin.author}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {!plugin.installed && (
                    <button
                      onClick={() => installMutation.mutate({ name: plugin.name })}
                      disabled={installMutation.isPending}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition-all"
                      style={{
                        background: "var(--glow)",
                        color: "var(--void)",
                        border: "none",
                        opacity: installMutation.isPending ? 0.6 : 1,
                      }}
                    >
                      {installMutation.isPending ? "Installing..." : "Install"}
                    </button>
                  )}

                  <button
                    onClick={() =>
                      toggleMutation.mutate({
                        name: plugin.name,
                        enabled: !plugin.enabled,
                      })
                    }
                    disabled={toggleMutation.isPending}
                    className="flex-shrink-0 w-10 h-5.5 rounded-full relative cursor-pointer transition-all"
                    style={{
                      background: plugin.enabled ? "var(--glow)" : "var(--graphite)",
                      border: "none",
                      padding: 0,
                      width: 40,
                      height: 22,
                    }}
                  >
                    <span
                      className="block rounded-full absolute top-[2px] transition-all"
                      style={{
                        width: 18,
                        height: 18,
                        background: "var(--white)",
                        left: plugin.enabled ? 20 : 2,
                      }}
                    />
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
