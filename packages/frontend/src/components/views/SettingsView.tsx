import { useState } from "react";
import PanelShell from "../shared/PanelShell";
import AdaptersPanel from "../AdaptersPanel";
import ChannelsPanel from "../ChannelsPanel";
import ZonesPanel from "../ZonesPanel";
import DeviceManagement from "../DeviceManagement";

export default function SettingsView() {
  const [tab, setTab] = useState("adapters");

  return (
    <PanelShell
      title="Settings"
      tabs={{
        items: [
          { key: "adapters", label: "Adapters" },
          { key: "channels", label: "Channels" },
          { key: "zones", label: "Zones" },
          { key: "devices", label: "Mobile App" },
        ],
        activeKey: tab,
        onChange: setTab,
      }}
      contentClassName=""
    >
      <div className="h-full overflow-hidden">
        {tab === "adapters" && <AdaptersPanel embedded />}
        {tab === "channels" && <ChannelsPanel embedded />}
        {tab === "zones" && <ZonesPanel embedded />}
        {tab === "devices" && <DeviceManagement embedded />}
      </div>
    </PanelShell>
  );
}
