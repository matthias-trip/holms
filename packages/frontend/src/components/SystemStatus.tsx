import { useState } from "react";
import { Button, Popover, PopoverTrigger, PopoverContent } from "@heroui/react";
import { RefreshCw, Download, ArrowRight } from "lucide-react";
import { trpc } from "../trpc";

export default function SystemStatus() {
  const [isOpen, setIsOpen] = useState(false);
  const version = trpc.system.version.useQuery(undefined, {
    refetchInterval: 5 * 60 * 1000,
  });
  const checkMutation = trpc.system.checkForUpdate.useMutation({
    onSuccess: () => version.refetch(),
  });
  const updateMutation = trpc.system.triggerUpdate.useMutation();

  const data = version.data;
  const isDev = !data || data.environment === "development";
  const displayVersion = isDev ? "Development" : `v${data.current}`;

  return (
    <div
      className="px-3 py-2.5 rounded-lg group"
      style={{ background: "var(--color-background)", border: "1px solid var(--gray-a5)" }}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse-dot"
          style={{ background: "var(--warm)" }}
        />
        <span className="text-xs flex-1 min-w-0" style={{ color: "var(--gray-9)" }}>
          {displayVersion}
        </span>

        {/* Check for updates button — visible on hover */}
        {!isDev && (
          <button
            onClick={() => checkMutation.mutate()}
            disabled={checkMutation.isPending}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: "var(--gray-8)", background: "none", border: "none", padding: 0, cursor: "pointer" }}
            title="Check for updates"
          >
            <RefreshCw
              size={12}
              strokeWidth={1.5}
              className={checkMutation.isPending ? "animate-spin" : ""}
            />
          </button>
        )}

        {/* Update available pill */}
        {data?.updateAvailable && (
          <Popover placement="top" isOpen={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger>
              <button
                className="px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                style={{
                  background: "var(--accent-a4)",
                  color: "var(--accent-11)",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Update
              </button>
            </PopoverTrigger>
            <PopoverContent>
              <div className="p-3 flex flex-col gap-3" style={{ minWidth: 200 }}>
                <div className="flex items-center gap-2 text-sm" style={{ color: "var(--gray-11)" }}>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{data.current}</span>
                  <ArrowRight size={12} style={{ color: "var(--gray-8)" }} />
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent-11)" }}>
                    {data.latest}
                  </span>
                </div>

                {data.watchtowerAvailable ? (
                  <Button
                    size="sm"
                    color="primary"
                    variant="flat"
                    isLoading={updateMutation.isPending}
                    onPress={() => updateMutation.mutate()}
                    startContent={!updateMutation.isPending ? <Download size={14} /> : undefined}
                    className="w-full"
                  >
                    {updateMutation.isPending
                      ? "Restarting..."
                      : updateMutation.isSuccess
                        ? updateMutation.data.success
                          ? "Restarting..."
                          : "Failed"
                        : "Update now"}
                  </Button>
                ) : (
                  <div className="text-xs" style={{ color: "var(--gray-9)" }}>
                    Pull the latest image manually:
                    <code
                      className="block mt-1 px-2 py-1 rounded text-[11px]"
                      style={{ background: "var(--gray-a3)", fontFamily: "var(--font-mono)" }}
                    >
                      docker compose pull && docker compose up -d
                    </code>
                  </div>
                )}

                {updateMutation.isSuccess && !updateMutation.data.success && (
                  <div className="text-xs" style={{ color: "var(--danger)" }}>
                    {updateMutation.data.message}
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}
