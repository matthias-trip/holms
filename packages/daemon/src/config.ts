import { resolve, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");

export interface HolmsConfig {
  apiPort: number;
  dbPath: string;
  hfCacheDir: string;
  claudeConfigDir?: string;
  claudeExecutablePath?: string;
  frontendDistDir: string;
  builtinPluginsDir: string;
  pluginsDir: string;
  pluginsStatePath: string;
  models: {
    coordinator: string;
    deepReason: string;
    lightweight: string;
    suggestions: string;
    analyzeHistory: string;
  };
  proactive: {
    situationalCheckInterval: number; // ms
    reflectionInterval: number;
    goalReviewInterval: number;
    dailySummaryHour: number; // 0-23
  };
  coordinator: {
    maxTurns: number;
    maxBudgetUsd: number;
    batchDelayMs: number;
    observationWindowMs: number;
  };
  deepReason: {
    maxTurns: number;
  };
  triage: {
    batchIntervalMs: number;
    echoWindowMs: number;
  };
  telemetry: {
    minIntervalMs: number;       // throttle: min ms between emissions per sensor entity
    significanceDelta: number;   // override throttle if relative change exceeds this fraction (0.1 = 10%)
  };
  history: {
    dbPath: string;
    flushIntervalMs: number;
    flushBatchSize: number;
    catalogRefreshMs: number;
    ingestionEpsilon: number;    // skip storing if numeric value changed by less than this
    minStorageIntervalMs: number; // max one row per entity per this many ms (default 60s)
  };
  activity: {
    maxAgeMs: number;            // auto-purge activities older than this (default 12h)
  };
}

const holmsHome = resolve(homedir(), ".holms");

const defaults: HolmsConfig = {
  apiPort: 3100,
  frontendDistDir: resolve(repoRoot, "packages", "frontend", "dist"),
  dbPath: resolve(process.cwd(), "holms.db"),
  hfCacheDir: resolve(holmsHome, "models"),
  builtinPluginsDir: resolve(repoRoot, "adapters"),
  pluginsDir: resolve(holmsHome, "adapters"),
  pluginsStatePath: resolve(holmsHome, "plugins.json"),
  models: {
    coordinator: "claude-sonnet-4-6",
    deepReason: "claude-opus-4-6",
    lightweight: "claude-haiku-4-5-20251001",
    suggestions: "claude-haiku-4-5-20251001",
    analyzeHistory: "claude-sonnet-4-6",
  },
  proactive: {
    situationalCheckInterval: 2 * 60 * 60 * 1000,
    reflectionInterval: 4 * 60 * 60 * 1000,
    goalReviewInterval: 24 * 60 * 60 * 1000,
    dailySummaryHour: 22,
  },
  coordinator: {
    maxTurns: 20,
    maxBudgetUsd: 1.0,
    batchDelayMs: 500,
    observationWindowMs: 5 * 60 * 1000,
  },
  deepReason: {
    maxTurns: 10,
  },
  triage: {
    batchIntervalMs: 2 * 60 * 1000,
    echoWindowMs: 5000,
  },
  telemetry: {
    minIntervalMs: 60_000,
    significanceDelta: 0.1,
  },
  history: {
    dbPath: resolve(process.cwd(), "holms-history.duckdb"),
    flushIntervalMs: 5000,
    flushBatchSize: 100,
    catalogRefreshMs: 3600000,
    ingestionEpsilon: 0.01,
    minStorageIntervalMs: 60_000,
  },
  activity: {
    maxAgeMs: 12 * 3600_000,
  },
};

export function loadConfig(): HolmsConfig {
  return {
    ...defaults,
    apiPort: parseInt(process.env.HOLMS_PORT ?? String(defaults.apiPort), 10),
    frontendDistDir: process.env.HOLMS_FRONTEND_DIST ?? defaults.frontendDistDir,
    dbPath: process.env.HOLMS_DB_PATH ?? defaults.dbPath,
    hfCacheDir: (process.env.HOLMS_HF_CACHE_DIR ?? defaults.hfCacheDir).replace(/^~(?=$|\/)/, homedir()),
    pluginsDir: (process.env.HOLMS_ADAPTERS_DIR ?? process.env.HOLMS_PLUGINS_DIR ?? defaults.pluginsDir).replace(/^~(?=$|\/)/, homedir()),
    pluginsStatePath: resolve(dirname(process.env.HOLMS_DB_PATH ?? defaults.dbPath), "plugins.json"),
    claudeConfigDir: process.env.HOLMS_CLAUDE_CONFIG_DIR?.replace(/^~(?=$|\/)/, homedir()) || undefined,
    claudeExecutablePath: process.env.HOLMS_CLAUDE_EXECUTABLE_PATH || undefined,
    models: {
      coordinator: process.env.HOLMS_MODEL_COORDINATOR ?? defaults.models.coordinator,
      deepReason: process.env.HOLMS_MODEL_DEEP_REASON ?? defaults.models.deepReason,
      lightweight: process.env.HOLMS_MODEL_LIGHTWEIGHT ?? defaults.models.lightweight,
      suggestions: process.env.HOLMS_MODEL_SUGGESTIONS ?? defaults.models.suggestions,
      analyzeHistory: process.env.HOLMS_MODEL_ANALYZE_HISTORY ?? defaults.models.analyzeHistory,
    },
    deepReason: {
      maxTurns: parseInt(process.env.HOLMS_DEEP_REASON_MAX_TURNS ?? String(defaults.deepReason.maxTurns), 10),
    },
    history: {
      ...defaults.history,
      dbPath: process.env.HOLMS_HISTORY_DB_PATH ?? defaults.history.dbPath,
    },
  };
}
