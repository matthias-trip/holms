import type { Habitat } from "../habitat/habitat.js";
import type { MemoryStore } from "../memory/store.js";
import type { ReflexStore } from "../reflex/store.js";
import type { ChatStore } from "../chat/store.js";
import type { ActivityStore } from "../activity/store.js";
import type { CoordinatorHub } from "../coordinator/coordinator-hub.js";
import type { ApprovalQueue } from "../coordinator/approval-queue.js";
import type { EventBus } from "../event-bus.js";
import type { AutomationStore } from "../automation/store.js";
import type { ProactiveScheduler } from "../scheduler/proactive.js";
import type { PluginManager } from "../plugins/manager.js";
import type { ChannelManager } from "../channels/manager.js";
import type { ChannelStore } from "../channels/store.js";
import type { PeopleStore } from "../people/store.js";
import type { TriageStore } from "../triage/store.js";
import type { GoalStore } from "../goals/store.js";
import type { HistoryStore } from "../history/store.js";
import type { SecretStore } from "../habitat/secret-store.js";
import type { HolmsConfig } from "../config.js";

export interface TRPCContext {
  habitat: Habitat;
  memoryStore: MemoryStore;
  reflexStore: ReflexStore;
  chatStore: ChatStore;
  activityStore: ActivityStore;
  hub: CoordinatorHub;
  approvalQueue: ApprovalQueue;
  eventBus: EventBus;
  automationStore: AutomationStore;
  scheduler: ProactiveScheduler;
  pluginManager: PluginManager;
  channelManager: ChannelManager;
  channelStore: ChannelStore;
  peopleStore: PeopleStore;
  triageStore: TriageStore;
  goalStore: GoalStore;
  historyStore: HistoryStore;
  secretStore: SecretStore;
  config: HolmsConfig;
}

export function createContext(deps: TRPCContext): TRPCContext {
  return deps;
}
