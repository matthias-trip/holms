import { useState } from "react";
import ChannelList from "./channels/ChannelList";
import ConversationList from "./channels/ConversationList";
import ChannelRouting from "./channels/ChannelRouting";
import PanelShell from "./shared/PanelShell";

export default function ChannelsPanel({ embedded }: { embedded?: boolean }) {
  const [subTab, setSubTab] = useState<string>("providers");

  const content = (
    <div className="h-full overflow-hidden">
      {subTab === "providers" && <ChannelList />}
      {subTab === "conversations" && <ConversationList />}
      {subTab === "routing" && <ChannelRouting />}
    </div>
  );

  if (embedded) {
    return (
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--gray-2)" }}>
        {content}
      </div>
    );
  }

  return (
    <PanelShell
      title="Channels"
      tabs={{
        items: [
          { key: "providers", label: "Providers" },
          { key: "conversations", label: "Conversations" },
          { key: "routing", label: "Routing" },
        ],
        activeKey: subTab,
        onChange: setSubTab,
      }}
      contentClassName=""
    >
      {content}
    </PanelShell>
  );
}
