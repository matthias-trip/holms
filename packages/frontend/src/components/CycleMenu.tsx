import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button } from "@heroui/react";
import { Sparkles } from "lucide-react";

const CYCLE_OPTIONS: Array<{
  type: "situational" | "reflection" | "goal_review" | "daily_summary";
  label: string;
  description: string;
}> = [
  { type: "situational", label: "Situational check", description: "Assess current home state" },
  { type: "reflection", label: "Reflection", description: "Review actions and triage rules" },
  { type: "goal_review", label: "Goal review", description: "Check progress on active goals" },
  { type: "daily_summary", label: "Daily summary", description: "Summarize today's activity" },
];

export default function CycleMenu({
  onTrigger,
  disabled,
}: {
  onTrigger: (type: "situational" | "reflection" | "goal_review" | "daily_summary") => void;
  disabled: boolean;
}) {
  return (
    <Dropdown
      classNames={{
        content: "bg-[var(--gray-3)] border border-[var(--gray-5)] rounded-lg shadow-lg min-w-[220px] p-1",
      }}
    >
      <DropdownTrigger>
        <Button variant="bordered" size="sm" isDisabled={disabled} startContent={<Sparkles size={12} />}>
          Trigger cycle
        </Button>
      </DropdownTrigger>

      <DropdownMenu
        aria-label="Trigger proactive cycle"
        onAction={(key) => onTrigger(key as "situational" | "reflection" | "goal_review" | "daily_summary")}
        itemClasses={{
          base: "rounded-md px-3 py-2 data-[hover=true]:bg-[var(--gray-5)] transition-colors gap-2 cursor-default",
          title: "text-[13px] font-medium text-[var(--gray-12)]",
          description: "text-[11px] text-[var(--gray-9)]",
        }}
      >
        {CYCLE_OPTIONS.map((opt) => (
          <DropdownItem key={opt.type} description={opt.description}>
            {opt.label}
          </DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
}
