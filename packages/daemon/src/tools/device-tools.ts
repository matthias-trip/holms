import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { DeviceManager } from "../devices/manager.js";
import type { MemoryStore } from "../memory/store.js";

export function createDeviceQueryServer(manager: DeviceManager, memoryStore: MemoryStore) {
  const listDevices = tool(
    "list_devices",
    "List all devices in the home with their current state and any entity notes",
    {},
    async () => {
      const devices = await manager.getAllDevices();
      const notes = memoryStore.getEntityNotes();
      const devicesWithNotes = devices.map((d) => {
        const note = notes.get(d.id);
        return note ? { ...d, note: note.content } : d;
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(devicesWithNotes, null, 2),
          },
        ],
      };
    },
  );

  const getDeviceState = tool(
    "get_device_state",
    "Get the current state of a specific device by ID, including any entity note",
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
      const note = memoryStore.findByEntityId(args.deviceId);
      const result = note ? { ...device, note: note.content } : device;
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    },
  );

  const annotateEntity = tool(
    "annotate_entity",
    "Set a short factual annotation (max 300 chars) on a device — what it is, what it controls, known quirks. Overwrites any previous note. Empty string clears.",
    {
      entity_id: z.string().describe("The device ID to annotate"),
      notes: z.string().max(300).describe("The annotation text (max 300 chars). Empty string clears the note."),
    },
    async (args) => {
      const device = await manager.getDevice(args.entity_id);
      if (!device) {
        return {
          content: [
            { type: "text" as const, text: `Device ${args.entity_id} not found` },
          ],
          isError: true,
        };
      }

      const existing = memoryStore.findByEntityId(args.entity_id);

      // Empty notes = clear
      if (args.notes === "") {
        if (existing) {
          memoryStore.forget(existing.id);
          return {
            content: [
              { type: "text" as const, text: `Cleared entity note for ${device.name} (${args.entity_id})` },
            ],
          };
        }
        return {
          content: [
            { type: "text" as const, text: `No entity note exists for ${device.name} (${args.entity_id})` },
          ],
        };
      }

      // Build retrieval cues from device info + note keywords
      const noteKeywords = args.notes.split(/\s+/).slice(0, 8).join(" ");
      const retrievalCues = `${device.name} ${device.room} ${device.type} entity note identity ${noteKeywords}`;

      if (existing) {
        // Upsert — rewrite existing note
        await memoryStore.rewrite(existing.id, {
          content: args.notes,
          retrievalCues,
          tags: ["entity_note"],
        });
        return {
          content: [
            { type: "text" as const, text: `Updated entity note for ${device.name} (${args.entity_id}): "${args.notes}"` },
          ],
        };
      } else {
        // Create new note
        await memoryStore.write(args.notes, retrievalCues, ["entity_note"], args.entity_id, "entity_note");
        return {
          content: [
            { type: "text" as const, text: `Created entity note for ${device.name} (${args.entity_id}): "${args.notes}"` },
          ],
        };
      }
    },
  );

  const queryEntityNotes = tool(
    "query_entity_notes",
    "Search entity annotations by semantic similarity. Use to find devices related to a concept (e.g., 'heating', 'security', 'entrance area'). Returns matching device annotations ranked by relevance.",
    {
      query: z.string().describe("Semantic search query"),
      limit: z.number().optional().default(10).describe("Max results to return"),
    },
    async (args) => {
      const results = await memoryStore.queryEntityNotes(args.query, args.limit);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              results.map((r) => ({
                entityId: r.entityId,
                note: r.content,
                similarity: r.similarity,
              })),
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  return createSdkMcpServer({
    name: "device-query",
    version: "1.0.0",
    tools: [listDevices, getDeviceState, annotateEntity, queryEntityNotes],
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
