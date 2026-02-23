import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { TriageStore } from "./store.js";
import type { ActivityStore } from "../activity/store.js";

export function createTriageToolsServer(store: TriageStore, activityStore?: ActivityStore) {
  const setTriageRule = tool(
    "set_triage_rule",
    "Create a triage rule to control how device events reach you. Events are classified into three lanes:\n- **immediate**: Wakes you right away. Use for events requiring instant reasoning — binary sensor changes, security events, significant state changes.\n- **batched**: Accumulated and delivered every ~2 minutes. Use for gradual changes that don't need instant response — temperature drift, energy updates.\n- **silent**: Updates device state but never wakes you. Use for pure telemetry noise — unchanged values, periodic heartbeats, command confirmations.\n\nRules are matched by specificity: deviceId > deviceDomain > room > wildcard. First match wins.",
    {
      condition: z
        .object({
          deviceId: z.string().optional().describe("Specific device ID to match"),
          deviceDomain: z
            .string()
            .optional()
            .describe("Match all devices of this domain (e.g. sensor, light, climate, binary_sensor, switch, lock, cover, media_player)"),
          eventType: z.string().optional().describe("Event type to match (e.g. state_changed, motion_detected)"),
          room: z.string().optional().describe("Match all devices in this room"),
          area: z.string().optional().describe("Match all devices in this area (same as room — use for area-based filtering)"),
          stateKey: z.string().optional().describe("Numeric state key for delta threshold matching (e.g. temperature)"),
          deltaThreshold: z
            .number()
            .optional()
            .describe("Change must exceed this value to match the rule. Used with stateKey."),
        })
        .describe("Conditions for matching events"),
      lane: z
        .enum(["immediate", "batched", "silent"])
        .describe("Which triage lane to route matching events to"),
      reason: z.string().describe("Why this rule exists — for your future reference"),
    },
    async (args) => {
      const existing = store.findByCondition(args.condition);
      if (existing) {
        const updated = store.update(existing.id, {
          lane: args.lane,
          reason: args.reason,
          enabled: true,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Updated existing triage rule "${existing.id}": route ${args.lane} — ${args.reason}`,
            },
          ],
        };
      }
      const rule = store.create({
        condition: args.condition,
        lane: args.lane,
        reason: args.reason,
        createdBy: "coordinator",
        enabled: true,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Created triage rule "${rule.id}": route ${args.lane} — ${args.reason}`,
          },
        ],
      };
    },
  );

  const listTriageRules = tool(
    "list_triage_rules",
    "List all triage rules, showing their conditions, lanes, and status. Use during reflection to review and tune your event filtering.",
    {},
    async () => {
      const rules = store.getAll();
      return {
        content: [
          {
            type: "text" as const,
            text:
              rules.length === 0
                ? "No triage rules configured. Using built-in defaults."
                : JSON.stringify(rules, null, 2),
          },
        ],
      };
    },
  );

  const removeTriageRule = tool(
    "remove_triage_rule",
    "Remove a triage rule by its ID",
    {
      id: z.string().describe("The triage rule ID to remove"),
    },
    async (args) => {
      const removed = store.remove(args.id);
      return {
        content: [
          {
            type: "text" as const,
            text: removed
              ? `Removed triage rule "${args.id}"`
              : `No triage rule found with ID "${args.id}"`,
          },
        ],
      };
    },
  );

  const toggleTriageRule = tool(
    "toggle_triage_rule",
    "Enable or disable a triage rule",
    {
      id: z.string().describe("The triage rule ID to toggle"),
      enabled: z.boolean().describe("Whether to enable (true) or disable (false)"),
    },
    async (args) => {
      const rule = store.toggle(args.id, args.enabled);
      return {
        content: [
          {
            type: "text" as const,
            text: rule
              ? `Triage rule "${args.id}" is now ${args.enabled ? "enabled" : "disabled"}`
              : `No triage rule found with ID "${args.id}"`,
          },
        ],
      };
    },
  );

  const getTriageStats = tool(
    "get_triage_stats",
    "Get event triage statistics from recent history. Shows per-device event counts by lane, delta stats (avg/min/max for numeric changes), and event rate. Use during reflection to identify noisy devices that should be silenced or under-monitored devices that should be escalated.",
    {
      sinceHours: z.number().optional().describe("How many hours back to look (default: 4)"),
    },
    async (args) => {
      if (!activityStore) {
        return {
          content: [{ type: "text" as const, text: "Triage stats unavailable (no activity store)." }],
        };
      }

      const hours = args.sinceHours ?? 4;
      const sinceTs = Date.now() - hours * 3600_000;

      const activities = activityStore.getActivities(10000);
      const triageEvents = activities.filter(
        (a) => a.type === "triage_classify" && a.timestamp >= sinceTs,
      );

      if (triageEvents.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No triage events in the last ${hours}h.` }],
        };
      }

      // Group by deviceId
      const byDevice = new Map<string, {
        deviceName?: string;
        immediate: number;
        batched: number;
        silent: number;
        deltas: number[];
      }>();

      for (const ev of triageEvents) {
        const data = ev.data as {
          deviceId: string;
          lane: string;
          deviceName?: string;
          delta?: number;
        };
        let entry = byDevice.get(data.deviceId);
        if (!entry) {
          entry = { deviceName: data.deviceName, immediate: 0, batched: 0, silent: 0, deltas: [] };
          byDevice.set(data.deviceId, entry);
        }
        if (data.lane === "immediate") entry.immediate++;
        else if (data.lane === "batched") entry.batched++;
        else if (data.lane === "silent") entry.silent++;
        if (typeof data.delta === "number") entry.deltas.push(Math.abs(data.delta));
      }

      // Sort by total count descending
      const sorted = [...byDevice.entries()].sort(
        (a, b) => (b[1].immediate + b[1].batched + b[1].silent) - (a[1].immediate + a[1].batched + a[1].silent),
      );

      const lines: string[] = [`Event triage stats (last ${hours}h):`];
      for (const [deviceId, stats] of sorted) {
        const total = stats.immediate + stats.batched + stats.silent;
        const rate = (total / hours).toFixed(1);
        const namePart = stats.deviceName ? ` (${stats.deviceName})` : "";
        const laneParts: string[] = [];
        if (stats.batched > 0) laneParts.push(`batched: ${stats.batched}`);
        if (stats.immediate > 0) laneParts.push(`immediate: ${stats.immediate}`);
        if (stats.silent > 0) laneParts.push(`silent: ${stats.silent}`);
        lines.push(`${deviceId}${namePart}: ${total} total (${rate}/hr) — ${laneParts.join(", ")}`);
        if (stats.deltas.length > 0) {
          const avg = (stats.deltas.reduce((a, b) => a + b, 0) / stats.deltas.length).toFixed(1);
          const min = Math.min(...stats.deltas).toFixed(1);
          const max = Math.max(...stats.deltas).toFixed(1);
          lines.push(`  delta: avg=${avg}, min=${min}, max=${max}`);
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );

  return createSdkMcpServer({
    name: "triage",
    version: "1.0.0",
    tools: [setTriageRule, listTriageRules, removeTriageRule, toggleTriageRule, getTriageStats],
  });
}
