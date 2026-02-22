import { useState } from "react";
import { Wifi, WifiOff, AlertCircle, HelpCircle, Settings, Cpu } from "lucide-react";
import { Card, CardBody, Chip, Button, Switch } from "@heroui/react";
import { trpc } from "../trpc";
import type { DeviceProviderInfo, DeviceProviderStatus } from "@holms/shared";
import ChannelConfigForm from "./channels/ChannelConfigForm";
import HAEntityPicker from "./HAEntityPicker";

const statusConfig: Record<DeviceProviderStatus, { color: string; icon: typeof Wifi; label: string }> = {
  connected: { color: "var(--ok)", icon: Wifi, label: "Connected" },
  disconnected: { color: "var(--gray-8)", icon: WifiOff, label: "Disconnected" },
  error: { color: "var(--err)", icon: AlertCircle, label: "Error" },
  unconfigured: { color: "var(--gray-7)", icon: HelpCircle, label: "Unconfigured" },
};

export default function IntegrationsPanel() {
  const { data: providers } = trpc.deviceProviders.list.useQuery(undefined, {
    refetchInterval: 5000,
  });

  const utils = trpc.useUtils();
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [entityPickerId, setEntityPickerId] = useState<string | null>(null);

  const enableMutation = trpc.deviceProviders.enable.useMutation({
    onSuccess: () => {
      utils.deviceProviders.list.invalidate();
      setConfiguringId(null);
      setConfigError(null);
    },
    onError: (err) => setConfigError(err.message),
  });

  const disableMutation = trpc.deviceProviders.disable.useMutation({
    onSuccess: () => utils.deviceProviders.list.invalidate(),
  });

  const updateConfigMutation = trpc.deviceProviders.updateConfig.useMutation({
    onSuccess: () => {
      utils.deviceProviders.list.invalidate();
      setConfiguringId(null);
      setConfigError(null);
    },
    onError: (err) => setConfigError(err.message),
  });

  const handleToggle = (provider: DeviceProviderInfo, enabled: boolean) => {
    if (enabled) {
      if (provider.configSchema.length > 0 && provider.status === "unconfigured") {
        setConfiguringId(provider.id);
      } else {
        enableMutation.mutate({ id: provider.id, config: provider.config });
      }
    } else {
      disableMutation.mutate({ id: provider.id });
    }
  };

  const handleSaveConfig = (providerId: string, config: Record<string, unknown>, isNew: boolean) => {
    if (isNew) {
      enableMutation.mutate({ id: providerId, config });
    } else {
      updateConfigMutation.mutate({ id: providerId, config });
    }
  };

  if (entityPickerId) {
    return (
      <HAEntityPicker
        onBack={() => setEntityPickerId(null)}
      />
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 px-6 pt-6 pb-4">
        <h3 className="text-base font-bold mb-2" style={{ color: "var(--gray-12)" }}>Device Integrations</h3>
        <p className="text-xs" style={{ color: "var(--gray-9)", maxWidth: "500px", lineHeight: "1.6" }}>
          Device providers connect the assistant to smart home platforms.
          Enable a provider and configure its credentials to start controlling devices.
        </p>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6 space-y-2">
        {providers?.map((provider, i) => {
          const statusCfg = statusConfig[provider.status];
          const isConfiguring = configuringId === provider.id;
          const isHA = provider.id === "home_assistant";

          return (
            <Card
              key={provider.id}
              className="animate-fade-in"
              style={{
                animationDelay: `${i * 40}ms`,
                background: "var(--gray-3)",
                border: "1px solid var(--gray-a5)",
                opacity: !provider.enabled ? 0.6 : 1,
              }}
            >
              <CardBody>
                <div className="flex justify-between gap-3">
                  {/* Icon anchor */}
                  <div
                    className="flex-shrink-0 flex items-center justify-center rounded-lg"
                    style={{
                      width: 32,
                      height: 32,
                      background: "var(--gray-a3)",
                      color: statusCfg.color,
                      marginTop: 2,
                    }}
                  >
                    <statusCfg.icon size={16} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <span className="text-base font-medium" style={{ color: "var(--gray-12)" }}>
                      {provider.displayName}
                    </span>

                    {/* Metadata row */}
                    <div className="flex items-center gap-2 mt-1 mb-2">
                      <div className="flex items-center gap-1.5">
                        <div
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: statusCfg.color }}
                        />
                        <span className="text-xs" style={{ color: "var(--gray-9)" }}>
                          {statusCfg.label}
                        </span>
                      </div>
                      <Chip
                        variant="flat"
                        color={provider.origin === "builtin" ? "default" : "secondary"}
                        size="sm"
                      >
                        {provider.origin === "builtin" ? "Built-in" : "Plugin"}
                      </Chip>
                      {provider.deviceCount > 0 && (
                        <Chip variant="bordered" size="sm">
                          <span className="flex items-center gap-1">
                            <Cpu size={10} />
                            {provider.deviceCount} devices
                          </span>
                        </Chip>
                      )}
                    </div>

                    <p className="text-sm mb-2" style={{ color: "var(--gray-10)", lineHeight: "1.6" }}>
                      {provider.description}
                    </p>

                    {provider.statusMessage && (
                      <p className="text-xs mb-2" style={{ color: "var(--err)" }}>
                        {provider.statusMessage}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isHA && provider.enabled && provider.status === "connected" && (
                      <Button
                        variant="bordered"
                        size="sm"
                        onPress={() => setEntityPickerId(provider.id)}
                      >
                        Manage Entities
                      </Button>
                    )}
                    {provider.enabled && provider.configSchema.length > 0 && (
                      <Button
                        variant="bordered"
                        size="sm"
                        isIconOnly
                        onPress={() => {
                          setConfiguringId(isConfiguring ? null : provider.id);
                          setConfigError(null);
                        }}
                      >
                        <Settings size={14} />
                      </Button>
                    )}
                    <Switch
                      size="sm"
                      isSelected={provider.enabled}
                      onValueChange={(v) => handleToggle(provider, v)}
                      isDisabled={enableMutation.isPending || disableMutation.isPending}
                    />
                  </div>
                </div>

                {isConfiguring && (
                  <ChannelConfigForm
                    fields={provider.configSchema}
                    initialValues={provider.config}
                    onSave={(config) =>
                      handleSaveConfig(provider.id, config, provider.status === "unconfigured")
                    }
                    onCancel={() => {
                      setConfiguringId(null);
                      setConfigError(null);
                    }}
                    saving={enableMutation.isPending || updateConfigMutation.isPending}
                    error={configError}
                  />
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}