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
  builtinPluginsDir: string;
  pluginsDir: string;
  pluginsStatePath: string;
  models: {
    coordinator: string;
    deepReason: string;
    suggestions: string;
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
}

const holmsHome = resolve(homedir(), ".holms");

const defaults: HolmsConfig = {
  apiPort: 3100,
  dbPath: resolve(process.cwd(), "holms.db"),
  hfCacheDir: resolve(holmsHome, "models"),
  builtinPluginsDir: resolve(repoRoot, "plugins"),
  pluginsDir: resolve(holmsHome, "plugins"),
  pluginsStatePath: resolve(holmsHome, "plugins.json"),
  models: {
    coordinator: "claude-sonnet-4-6",
    deepReason: "claude-sonnet-4-6",
    suggestions: "claude-haiku-4-5-20251001",
  },
  proactive: {
    situationalCheckInterval: 30 * 60 * 1000,
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
};

export function loadConfig(): HolmsConfig {
  return {
    ...defaults,
    apiPort: parseInt(process.env.HOLMS_PORT ?? String(defaults.apiPort), 10),
    dbPath: process.env.HOLMS_DB_PATH ?? defaults.dbPath,
    hfCacheDir: (process.env.HOLMS_HF_CACHE_DIR ?? defaults.hfCacheDir).replace(/^~(?=$|\/)/, homedir()),
    pluginsDir: (process.env.HOLMS_PLUGINS_DIR ?? defaults.pluginsDir).replace(/^~(?=$|\/)/, homedir()),
    pluginsStatePath: defaults.pluginsStatePath,
    claudeConfigDir: process.env.HOLMS_CLAUDE_CONFIG_DIR?.replace(/^~(?=$|\/)/, homedir()) || undefined,
    models: {
      coordinator: process.env.HOLMS_MODEL_COORDINATOR ?? defaults.models.coordinator,
      deepReason: process.env.HOLMS_MODEL_DEEP_REASON ?? defaults.models.deepReason,
      suggestions: process.env.HOLMS_MODEL_SUGGESTIONS ?? defaults.models.suggestions,
    },
    deepReason: {
      maxTurns: parseInt(process.env.HOLMS_DEEP_REASON_MAX_TURNS ?? String(defaults.deepReason.maxTurns), 10),
    },
  };
}
