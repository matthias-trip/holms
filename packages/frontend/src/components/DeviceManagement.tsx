import { useState } from "react";
import { Smartphone, Trash2, Plus, User, Clock, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { trpc } from "../trpc";
import PanelShell from "./shared/PanelShell";
import EmptyState from "./shared/EmptyState";
import Dropdown from "./shared/Dropdown";

/* ── revoke button with hover effect ───────────────────────────────── */

function RevokeButton({ onPress, isLoading }: { onPress: () => void; isLoading: boolean }) {
  return (
    <button
      onClick={onPress}
      disabled={isLoading}
      className="p-1.5 rounded-lg cursor-pointer transition-colors duration-150"
      style={{ color: "var(--gray-8)", background: "transparent", border: "none" }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--err)"; e.currentTarget.style.background = "var(--gray-a3)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--gray-8)"; e.currentTarget.style.background = "transparent"; }}
      title="Revoke device"
    >
      <Trash2 size={14} />
    </button>
  );
}

/* ── relative time helper ──────────────────────────────────────────── */

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

/* ── main component ────────────────────────────────────────────────── */

export default function DeviceManagement({ embedded }: { embedded?: boolean }) {
  const devices = trpc.auth.devices.useQuery();
  const people = trpc.people.list.useQuery();
  const revokeMutation = trpc.auth.revokeDevice.useMutation({
    onSuccess: () => devices.refetch(),
  });
  const pairingMutation = trpc.auth.pairingCode.useMutation();

  const [showPairing, setShowPairing] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<string>("");

  function handlePair() {
    setShowPairing(true);
  }

  function handleGenerateCode() {
    pairingMutation.mutate({ personId: selectedPersonId || undefined });
  }

  function handleCancelPairing() {
    setShowPairing(false);
    setSelectedPersonId("");
    pairingMutation.reset();
  }

  const hasPeople = people.data && people.data.length > 0;

  const content = (
    <>

        {/* --- Pairing flow --- */}
        {showPairing && (
          <section>
            <h2
              className="text-[10px] uppercase tracking-wider font-medium mb-3"
              style={{ color: "var(--gray-9)" }}
            >
              Pair New Device
            </h2>

            <div
              className="rounded-xl p-5"
              style={{ background: "var(--gray-3)", border: "1px solid var(--gray-a5)" }}
            >
              {!pairingMutation.data ? (
                /* Step 1: Select person + generate code */
                <div className="flex flex-col gap-4">
                  <p className="text-sm" style={{ color: "var(--gray-11)" }}>
                    {hasPeople
                      ? "Link this device to a household member, then generate a pairing code."
                      : "Generate a one-time pairing code for the Holms app."}
                  </p>

                  {hasPeople && (
                    <div className="max-w-[240px]">
                      <Dropdown
                        label="Link to person"
                        value={selectedPersonId}
                        onChange={setSelectedPersonId}
                        options={people.data.map((p) => ({ value: p.id, label: p.name }))}
                        placeholder="Select person..."
                      />
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={handleGenerateCode}
                      disabled={pairingMutation.isPending || (hasPeople && !selectedPersonId)}
                      className="flex items-center gap-2 text-xs font-medium px-4 py-2 rounded-lg cursor-pointer transition-colors duration-150"
                      style={{
                        color: pairingMutation.isPending || (hasPeople && !selectedPersonId) ? "var(--gray-8)" : "var(--gray-1)",
                        background: pairingMutation.isPending || (hasPeople && !selectedPersonId) ? "var(--gray-a3)" : "var(--accent-9)",
                        border: "none",
                        opacity: pairingMutation.isPending || (hasPeople && !selectedPersonId) ? 0.5 : 1,
                      }}
                    >
                      <QrCode size={14} />
                      {pairingMutation.isPending ? "Generating..." : "Generate code"}
                    </button>
                    <button
                      onClick={handleCancelPairing}
                      className="flex items-center text-xs font-medium px-4 py-2 rounded-lg cursor-pointer transition-colors duration-150"
                      style={{ color: "var(--gray-11)", background: "transparent", border: "1px solid var(--gray-a5)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gray-a3)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                /* Step 2: Show QR code + pairing code */
                <div className="flex flex-col sm:flex-row gap-6 items-center sm:items-start">
                  {/* QR code */}
                  <div
                    className="flex-shrink-0 p-4 rounded-xl"
                    style={{ background: "white" }}
                  >
                    <QRCodeSVG
                      value={JSON.stringify({
                        url: window.location.origin,
                        code: pairingMutation.data.code,
                      })}
                      size={160}
                    />
                  </div>

                  {/* Instructions */}
                  <div className="flex flex-col gap-3 text-center sm:text-left">
                    <p className="text-sm font-medium" style={{ color: "var(--gray-12)" }}>
                      Scan the QR code
                    </p>
                    <p className="text-xs leading-relaxed" style={{ color: "var(--gray-9)" }}>
                      Open the Holms app on your device and scan this code. Or enter the code manually:
                    </p>

                    <div
                      className="inline-flex items-center gap-3 self-center sm:self-start px-4 py-2.5 rounded-lg"
                      style={{ background: "var(--gray-a3)" }}
                    >
                      <span
                        className="text-2xl font-mono font-bold tracking-[0.25em]"
                        style={{ color: "var(--gray-12)" }}
                      >
                        {pairingMutation.data.code}
                      </span>
                    </div>

                    <p className="text-xs" style={{ color: "var(--gray-8)" }}>
                      <Clock size={11} className="inline mr-1 -mt-px" />
                      Expires in 5 minutes
                    </p>

                    <button
                      onClick={handleCancelPairing}
                      className="flex items-center self-center sm:self-start text-xs font-medium px-4 py-2 rounded-lg cursor-pointer transition-colors duration-150 mt-1"
                      style={{ color: "var(--gray-11)", background: "transparent", border: "1px solid var(--gray-a5)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gray-a3)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* --- Paired Devices --- */}
        <section>
          <h2
            className="text-[10px] uppercase tracking-wider font-medium mb-3"
            style={{ color: "var(--gray-9)" }}
          >
            Paired Devices
            {devices.data && devices.data.length > 0 && (
              <span className="ml-2 text-[10px]" style={{ color: "var(--gray-7)" }}>
                {devices.data.length}
              </span>
            )}
          </h2>

          {devices.data?.length === 0 && (
            <EmptyState
              icon={<Smartphone size={18} />}
              description="No devices paired yet. Use the button above to pair a native app."
            />
          )}

          <div className="flex flex-col gap-2">
            {devices.data?.map((device) => {
              const person = people.data?.find((p) => p.id === device.personId);
              return (
                <div
                  key={device.id}
                  className="flex items-center gap-4 rounded-xl px-4 py-3.5 transition-colors duration-150"
                  style={{
                    background: "var(--gray-3)",
                    border: "1px solid var(--gray-a5)",
                  }}
                >
                  {/* Icon */}
                  <div
                    className="flex-shrink-0 flex items-center justify-center rounded-lg"
                    style={{ width: 38, height: 38, background: "var(--gray-a3)" }}
                  >
                    <Smartphone size={16} style={{ color: "var(--gray-9)" }} />
                  </div>

                  {/* Device info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium" style={{ color: "var(--gray-12)" }}>
                      {device.name}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      {person && (
                        <span className="flex items-center gap-1 text-xs" style={{ color: "var(--gray-9)" }}>
                          <User size={11} />
                          {person.name}
                        </span>
                      )}
                      <span className="text-xs font-mono" style={{ color: "var(--gray-7)" }}>
                        {device.tokenPrefix}...
                      </span>
                    </div>
                  </div>

                  {/* Last used */}
                  {device.lastUsedAt && (
                    <div className="flex-shrink-0 text-right hidden sm:block">
                      <span className="text-xs" style={{ color: "var(--gray-8)" }}>
                        {relativeTime(device.lastUsedAt)}
                      </span>
                    </div>
                  )}

                  {/* Revoke */}
                  <RevokeButton
                    onPress={() => revokeMutation.mutate({ deviceId: device.id })}
                    isLoading={revokeMutation.isPending}
                  />
                </div>
              );
            })}
          </div>
        </section>

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
    <PanelShell
      title="Mobile App"
      headerRight={
        !showPairing ? (
          <button
            onClick={handlePair}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg cursor-pointer transition-colors duration-150"
            style={{ color: "var(--gray-12)", background: "var(--gray-a3)", border: "1px solid var(--gray-a5)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent-a3)"; e.currentTarget.style.borderColor = "var(--accent-a5)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--gray-a3)"; e.currentTarget.style.borderColor = "var(--gray-a5)"; }}
          >
            <Plus size={14} />
            Pair device
          </button>
        ) : undefined
      }
      contentClassName="px-6 py-6 space-y-6"
    >
      {content}
    </PanelShell>
  );
}
