import { resolve } from "path";
import { homedir } from "os";

export interface HolmsConfig {
  apiPort: number;
  dbPath: string;
  claudeConfigDir?: string;
  models: {
    coordinator: string;
    specialist: string;
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
  triage: {
    batchIntervalMs: number;
    echoWindowMs: number;
  };
}

const defaults: HolmsConfig = {
  apiPort: 3100,
  dbPath: resolve(process.cwd(), "holms.db"),
  models: {
    coordinator: "claude-sonnet-4-6",
    specialist: "claude-haiku-4-5-20251001",
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
    claudeConfigDir: process.env.HOLMS_CLAUDE_CONFIG_DIR?.replace(/^~(?=$|\/)/, homedir()) || undefined,
    models: {
      coordinator: process.env.HOLMS_MODEL_COORDINATOR ?? defaults.models.coordinator,
      specialist: process.env.HOLMS_MODEL_SPECIALIST ?? defaults.models.specialist,
    },
  };
}
