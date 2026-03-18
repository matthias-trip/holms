interface StyledInputProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export default function StyledInput({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: StyledInputProps) {
  return (
    <div>
      <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--gray-11)" }}>
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
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
