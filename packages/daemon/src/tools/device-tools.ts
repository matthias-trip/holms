import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { DeviceManager } from "../devices/manager.js";

export function createDeviceQueryServer(manager: DeviceManager) {
  const listDevices = tool(
    "list_devices",
    "List all devices in the home with their current state",
    {},
    async () => {
      const devices = await manager.getAllDevices();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(devices, null, 2),
          },
        ],
      };
    },
  );

  const getDeviceState = tool(
    "get_device_state",
    "Get the current state of a specific device by ID",
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
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(device, null, 2) },
        ],
      };
    },
  );

  return createSdkMcpServer({
    name: "device-query",
    version: "1.0.0",
    tools: [listDevices, getDeviceState],
  });
}

export function createDeviceCommandServer(manager: DeviceManager) {
  const executeCommand = tool(
    "execute_device_command",
    "Execute a command on a device (e.g., turn_on, turn_off, set_brightness, set_temperature, lock, unlock)",
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

  return createSdkMcpServer({
    name: "device-command",
    version: "1.0.0",
    tools: [executeCommand],
  });
}
