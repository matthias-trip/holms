import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ThumbsUp, ThumbsDown, Loader2 } from "lucide-react";

interface FeedbackModalProps {
  isOpen: boolean;
  sentiment: "positive" | "negative";
  onSubmit: (comment?: string) => void;
  onClose: () => void;
  isPending: boolean;
}

export default function FeedbackModal({ isOpen, sentiment, onSubmit, onClose, isPending }: FeedbackModalProps) {
  const [comment, setComment] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setComment("");
      // Focus after portal paint
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const handleSubmit = () => {
    onSubmit(comment.trim() || undefined);
    setComment("");
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="feedback-modal-backdrop" onClick={onClose}>
      <div className="feedback-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="feedback-modal-header">
          {sentiment === "positive"
            ? <ThumbsUp size={15} style={{ color: "var(--ok)" }} />
            : <ThumbsDown size={15} style={{ color: "var(--warm)" }} />}
          <span>{sentiment === "positive" ? "Helpful" : "Not helpful"}</span>
        </div>

        {/* Body */}
        <div className="feedback-modal-body">
          <p className="feedback-modal-hint">
            {sentiment === "positive"
              ? "Great to hear! What made this response useful?"
              : "Sorry about that. What could have been better?"}
          </p>
          <input
            ref={inputRef}
            type="text"
            placeholder="Add a comment (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !isPending) handleSubmit(); }}
            className="feedback-modal-input"
            disabled={isPending}
          />
        </div>

        {/* Footer */}
        <div className="feedback-modal-footer">
          <button
            className="feedback-modal-btn feedback-modal-btn-cancel"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            className="feedback-modal-btn feedback-modal-btn-submit"
            onClick={handleSubmit}
            disabled={isPending}
          >
            {isPending && <Loader2 size={13} className="animate-spin-slow" />}
            Submit
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
