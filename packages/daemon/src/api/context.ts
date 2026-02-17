import type { DeviceManager } from "../devices/manager.js";
import type { MemoryStore } from "../memory/store.js";
import type { ReflexStore } from "../reflex/store.js";
import type { Coordinator } from "../coordinator/coordinator.js";
import type { ApprovalQueue } from "../coordinator/approval-queue.js";
import type { EventBus } from "../event-bus.js";

export interface TRPCContext {
  deviceManager: DeviceManager;
  memoryStore: MemoryStore;
  reflexStore: ReflexStore;
  coordinator: Coordinator;
  approvalQueue: ApprovalQueue;
  eventBus: EventBus;
}

export function createContext(deps: TRPCContext): TRPCContext {
  return deps;
}
