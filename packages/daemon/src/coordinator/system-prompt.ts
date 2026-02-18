import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadPromptFile } from "../prompt-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const skillPath = resolve(__dirname, "coordinator.md");

export function buildSystemPrompt(context: {
  currentTime: string;
  deviceSummary: string;
  recentEvents: string;
  specialists: string;
}): string {
  const skill = loadPromptFile(skillPath);

  return `${skill}

---

## Current Context
- Time: ${context.currentTime}
- Devices: ${context.deviceSummary}
- Recent activity: ${context.recentEvents}

## Available Specialists
${context.specialists}`;
}
