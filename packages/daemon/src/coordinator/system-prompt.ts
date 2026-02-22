import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadPromptFile } from "../prompt-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const skillPath = resolve(__dirname, "coordinator.md");

export function buildSystemPrompt(context: {
  currentTime: string;
  deviceSummary: string;
  peopleSummary?: string;
  goalsSummary?: string;
  memoryScope?: string;
  onboarding?: boolean;
}): string {
  const skill = loadPromptFile(skillPath);

  let prompt = `${skill}

---

## Current Context
- Time: ${context.currentTime}
- Devices: ${context.deviceSummary}`;

  if (context.onboarding) {
    prompt += `\n- Mode: ONBOARDING — follow the Onboarding section above`;
  }

  if (context.peopleSummary) {
    prompt += `\n- Household: ${context.peopleSummary}`;
  }

  if (context.goalsSummary) {
    prompt += `\n- Active Goals:\n${context.goalsSummary}`;
  }

  if (context.memoryScope) {
    prompt += `

## Memory Scope
You are in conversation scope: "${context.memoryScope}"
When storing personal preferences, names, or user-specific information, pass this as the \`scope\` parameter to memory_write.
When querying memories, pass this as the \`scope\` parameter to memory_query to see both global and personal memories.
Household-level knowledge (device locations, general routines, etc.) should be stored WITHOUT a scope so all users can see it.`;
  }

  return prompt;
}
