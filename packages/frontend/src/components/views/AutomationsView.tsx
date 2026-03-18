import { useState } from "react";
import PanelShell from "../shared/PanelShell";
import AutomationsPanel from "../AutomationsPanel";
import ReflexPanel from "../ReflexPanel";
import TriagePanel from "../TriagePanel";

export default function AutomationsView() {
  const [tab, setTab] = useState("automations");

  return (
    <PanelShell
      title="Automations"
      tabs={{
        items: [
          { key: "automations", label: "Automations" },
          { key: "reflexes", label: "Reflexes" },
          { key: "triage", label: "Triage" },
        ],
        activeKey: tab,
        onChange: setTab,
      }}
      contentClassName=""
    >
      <div className="h-full overflow-hidden">
        {tab === "automations" && <AutomationsPanel embedded />}
        {tab === "reflexes" && <ReflexPanel embedded />}
        {tab === "triage" && <TriagePanel embedded />}
      </div>
    </PanelShell>
  );
}
