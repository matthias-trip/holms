import { useState } from "react";
import PanelShell from "../shared/PanelShell";
import GoalsPanel from "../GoalsPanel";
import MemoryPanel from "../MemoryPanel";

export default function GoalsView() {
  const [tab, setTab] = useState("goals");

  return (
    <PanelShell
      title="Goals"
      tabs={{
        items: [
          { key: "goals", label: "Goals" },
          { key: "memory", label: "Memory" },
        ],
        activeKey: tab,
        onChange: setTab,
      }}
      contentClassName=""
    >
      <div className="h-full overflow-hidden">
        {tab === "goals" && <GoalsPanel embedded />}
        {tab === "memory" && <MemoryPanel embedded />}
      </div>
    </PanelShell>
  );
}
