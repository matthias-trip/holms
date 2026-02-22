import { useState, useRef, useEffect } from "react";
import { Route, Trash2, Plus, ChevronDown } from "lucide-react";
import { Card, CardBody, Chip, Button, Switch } from "@heroui/react";
import { trpc } from "../../trpc";

const eventTypeOptions = [
  { value: "approval", label: "Approval", color: "var(--warn)" },
  { value: "device_event", label: "Device Event", color: "var(--accent-9)" },
  { value: "broadcast", label: "Broadcast", color: "var(--gray-9)" },
];

function Dropdown({ value, onChange, options, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 text-xs px-3 py-2 rounded-lg transition-colors duration-150"
        style={{
          background: "var(--gray-2)",
          border: "1px solid var(--gray-a5)",
          color: selected ? "var(--gray-12)" : "var(--gray-8)",
        }}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown size={12} style={{ color: "var(--gray-8)", flexShrink: 0 }} />
      </button>
      {open && (
        <div
          className="absolute z-50 w-full mt-1 rounded-lg overflow-hidden"
          style={{
            background: "var(--gray-3)",
            border: "1px solid var(--gray-a5)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.08), 0 0 0 0.5px var(--gray-a3)",
          }}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className="w-full text-left text-xs px-3 py-2 transition-colors duration-100"
              style={{
                color: "var(--gray-12)",
                background: opt.value === value ? "var(--accent-a3)" : "transparent",
              }}
              onMouseEnter={(e) => { if (opt.value !== value) e.currentTarget.style.background = "var(--gray-a3)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = opt.value === value ? "var(--accent-a3)" : "transparent"; }}
            >
              {opt.label}
            </button>
          ))}
          {options.length === 0 && (
            <div className="text-xs px-3 py-2" style={{ color: "var(--gray-8)" }}>No options</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChannelRouting() {
  const { data: routes } = trpc.channels.routes.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const { data: providers } = trpc.channels.providers.useQuery();

  const utils = trpc.useUtils();

  const addRouteMutation = trpc.channels.addRoute.useMutation({
    onSuccess: () => {
      utils.channels.routes.invalidate();
      setNewEventType("");
      setNewChannelId("");
    },
  });

  const removeRouteMutation = trpc.channels.removeRoute.useMutation({
    onSuccess: () => utils.channels.routes.invalidate(),
  });

  const toggleRouteMutation = trpc.channels.toggleRoute.useMutation({
    onSuccess: () => utils.channels.routes.invalidate(),
  });

  const [newEventType, setNewEventType] = useState("");
  const [newChannelId, setNewChannelId] = useState("");

  // Build channel options from enabled providers (excluding web)
  const channelOptions = (providers ?? [])
    .filter((p) => p.enabled && p.id !== "web")
    .map((p) => ({ value: p.id, label: p.displayName }));

  const handleAddRoute = () => {
    if (!newEventType || !newChannelId) return;
    addRouteMutation.mutate({ eventType: newEventType, channelId: newChannelId });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 px-6 pt-6 pb-4">
        <h3 className="text-base font-bold mb-2" style={{ color: "var(--gray-12)" }}>Routing Rules</h3>
        <p className="text-xs" style={{ color: "var(--gray-9)", maxWidth: "500px", lineHeight: "1.6" }}>
          Control which events are forwarded to external channels.
          Approval requests, device events, and broadcasts can each be routed independently.
        </p>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
      {/* Add Route Form */}
      <Card
        className="mb-4"
        style={{ background: "var(--gray-3)", border: "1px solid var(--gray-a5)" }}
      >
        <CardBody>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--gray-11)" }}>
                Event Type
              </label>
              <Dropdown
                value={newEventType}
                onChange={setNewEventType}
                options={eventTypeOptions}
                placeholder="Select event type"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--gray-11)" }}>
                Target Channel
              </label>
              <Dropdown
                value={newChannelId}
                onChange={setNewChannelId}
                options={channelOptions}
                placeholder="Select channel"
              />
            </div>
            <Button
              size="sm"
              color="primary"
              variant="flat"
              onPress={handleAddRoute}
              isDisabled={!newEventType || !newChannelId || addRouteMutation.isPending}
              startContent={<Plus size={14} />}
            >
              Add
            </Button>
          </div>
          {channelOptions.length === 0 && (
            <p className="text-xs mt-2" style={{ color: "var(--gray-8)" }}>
              Enable an external channel provider (e.g. Slack) to create routing rules.
            </p>
          )}
        </CardBody>
      </Card>

      {/* Route List */}
      <div className="space-y-2">
        {!routes || routes.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Route size={18} />
            </div>
            <div className="empty-state-text">
              No routing rules configured. Add a rule above to forward events to external channels.
            </div>
          </div>
        ) : (
          routes.map((route, i) => {
            const eventCfg = eventTypeOptions.find((e) => e.value === route.eventType);
            const providerName = providers?.find((p) => p.id === route.channelId)?.displayName ?? route.channelId;

            return (
              <Card
                key={route.id}
                className="animate-fade-in"
                style={{
                  animationDelay: `${i * 40}ms`,
                  background: "var(--gray-3)",
                  border: "1px solid var(--gray-a5)",
                }}
              >
                <CardBody>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Chip variant="bordered" size="sm">
                        {eventCfg?.label ?? route.eventType}
                      </Chip>
                      <span className="text-xs" style={{ color: "var(--gray-8)" }}>→</span>
                      <Chip variant="flat" color="primary" size="sm">
                        {providerName}
                      </Chip>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        size="sm"
                        isSelected={route.enabled}
                        onValueChange={(v) =>
                          toggleRouteMutation.mutate({ id: route.id, enabled: v })
                        }
                      />
                      <Button
                        variant="flat"
                        size="sm"
                        isIconOnly
                        color="danger"
                        onPress={() => removeRouteMutation.mutate({ id: route.id })}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })
        )}
      </div>
      </div>
    </div>
  );
}
