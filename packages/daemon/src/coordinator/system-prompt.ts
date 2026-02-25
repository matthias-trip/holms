import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadPromptFile } from "../prompt-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const skillPath = resolve(__dirname, "coordinator.md");

/** Static system prompt — loaded once, cacheable by Anthropic */
export function getStaticSystemPrompt(): string {
  return loadPromptFile(skillPath);
}

/** Dynamic context — changes per turn, sent as user message prefix */
export function buildDynamicContext(context: {
  currentTime: string;
  deviceSummary: string;
  peopleSummary?: string;
  goalsSummary?: string;
  memoryScope?: string;
  memoryHealth?: { count: number };
  onboarding?: boolean;
}): string {
  let ctx = `## Current Context
- Time: ${context.currentTime}
- Devices: ${context.deviceSummary}`;

  if (context.memoryHealth) {
    const n = context.memoryHealth.count;
    if (n >= 200) {
      ctx += `\n- Memory: ${n} memories — maintenance overdue, prioritize compaction`;
    } else if (n >= 100) {
      ctx += `\n- Memory: ${n} memories — maintenance recommended during next reflection`;
    } else if (n >= 50) {
      ctx += `\n- Memory: ${n} memories`;
    }
  }

  if (context.onboarding) {
    ctx += `\n- Mode: ONBOARDING — follow the Onboarding section above`;
  }

  if (context.peopleSummary) {
    ctx += `\n- Household: ${context.peopleSummary}`;
  }

  if (context.goalsSummary) {
    ctx += `\n- Active Goals:\n${context.goalsSummary}`;
  }

  if (context.memoryScope) {
    ctx += `

## Memory Scope
You are in conversation scope: "${context.memoryScope}"
When storing personal preferences, names, or user-specific information, pass this as the \`scope\` parameter to memory_write.
When querying memories, pass this as the \`scope\` parameter to memory_query to see both global and personal memories.
Household-level knowledge (device locations, general routines, etc.) should be stored WITHOUT a scope so all users can see it.`;
  }

  return ctx;
}
