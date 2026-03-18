import type { ReactNode } from "react";
import TabBar, { type TabItem } from "./TabBar";

interface PanelShellProps {
  title: string;
  headerRight?: ReactNode;
  tabs?: { items: TabItem[]; activeKey: string; onChange: (key: string) => void };
  contentClassName?: string;
  children: ReactNode;
}

export default function PanelShell({
  title,
  headerRight,
  tabs,
  contentClassName = "p-6 space-y-2",
  children,
}: PanelShellProps) {
  return (
    <div className="h-full flex flex-col" style={{ background: "var(--gray-2)" }}>
      {/* Header */}
      <div
        className="flex justify-between items-center flex-shrink-0 px-6 h-14"
        style={{ borderBottom: "1px solid var(--gray-a3)", background: "var(--gray-1)" }}
      >
        <h3
          className="text-base font-bold"
          style={{ color: "var(--gray-12)", fontFamily: "var(--font-display)" }}
        >
          {title}
        </h3>
        {headerRight}
      </div>

      {/* Tabs */}
      {tabs && (
        <TabBar items={tabs.items} activeKey={tabs.activeKey} onChange={tabs.onChange} />
      )}

      {/* Content */}
      <div className={`flex-1 overflow-auto ${contentClassName}`}>
        <div className="content-reveal flex-1 min-h-0 flex flex-col">
          {children}
        </div>
      </div>
    </div>
  );
}
