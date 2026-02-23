import type { DataQueryDescriptor } from "@holms/shared";

/**
 * Standard DAL data-query catalog — provider-agnostic read operations.
 * Mirrors capabilities.ts but for on-demand data retrieval (read-only).
 * Providers implement queryData() to fulfil these queries.
 */

const dataQueries: Record<string, DataQueryDescriptor[]> = {
  calendar: [
    {
      name: "get_events",
      description: "Get calendar events within a time range",
      params: [
        { name: "startTime", type: "string", required: true, description: "Start time (ISO 8601)" },
        { name: "endTime", type: "string", required: true, description: "End time (ISO 8601)" },
      ],
    },
  ],

  weather: [
    {
      name: "get_forecast",
      description: "Get weather forecast",
      params: [
        { name: "type", type: "enum", required: true, options: ["daily", "hourly", "twice_daily"], description: "Forecast type" },
      ],
    },
  ],

  todo: [
    {
      name: "get_items",
      description: "Get todo list items",
      params: [
        { name: "status", type: "enum", required: false, options: ["needs_action", "completed"], description: "Filter by item status" },
      ],
    },
  ],

  camera: [
    {
      name: "get_snapshot",
      description: "Get a camera snapshot image",
      params: [],
    },
  ],
};

/** Get standard DAL data queries for a domain. Returns empty array for domains without data queries. */
export function getStandardDataQueries(domain: string): DataQueryDescriptor[] {
  return dataQueries[domain] ?? [];
}
