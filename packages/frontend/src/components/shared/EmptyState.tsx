import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title?: string;
  description: string;
  action?: ReactNode;
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      {title && (
        <p className="text-sm font-medium mb-1" style={{ color: "var(--gray-12)" }}>
          {title}
        </p>
      )}
      <div className="empty-state-text">{description}</div>
      {action}
    </div>
  );
}
