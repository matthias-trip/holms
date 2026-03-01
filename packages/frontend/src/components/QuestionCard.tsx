import { useState } from "react";
import { Check } from "lucide-react";
import type { QuestionMessageData } from "@holms/shared";
import MarkdownMessage from "./MarkdownMessage";

interface QuestionCardProps {
  data: QuestionMessageData;
  onSend: (text: string) => void;
  onSendSecret?: (questionId: string, value: string) => Promise<void>;
  answered: boolean;
}

export default function QuestionCard({ data, onSend, onSendSecret, answered }: QuestionCardProps) {
  const [freeText, setFreeText] = useState("");
  const isSecret = data.inputType === "secret";

  const handleSubmit = () => {
    if (!freeText.trim()) return;
    if (isSecret && onSendSecret) {
      onSendSecret(data.questionId, freeText.trim());
    } else {
      onSend(freeText.trim());
    }
  };

  return (
    <div className="flex justify-start">
      <img
        src="/chaticon.png"
        alt="Holms"
        className="w-8 h-8 rounded-lg mr-2 mt-0.5 flex-shrink-0"
      />
      <div
        className="max-w-[85%] rounded-xl px-4 py-2.5"
        style={{
          background: "var(--gray-3)",
          border: "1px solid var(--gray-a5)",
          color: "var(--gray-12)",
          fontSize: "13px",
          lineHeight: "1.6",
        }}
      >
        <div className="mb-2.5">
          <MarkdownMessage content={data.prompt} />
        </div>

        <div className="flex flex-wrap gap-2 mb-2.5">
          {data.options.map((option) => (
            <button
              key={option}
              onClick={() => { if (!answered) onSend(option); }}
              disabled={answered}
              className="px-3 py-1.5 rounded-lg transition-all duration-150"
              style={{
                fontSize: "13px",
                background: "var(--gray-a3)",
                border: "1px solid var(--gray-a5)",
                color: "var(--gray-11)",
                cursor: answered ? "default" : "pointer",
                opacity: answered ? 0.6 : 1,
              }}
            >
              {option}
            </button>
          ))}
        </div>

        {(data.allowFreeInput || isSecret) && !answered && (
          <div className="flex items-center gap-2">
            <input
              type={isSecret ? "password" : "text"}
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && freeText.trim()) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={isSecret ? "Enter securely..." : "Or type your answer..."}
              className="flex-1 px-3 py-1.5 rounded-lg outline-none"
              style={{
                fontSize: "13px",
                background: "var(--gray-a3)",
                border: "1px solid var(--gray-a5)",
                color: "var(--gray-12)",
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={!freeText.trim()}
              className="px-3 py-1.5 rounded-lg font-medium transition-all duration-150"
              style={{
                fontSize: "13px",
                background: freeText.trim() ? "var(--accent-9)" : "var(--gray-a3)",
                color: freeText.trim() ? "white" : "var(--gray-8)",
                cursor: freeText.trim() ? "pointer" : "default",
              }}
            >
              Send
            </button>
          </div>
        )}

        {answered && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: "var(--accent-a3)", border: "1px solid var(--accent-a5)" }}>
            <Check size={14} style={{ color: "var(--accent-9)" }} className="flex-shrink-0" />
            <span style={{ color: "var(--gray-9)", fontSize: "13px" }}>Answered</span>
          </div>
        )}
      </div>
    </div>
  );
}
