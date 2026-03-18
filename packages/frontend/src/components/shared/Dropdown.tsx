import { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";

interface DropdownProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}

export default function Dropdown({ label, value, onChange, options, placeholder }: DropdownProps) {
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
