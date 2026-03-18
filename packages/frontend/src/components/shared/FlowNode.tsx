import type { ReactNode } from "react";

const CIRCLE_SIZE = 18;
const CIRCLE_CENTER = CIRCLE_SIZE / 2;

interface FlowNodeProps {
  icon: ReactNode;
  label: string;
  accentColor: string;
  bgColor: string;
  borderColor: string;
  isLast: boolean;
  delay?: number;
  children: ReactNode;
}

export default function FlowNode({
  icon,
  label,
  accentColor,
  bgColor,
  borderColor,
  isLast,
  delay = 0,
  children,
}: FlowNodeProps) {
  return (
    <div
      className="relative flex items-start gap-2.5 animate-flow-node-in"
      style={{ animationDelay: `${delay}ms` }}
    >
      {!isLast && (
        <div
          style={{
            position: "absolute",
            left: CIRCLE_CENTER,
            top: CIRCLE_SIZE + 1,
            bottom: 0,
            width: 1,
            background: "var(--gray-a5)",
          }}
        />
      )}
      <div
        className="relative flex-shrink-0 flex items-center justify-center rounded-full"
        style={{
          width: CIRCLE_SIZE,
          height: CIRCLE_SIZE,
          marginTop: 1,
          background: bgColor,
          border: `1px solid ${borderColor}`,
          color: accentColor,
          zIndex: 1,
        }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0" style={{ paddingBottom: isLast ? 0 : 8 }}>
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: accentColor, letterSpacing: "0.06em" }}
        >
          {label}
        </span>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}
