import { useState, useEffect } from "react";
import { Trash2 } from "lucide-react";

interface ConfirmDeleteButtonProps {
  onConfirm: () => void;
  label?: string;
  size?: number;
}

export default function ConfirmDeleteButton({
  onConfirm,
  label = "Confirm?",
  size = 14,
}: ConfirmDeleteButtonProps) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  if (confirming) {
    return (
      <button
        onClick={onConfirm}
        className="text-xs font-medium px-2 py-1 rounded-lg cursor-pointer transition-colors duration-150"
        style={{ color: "var(--err)", background: "var(--err-dim)", border: "none" }}
      >
        {label}
      </button>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="p-1.5 rounded-lg cursor-pointer transition-colors duration-150"
      style={{ color: "var(--gray-8)", background: "transparent", border: "none" }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--err)"; e.currentTarget.style.background = "var(--gray-a3)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--gray-8)"; e.currentTarget.style.background = "transparent"; }}
    >
      <Trash2 size={size} />
    </button>
  );
}
