import { useState, useEffect } from "react";
import { Button } from "@heroui/react";
import type { ChannelConfigField } from "@holms/shared";

const PASSWORD_MASK = "••••••••";

interface Props {
  fields: ChannelConfigField[];
  initialValues: Record<string, unknown>;
  onSave: (config: Record<string, unknown>) => void;
  onCancel: () => void;
  saving?: boolean;
  error?: string | null;
}

export default function ChannelConfigForm({ fields, initialValues, onSave, onCancel, saving, error }: Props) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  // Track which password fields the user has actively edited
  const [editedPasswords, setEditedPasswords] = useState<Set<string>>(new Set());

  useEffect(() => {
    const initial: Record<string, unknown> = {};
    for (const field of fields) {
      initial[field.key] = initialValues[field.key] ?? (field.type === "boolean" ? false : "");
    }
    setValues(initial);
    setEditedPasswords(new Set());
  }, [fields, initialValues]);

  const isMaskedPassword = (field: ChannelConfigField) =>
    field.type === "password" && initialValues[field.key] === PASSWORD_MASK;

  const handleChange = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handlePasswordFocus = (key: string) => {
    if (isMaskedPassword(fields.find((f) => f.key === key)!) && !editedPasswords.has(key)) {
      // Clear the sentinel so user can type a new value
      setValues((prev) => ({ ...prev, [key]: "" }));
      setEditedPasswords((prev) => new Set(prev).add(key));
    }
  };

  const handlePasswordBlur = (key: string) => {
    // If user focused but left it empty, restore the sentinel
    if (editedPasswords.has(key) && (values[key] === "" || values[key] === undefined)) {
      setValues((prev) => ({ ...prev, [key]: PASSWORD_MASK }));
      setEditedPasswords((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleSubmit = () => {
    const config: Record<string, unknown> = {};
    for (const field of fields) {
      const val = values[field.key];
      if (field.required || (val !== "" && val !== undefined)) {
        config[field.key] = field.type === "number" ? Number(val) : val;
      }
    }
    onSave(config);
  };

  return (
    <div className="space-y-3 mt-3 pt-3" style={{ borderTop: "1px solid var(--gray-a5)" }}>
      {fields.map((field) => (
        <div key={field.key}>
          {field.type === "boolean" ? (
            <label className="flex items-center gap-3 cursor-pointer">
              <button
                type="button"
                onClick={() => handleChange(field.key, !values[field.key])}
                className="relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0"
                style={{
                  background: values[field.key] ? "var(--accent-9)" : "var(--gray-5)",
                }}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform duration-200"
                  style={{
                    background: "white",
                    transform: values[field.key] ? "translateX(16px)" : "translateX(0)",
                  }}
                />
              </button>
              <div>
                <span className="text-xs font-medium" style={{ color: "var(--gray-12)" }}>
                  {field.label}
                  {field.required && <span style={{ color: "var(--err)" }}> *</span>}
                </span>
                {field.description && (
                  <p className="text-xs mt-0.5" style={{ color: "var(--gray-8)" }}>{field.description}</p>
                )}
              </div>
            </label>
          ) : (
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--gray-11)" }}>
                {field.label}
                {field.required && <span style={{ color: "var(--err)" }}> *</span>}
              </label>
              <div className="relative">
                <input
                  type={field.type === "password" && !showPasswords[field.key] ? "password" : field.type === "number" ? "number" : "text"}
                  value={String(values[field.key] ?? "")}
                  onChange={(e) => {
                    if (field.type === "password" && !editedPasswords.has(field.key)) {
                      setEditedPasswords((prev) => new Set(prev).add(field.key));
                    }
                    handleChange(field.key, e.target.value);
                  }}
                  placeholder={isMaskedPassword(field) && !editedPasswords.has(field.key) ? "Unchanged" : field.placeholder}
                  className="w-full text-xs px-3 py-2 rounded-lg outline-none transition-colors duration-150"
                  style={{
                    background: "var(--gray-2)",
                    border: "1px solid var(--gray-a5)",
                    color: isMaskedPassword(field) && !editedPasswords.has(field.key) ? "var(--gray-8)" : "var(--gray-12)",
                    fontFamily: field.type === "password" ? "var(--font-mono)" : "var(--font-body)",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent-a5)";
                    if (field.type === "password") handlePasswordFocus(field.key);
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "var(--gray-a5)";
                    if (field.type === "password") handlePasswordBlur(field.key);
                  }}
                />
                {field.type === "password" && (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-1.5 py-0.5 rounded transition-colors duration-150"
                    style={{ color: "var(--gray-9)" }}
                    onClick={() => setShowPasswords((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--gray-12)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--gray-9)"; }}
                  >
                    {showPasswords[field.key] ? "Hide" : "Show"}
                  </button>
                )}
              </div>
              {field.description && (
                <p className="text-xs mt-1" style={{ color: "var(--gray-8)" }}>{field.description}</p>
              )}
            </div>
          )}
        </div>
      ))}

      {error && (
        <p className="text-xs" style={{ color: "var(--err)" }}>{error}</p>
      )}

      <div className="flex gap-2 pt-1">
        <Button size="sm" color="primary" variant="flat" onPress={handleSubmit} isDisabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button size="sm" variant="bordered" onPress={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
