import { createDeviceQueryServer, createDeviceCommandServer } from "../tools/device-tools.js";
import { createMemoryToolsServer } from "../memory/tools.js";
import { createReflexToolsServer } from "../reflex/tools.js";
import { createApprovalToolsServer } from "./approval-queue.js";
import { createScheduleToolsServer } from "../schedule/tools.js";
import { createTriageToolsServer } from "../triage/tools.js";
import type { DeviceManager } from "../devices/manager.js";
import type { MemoryStore } from "../memory/store.js";
import type { ReflexStore } from "../reflex/store.js";
import type { ApprovalQueue } from "./approval-queue.js";
import type { ScheduleStore } from "../schedule/store.js";
import type { TriageStore } from "../triage/store.js";

type McpServer = ReturnType<typeof createDeviceQueryServer>;

export interface McpServerPool {
  servers: Record<string, McpServer>;
  allowedTools: string[];
}

export function createMcpServerPool(
  deviceManager: DeviceManager,
  memoryStore: MemoryStore,
  reflexStore: ReflexStore,
  approvalQueue: ApprovalQueue,
  scheduleStore: ScheduleStore,
  triageStore: TriageStore,
): McpServerPool {
  const servers: Record<string, McpServer> = {
    "device-query": createDeviceQueryServer(deviceManager, memoryStore),
    "device-command": createDeviceCommandServer(deviceManager),
    memory: createMemoryToolsServer(memoryStore),
    reflex: createReflexToolsServer(reflexStore),
    approval: createApprovalToolsServer(approvalQueue),
    schedule: createScheduleToolsServer(scheduleStore),
    triage: createTriageToolsServer(triageStore),
  };

  const allowedTools = Object.keys(servers).map((name) => `mcp__${name}__*`);

  return { servers, allowedTools };
}
