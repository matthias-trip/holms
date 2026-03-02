import { useState, useEffect, useRef } from "react";
import { Button, Card, CardBody } from "@heroui/react";
import { Smartphone, Trash2, Plus, Key, LogOut, ChevronDown } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { trpc } from "../trpc";
import { useAuth } from "../context/AuthContext";

/* ── shared styled password input ──────────────────────────────────── */

function StyledPasswordInput({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--gray-11)" }}>
        {label}
      </label>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        className="w-full text-xs px-3 py-2 rounded-lg outline-none transition-colors duration-150"
        style={{
          background: "var(--gray-2)",
          border: "1px solid var(--gray-a5)",
          color: "var(--gray-12)",
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent-a5)"; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = "var(--gray-a5)"; }}
      />
    </div>
  );
}

/* ── dropdown (matches PeoplePanel) ────────────────────────────────── */

function Dropdown({ label, value, onChange, options, placeholder }: {
  label: string;
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
    <div>
      <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--gray-11)" }}>
        {label}
      </label>
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
            className="absolute z-50 w-full mt-1 rounded-lg overflow-hidden max-h-48 overflow-auto"
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
    </div>
  );
}

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

/* ── action button for settings-style triggers ─────────────────────── */

function ActionButton({
  icon,
  children,
  onPress,
  danger,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onPress: () => void;
  danger?: boolean;
}) {
  const base = danger ? "var(--gray-11)" : "var(--gray-11)";
  const hoverColor = danger ? "var(--err)" : "var(--gray-12)";
  return (
    <button
      onClick={onPress}
      className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg cursor-pointer transition-colors duration-150 self-start"
      style={{ color: base, background: "transparent", border: "1px solid var(--gray-a5)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = hoverColor;
        e.currentTarget.style.background = "var(--gray-a3)";
        if (danger) e.currentTarget.style.borderColor = "var(--err)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = base;
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderColor = "var(--gray-a5)";
      }}
    >
      {icon}
      {children}
    </button>
  );
}

/* ── main component ────────────────────────────────────────────────── */

