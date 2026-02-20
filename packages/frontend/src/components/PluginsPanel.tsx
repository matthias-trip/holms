import { Lock } from "lucide-react";
import { Switch, Chip, Card, CardBody, Button } from "@heroui/react";
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
    <div className="h-full flex flex-col p-6" style={{ background: "var(--gray-2)" }}>
      <div className="flex justify-between items-start mb-5">
        <div>
          <h3 className="text-base font-bold mb-2" style={{ color: "var(--gray-12)" }}>Plugins</h3>
          <p className="text-xs" style={{ color: "var(--gray-9)", maxWidth: "500px", lineHeight: "1.6" }}>
            Extend the assistant with plugins from the built-in plugins/ directory and ~/.holms/plugins.
            Each plugin can provide MCP servers, commands, agents, skills, and hooks.
          </p>
        </div>
        <Button
          variant="bordered"
          size="sm"
          onPress={() => refreshMutation.mutate()}
          isDisabled={refreshMutation.isPending}
        >
          {refreshMutation.isPending ? "Scanning..." : "Rescan"}
        </Button>
      </div>

      <div className="flex-1 overflow-auto space-y-2">
        {!plugins || plugins.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Lock size={18} />
            </div>
            <div className="empty-state-text">
              No plugins installed. Add plugin directories to plugins/ or ~/.holms/plugins/ to extend
              the assistant.
            </div>
          </div>
        ) : (
          plugins.map((plugin, i) => (
            <Card
              key={plugin.name}
              className="animate-fade-in"
              style={{
                opacity: plugin.enabled ? 1 : 0.5,
                animationDelay: `${i * 40}ms`,
                background: "var(--gray-3)",
                border: "1px solid var(--gray-a5)",
              }}
            >
              <CardBody>
                <div className="flex justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-base font-medium" style={{ color: "var(--gray-12)" }}>{plugin.name}</span>
                      <Chip variant="flat" color="primary" size="sm">
                        v{plugin.version}
                      </Chip>
                      <Chip
                        variant="flat"
                        color={plugin.origin === "builtin" ? "default" : "secondary"}
                        size="sm"
                      >
                        {plugin.origin === "builtin" ? "Built-in" : "User"}
                      </Chip>
                    </div>

                    {plugin.description && (
                      <p className="text-sm mb-2" style={{ lineHeight: "1.6", color: "var(--gray-12)" }}>
                        {plugin.description}
                      </p>
                    )}

                    <div className="flex items-center gap-1 flex-wrap">
                      {plugin.capabilities.map((cap) => (
                        <Chip key={cap} variant="bordered" size="sm">
                          {cap}
                        </Chip>
                      ))}
                      {plugin.author && (
                        <span className="text-xs ml-1" style={{ color: "var(--gray-9)" }}>
                          by {plugin.author}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!plugin.installed && (
                      <Button
                        variant="solid"
                        color="primary"
                        size="sm"
                        onPress={() => installMutation.mutate({ name: plugin.name })}
                        isDisabled={installMutation.isPending}
                      >
                        {installMutation.isPending ? "Installing..." : "Install"}
                      </Button>
                    )}

                    <Switch
                      isSelected={plugin.enabled}
                      onValueChange={(checked) =>
                        toggleMutation.mutate({ name: plugin.name, enabled: checked })
                      }
                      isDisabled={toggleMutation.isPending}
                      size="sm"
                    />
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
