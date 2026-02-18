import type { DeviceManager } from "../devices/manager.js";
import type { MemoryStore } from "../memory/store.js";
import type { ReflexStore } from "../reflex/store.js";
import type { ChatStore } from "../chat/store.js";
import type { ActivityStore } from "../activity/store.js";
import type { Coordinator } from "../coordinator/coordinator.js";
import type { ApprovalQueue } from "../coordinator/approval-queue.js";
import type { EventBus } from "../event-bus.js";
import type { ScheduleStore } from "../schedule/store.js";
import type { SpecialistRegistry } from "../specialists/registry.js";
import type { ProactiveScheduler } from "../scheduler/proactive.js";

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
  specialistRegistry: SpecialistRegistry;
  scheduler: ProactiveScheduler;
}

export function createContext(deps: TRPCContext): TRPCContext {
  return deps;
}
