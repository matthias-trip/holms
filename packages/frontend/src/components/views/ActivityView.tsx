import { useState } from "react";
import PanelShell from "../shared/PanelShell";
import ActivityPanel from "../ActivityPanel";
import UsagePanel from "../UsagePanel";

export default function ActivityView() {
  const [tab, setTab] = useState("activity");

  return (
    <PanelShell
      title="Activity"
      tabs={{
        items: [
          { key: "activity", label: "Activity" },
          { key: "usage", label: "Usage" },
        ],
        activeKey: tab,
        onChange: setTab,
      }}
      contentClassName=""
    >
      <div className="h-full overflow-hidden">
        {tab === "activity" && <ActivityPanel embedded />}
        {tab === "usage" && <UsagePanel embedded />}
      </div>
    </PanelShell>
  );
}
