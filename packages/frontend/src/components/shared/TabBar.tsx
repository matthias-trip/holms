import type { ReactNode } from "react";

export interface TabItem {
  key: string;
  label: string;
  icon?: ReactNode;
}

interface TabBarProps {
  items: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
}

export default function TabBar({ items, activeKey, onChange }: TabBarProps) {
  return (
    <div
      className="flex gap-1 flex-shrink-0 px-6 py-2"
      style={{ borderBottom: "1px solid var(--gray-a3)" }}
    >
      {items.map(({ key, label, icon }) => {
        const active = activeKey === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150 flex-shrink-0 flex items-center gap-1.5 cursor-pointer"
            style={{
              background: active ? "var(--gray-3)" : "transparent",
              border: active ? "1px solid var(--gray-a5)" : "1px solid transparent",
              color: active ? "var(--gray-12)" : "var(--gray-8)",
            }}
          >
            {icon}
            {label}
          </button>
        );
      })}
    </div>
  );
}
