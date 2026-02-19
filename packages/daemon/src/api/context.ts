import type { DeviceManager } from "../devices/manager.js";
import type { MemoryStore } from "../memory/store.js";
import type { ReflexStore } from "../reflex/store.js";
import type { ChatStore } from "../chat/store.js";
import type { ActivityStore } from "../activity/store.js";
import type { Coordinator } from "../coordinator/coordinator.js";
import type { ApprovalQueue } from "../coordinator/approval-queue.js";
import type { EventBus } from "../event-bus.js";
import type { ScheduleStore } from "../schedule/store.js";
import type { ProactiveScheduler } from "../scheduler/proactive.js";
import type { PluginManager } from "../plugins/manager.js";
import type { ChannelManager } from "../channels/manager.js";

export interface TRPCContext {
  deviceManager: DeviceManager;
  memoryStore: MemoryStore;
  reflexStore: ReflexStore;
  chatStore: ChatStore;
  activityStore: ActivityStore;
  coordinator: Coordinator;
  approvalQueue: ApprovalQueue;
  eventBus: EventBus;
  scheduleStore: ScheduleStore;
  scheduler: ProactiveScheduler;
  pluginManager: PluginManager;
  channelManager: ChannelManager;
}

export function createContext(deps: TRPCContext): TRPCContext {
  return deps;
}
