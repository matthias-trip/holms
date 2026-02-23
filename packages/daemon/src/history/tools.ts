import vm from "node:vm";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import * as stats from "simple-statistics";
import type { HistoryStore } from "./store.js";

const COMPUTE_TIMEOUT_MS = 10_000;

export function createHistoryToolsServer(store: HistoryStore) {
  const historyCatalog = tool(
    "history_catalog",
    "List available historical entities with metadata (name, unit, type, data range, sample count). Use to discover what time-series data is available before writing queries. Supports filtering by domain, name search, or value type.",
    {
      domain: z
        .string()
        .optional()
        .describe("Filter by device domain (e.g., 'light', 'sensor', 'climate')"),
      search: z
        .string()
        .optional()
        .describe("Search entity IDs and friendly names (case-insensitive partial match)"),
      value_type: z
        .enum(["numeric", "categorical", "boolean"])
        .optional()
        .describe("Filter by value type"),
    },
    async (args) => {
      const entries = await store.getCatalog({
        domain: args.domain,
        search: args.search,
        value_type: args.value_type,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { entityCount: entries.length, entities: entries },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  const historyQuery = tool(
    "history_query",
    "Execute a read-only SQL query against the DuckDB history database. Only SELECT/WITH statements allowed. 10,000 row limit, 30s timeout. IMPORTANT: Always include a WHERE entity_id = '...' filter — call history_catalog first to discover the correct entity_id. Never scan the full table with GROUP BY entity_id. Tables: entity_history (entity_id, timestamp, value_num, value_str, domain, area) and entity_catalog (entity_id, friendly_name, domain, area, unit, value_type, first_seen, last_seen, sample_count).",
    {
      sql: z
        .string()
        .describe(
          "DuckDB SQL query. Must start with SELECT or WITH. No semicolons. Use time_bucket(INTERVAL '1 hour', timestamp) for time aggregation.",
        ),
    },
    async (args) => {
      try {
        const result = await store.query(args.sql);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  rows: result.rows,
                  rowCount: result.rowCount,
                  columnTypes: Object.fromEntries(
                    result.columnNames.map((n, i) => [n, result.columnTypes[i]]),
                  ),
                  executionTimeMs: result.executionTimeMs,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  const historyCompute = tool(
    "history_compute",
    "Run a JavaScript computation in a sandboxed environment with simple-statistics. Pass data (from a previous history_query) and a script. The script has access to `data` (the array of row objects) and `stats` (simple-statistics library). The script must assign its result to `result`. 10s timeout.",
    {
      data: z
        .array(z.record(z.string(), z.unknown()))
        .describe("Array of row objects from a previous history_query result"),
      script: z
        .string()
        .describe(
          "JavaScript code to execute. Must assign output to `result`. Has `data` (row array), `stats` (simple-statistics), `Math`, `Date`, `JSON` available.",
        ),
    },
    async (args) => {
      try {
        const sandbox: Record<string, unknown> = {
          data: args.data,
          stats,
          Math,
          Date,
          JSON,
          result: undefined,
        };

        const context = vm.createContext(sandbox, {
          codeGeneration: { strings: false, wasm: false },
        });

        const script = new vm.Script(args.script, { filename: "compute.js" });

        await Promise.race([
          new Promise<void>((resolve) => {
            script.runInContext(context, { timeout: COMPUTE_TIMEOUT_MS });
            resolve();
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("Computation timed out (10s limit)")),
              COMPUTE_TIMEOUT_MS,
            ),
          ),
        ]);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ result: sandbox.result }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  return createSdkMcpServer({
    name: "history",
    version: "1.0.0",
    tools: [historyCatalog, historyQuery, historyCompute],
  });
}