export default function DeviceManagement() {
  const { logout } = useAuth();
  const devices = trpc.auth.devices.useQuery();
  const people = trpc.people.list.useQuery();
  const revokeMutation = trpc.auth.revokeDevice.useMutation({
    onSuccess: () => devices.refetch(),
  });
  const pairingMutation = trpc.auth.pairingCode.useMutation();
  const changePasswordMutation = trpc.auth.changePassword.useMutation();
  const revokeAllMutation = trpc.auth.revokeAllSessions.useMutation();

  const [showPairing, setShowPairing] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<string>("");
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

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

  async function handleChangePassword() {
    setPasswordError("");
    try {
      await changePasswordMutation.mutateAsync({
        currentPassword,
        newPassword,
      });
      setShowChangePassword(false);
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Failed to change password");
    }
  }

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--gray-2)" }}>
      {/* Header */}
      <div
        className="flex justify-between items-center flex-shrink-0 px-6 h-14"
        style={{ borderBottom: "1px solid var(--gray-a3)", background: "var(--gray-1)" }}
      >
        <h3 className="text-base font-bold" style={{ color: "var(--gray-12)" }}>Devices & Auth</h3>
        <Button
          size="sm"
          color="primary"
          variant="flat"
          startContent={<Plus size={14} />}
          onPress={handlePair}
        >
          Pair device
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-6 space-y-6">

        {/* --- Pairing flow --- */}
        {showPairing && (
          <Card style={{ background: "var(--gray-3)", border: "1px solid var(--gray-a5)" }}>
            <CardBody>
              <div className="flex flex-col items-center gap-3">
                {!pairingMutation.data ? (
                  /* Step 1: Select person + generate code */
                  <>
                    <p className="text-sm" style={{ color: "var(--gray-11)" }}>
                      {people.data && people.data.length > 0
                        ? "Select a person to link this device to"
                        : "Generate a pairing code for the native app"}
                    </p>

                    {people.data && people.data.length > 0 && (
                      <div className="w-full max-w-[200px]">
                        <Dropdown
                          label="Link to person"
                          value={selectedPersonId}
                          onChange={setSelectedPersonId}
                          options={people.data.map((p) => ({ value: p.id, label: p.name }))}
                          placeholder="Select person…"
                        />
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={handleGenerateCode}
                        disabled={pairingMutation.isPending || (people.data && people.data.length > 0 && !selectedPersonId)}
                        className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg cursor-pointer transition-colors duration-150"
                        style={{
                          color: pairingMutation.isPending || (people.data && people.data.length > 0 && !selectedPersonId) ? "var(--gray-8)" : "var(--gray-12)",
                          background: "var(--gray-a3)",
                          border: "1px solid var(--gray-a5)",
                          opacity: pairingMutation.isPending || (people.data && people.data.length > 0 && !selectedPersonId) ? 0.5 : 1,
                        }}
                        onMouseEnter={(e) => {
                          if (!e.currentTarget.disabled) {
                            e.currentTarget.style.background = "var(--accent-a3)";
                            e.currentTarget.style.borderColor = "var(--accent-a5)";
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "var(--gray-a3)";
                          e.currentTarget.style.borderColor = "var(--gray-a5)";
                        }}
                      >
                        {pairingMutation.isPending ? "Generating…" : "Generate code"}
                      </button>
                      <button
                        onClick={handleCancelPairing}
                        className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg cursor-pointer transition-colors duration-150"
                        style={{ color: "var(--gray-11)", background: "transparent", border: "1px solid var(--gray-a5)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gray-a3)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  /* Step 2: Show QR code */
                  <>
                    <p className="text-sm" style={{ color: "var(--gray-11)" }}>
                      Scan this QR code or enter the pairing code in the native app
                    </p>

                    <div
                      className="p-3 rounded-lg"
                      style={{ background: "var(--gray-1)" }}
                    >
                      <QRCodeSVG
                        value={JSON.stringify({
                          url: window.location.origin,
                          code: pairingMutation.data.code,
                        })}
                        size={160}
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className="text-2xl font-mono font-bold tracking-[0.2em]"
                        style={{ color: "var(--gray-12)" }}
                      >
                        {pairingMutation.data.code}
                      </span>
                    </div>

                    <p className="text-xs" style={{ color: "var(--gray-8)" }}>
                      Expires in 5 minutes
                    </p>

                    <button
                      onClick={handleCancelPairing}
                      className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg cursor-pointer transition-colors duration-150"
                      style={{ color: "var(--gray-11)", background: "transparent", border: "1px solid var(--gray-a5)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gray-a3)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </CardBody>
          </Card>
        )}

        {/* --- Paired Devices --- */}
        <section>
          <h2 className="text-sm font-medium mb-3" style={{ color: "var(--gray-11)" }}>
            Paired Devices
          </h2>

          <div className="flex flex-col gap-2">
            {devices.data?.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <Smartphone size={18} />
                </div>
                <div className="empty-state-text">
                  No devices paired yet. Use the button above to pair a native app.
                </div>
              </div>
            )}
            {devices.data?.map((device) => {
              const person = people.data?.find((p) => p.id === device.personId);
              return (
                <Card
                  key={device.id}
                  style={{
                    background: "var(--gray-3)",
                    border: "1px solid var(--gray-a5)",
                  }}
                >
                  <CardBody>
                    <div className="flex items-center gap-3">
                      <Smartphone size={16} style={{ color: "var(--gray-8)", flexShrink: 0 }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium" style={{ color: "var(--gray-12)" }}>
                          {device.name}
                        </div>
                        <div className="text-xs flex gap-2" style={{ color: "var(--gray-8)" }}>
                          <span className="font-mono">{device.tokenPrefix}...</span>
                          {person && <span>{person.name}</span>}
                          {device.lastUsedAt && (
                            <span>Last used {new Date(device.lastUsedAt).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                      <RevokeButton
                        onPress={() => revokeMutation.mutate({ deviceId: device.id })}
                        isLoading={revokeMutation.isPending}
                      />
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        </section>

        {/* --- Account Security --- */}
        <section>
          <h2 className="text-sm font-medium mb-3" style={{ color: "var(--gray-11)" }}>
            Account
          </h2>

          <div className="flex flex-col gap-2">
            {/* Change password */}
            {showChangePassword ? (
              <Card style={{ background: "var(--gray-3)", border: "1px solid var(--gray-a5)" }}>
                <CardBody>
                  <div className="flex flex-col gap-3">
                    <StyledPasswordInput
                      label="Current password"
                      value={currentPassword}
                      onChange={setCurrentPassword}
                      autoFocus
                    />
                    <StyledPasswordInput
                      label="New password"
                      value={newPassword}
                      onChange={setNewPassword}
                    />
                    {passwordError && (
                      <p className="text-xs" style={{ color: "var(--err)" }}>{passwordError}</p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        color="primary"
                        variant="flat"
                        isLoading={changePasswordMutation.isPending}
                        onPress={handleChangePassword}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="bordered"
                        onPress={() => {
                          setShowChangePassword(false);
                          setCurrentPassword("");
                          setNewPassword("");
                          setPasswordError("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            ) : (
              <ActionButton icon={<Key size={14} />} onPress={() => setShowChangePassword(true)}>
                Change password
              </ActionButton>
            )}

            {/* Sign out all sessions */}
            <ActionButton
              icon={<LogOut size={14} />}
              danger
              onPress={() => {
                revokeAllMutation.mutate();
                logout();
              }}
            >
              Sign out all sessions
            </ActionButton>

            {/* Logout */}
            <ActionButton icon={<LogOut size={14} />} onPress={logout}>
              Sign out
            </ActionButton>
          </div>
        </section>
      </div>
    </div>
  );
}
