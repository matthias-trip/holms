import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { DeviceManager } from "../devices/manager.js";
import type { MemoryStore } from "../memory/store.js";

export function createDeviceQueryServer(manager: DeviceManager, memoryStore: MemoryStore) {
  const listDevices = tool(
    "list_devices",
    "List all devices in the home. Returns a compact summary per device: id, name, domain, area, state, availability, and capability names (no param schemas). Pinned memories for each device are shown inline. Devices with hasAttributes=true carry additional provider data (e.g. hourly price arrays, forecast lists) — call get_device_state to see them. Use get_device_state for full capability details before commanding a specific device.",
    {},
    async () => {
      const devices = await manager.getAllDevices();
      const pinnedByEntity = memoryStore.getPinnedByEntity();
      const compact = devices.map((d) => {
        const entry: Record<string, unknown> = {
          id: d.id,
          name: d.name,
          domain: d.domain,
          area: d.area.name,
          state: d.state,
          online: d.availability.online,
          capabilities: d.capabilities.map((c) => c.name),
        };
        if (d.attributes) entry.hasAttributes = true;
        const pinned = pinnedByEntity.get(d.id);
        if (pinned && pinned.length > 0) {
          entry.notes = pinned.map((m) => m.content);
        }
        return entry;
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(compact, null, 2),
          },
        ],
      };
    },
  );

  const getDeviceState = tool(
    "get_device_state",
    "Get full detail for a specific device including capability param schemas (types, ranges, units), metadata, extra provider attributes (e.g. hourly price arrays, forecast data), and any pinned memories. Call this before commanding a device to know valid params, and whenever list_devices shows hasAttributes=true.",
    {
      deviceId: z.string().describe("The device ID to query"),
    },
    async (args) => {
      const device = await manager.getDevice(args.deviceId);
      if (!device) {
        return {
          content: [
            { type: "text" as const, text: `Device ${args.deviceId} not found` },
          ],
          isError: true,
        };
      }
      const pinned = memoryStore.getPinnedMemories({ entityId: args.deviceId });
      const result = pinned.length > 0
        ? { ...device, notes: pinned.map((m) => m.content) }
        : device;
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    },
  );

  const getDeviceStates = tool(
    "get_device_states",
    "Get full detail for multiple devices at once. Use instead of calling get_device_state repeatedly. Returns an array of device objects with capability param schemas, metadata, and pinned memories.",
    {
      deviceIds: z.array(z.string()).describe("List of device IDs to query"),
    },
    async (args) => {
      const results = await Promise.all(
        args.deviceIds.map(async (id) => {
          const device = await manager.getDevice(id);
          if (!device) return { deviceId: id, error: "not found" };
          const pinned = memoryStore.getPinnedMemories({ entityId: id });
          return pinned.length > 0
            ? { ...device, notes: pinned.map((m) => m.content) }
            : device;
        }),
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(results, null, 2) },
        ],
      };
    },
  );

  const listAreas = tool(
    "list_areas",
    "List all areas (rooms/zones) in the home with device counts per area. Useful for spatial reasoning (e.g., 'turn off everything downstairs').",
    {},
    async () => {
      const areas = await manager.getAreas();
      const devices = await manager.getAllDevices();
      const result = areas.map((area) => ({
        ...area,
        deviceCount: devices.filter((d) => d.area.id === area.id).length,
      }));
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    },
  );

  const listAvailableEntities = tool(
    "list_available_entities",
    "List ALL entities from Home Assistant (unfiltered). Returns entity_id, friendly_name, domain, area_name, and state for every entity. Used during onboarding to discover the full home inventory before selecting which entities to track.",
    {},
    async () => {
      const entities = manager.getAvailableEntities("home_assistant");
      if (!entities) {
        return {
          content: [{ type: "text" as const, text: "No Home Assistant provider connected" }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(entities, null, 2) }],
      };
    },
  );

  const setEntityFilter = tool(
    "set_entity_filter",
    "Set the entity filter for Home Assistant — determines which entities Holms tracks and receives events from. Pass the full list of entity_ids to track. Used during onboarding after analyzing available entities.",
    {
      entityIds: z.array(z.string()).describe("List of HA entity_ids to track (e.g. ['light.living_room', 'sensor.temperature'])"),
    },
    async (args) => {
      const ok = manager.setEntityFilter("home_assistant", args.entityIds);
      if (!ok) {
        return {
          content: [{ type: "text" as const, text: "No Home Assistant provider connected" }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: `Entity filter set: ${args.entityIds.length} entities tracked` }],
      };
    },
  );

  return createSdkMcpServer({
    name: "device-query",
    version: "2.0.0",
    tools: [listDevices, getDeviceState, getDeviceStates, listAreas, listAvailableEntities, setEntityFilter],
  });
}

export function createDeviceCommandServer(manager: DeviceManager) {
  const executeCommand = tool(
    "execute_device_command",
    "Execute a command on a single device (e.g., turn_on, turn_off, set_brightness, set_temperature, lock, unlock). Before calling this, you MUST have recalled memories and confirmed no preference requires approval. If unsure, use propose_action instead.",
    {
      deviceId: z.string().describe("The device ID to command"),
      command: z.string().describe("The command to execute"),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .default({})
        .describe("Command parameters"),
    },
    async (args) => {
      const result = await manager.executeCommand(
        args.deviceId,
        args.command,
        args.params,
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result) },
        ],
        isError: !result.success,
      };
    },
  );

  const bulkExecuteCommand = tool(
    "bulk_execute_device_command",
    "Execute the same command on multiple devices at once. Use this instead of calling execute_device_command repeatedly — e.g. turn off all lights, lock all doors, set brightness on several lights. Before calling this, you MUST have recalled memories for ALL listed devices and confirmed no preference requires approval.",
    {
      deviceIds: z.array(z.string()).describe("List of device IDs to command"),
      command: z.string().describe("The command to execute on all devices"),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .default({})
        .describe("Command parameters (applied to all devices)"),
    },
    async (args) => {
      const results = await Promise.all(
        args.deviceIds.map(async (deviceId) => {
          const result = await manager.executeCommand(
            deviceId,
            args.command,
            args.params,
          );
          return { deviceId, ...result };
        }),
      );
      const anyFailed = results.some((r) => !r.success);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(results, null, 2) },
        ],
        isError: anyFailed,
      };
    },
  );

  return createSdkMcpServer({
    name: "device-command",
    version: "1.0.0",
    tools: [executeCommand, bulkExecuteCommand],
  });
}
