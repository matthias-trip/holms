import type { ReactNode, CSSProperties } from "react";

interface AnimatedCardProps {
  index: number;
  delayMs?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export default function AnimatedCard({
  index,
  delayMs = 40,
  className = "",
  style,
  children,
}: AnimatedCardProps) {
  return (
    <div
      className={`animate-fade-in rounded-2xl ${className}`}
      style={{
        animationDelay: `${index * delayMs}ms`,
        background: "var(--gray-3)",
        border: "1px solid var(--gray-a5)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
