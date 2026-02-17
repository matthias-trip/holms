import { resolve } from "path";

export interface HolmsConfig {
  apiPort: number;
  dbPath: string;
  claudeConfigDir?: string;
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
}

const defaults: HolmsConfig = {
  apiPort: 3100,
  dbPath: resolve(process.cwd(), "holms.db"),
  proactive: {
    situationalCheckInterval: 5 * 60 * 1000,
    reflectionInterval: 30 * 60 * 1000,
    goalReviewInterval: 2 * 60 * 60 * 1000,
    dailySummaryHour: 22,
  },
  coordinator: {
    maxTurns: 20,
    maxBudgetUsd: 1.0,
    batchDelayMs: 500,
    observationWindowMs: 5 * 60 * 1000,
  },
};

export function loadConfig(): HolmsConfig {
  return {
    ...defaults,
    apiPort: parseInt(process.env.HOLMS_PORT ?? String(defaults.apiPort), 10),
    dbPath: process.env.HOLMS_DB_PATH ?? defaults.dbPath,
    claudeConfigDir: process.env.HOLMS_CLAUDE_CONFIG_DIR || undefined,
  };
}
