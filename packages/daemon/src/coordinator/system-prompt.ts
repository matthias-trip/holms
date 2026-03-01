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
  spaceSummary: string;
  peopleSummary?: string;
  goalsSummary?: string;
  memoryScope?: string;
  memoryHealth?: { count: number };
  onboarding?: boolean;
  tweakInstance?: {
    instanceId: string;
    type: string;
    status: string;
    entityCount: number;
    config: Record<string, unknown>;
  };
  setupSkill?: string;
}): string {
  let ctx = `## Current Context
- Time: ${context.currentTime}

### Spaces
${context.spaceSummary}`;

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

  if (context.tweakInstance) {
    const t = context.tweakInstance;
    ctx += `

## Mode: ADAPTER TWEAK
You are modifying an existing adapter instance. Do NOT create a new instance, start onboarding, query memories, or list adapters.
All instance details are provided below — work directly with this instance.
- Instance ID: ${t.instanceId}
- Type: ${t.type}
- Status: ${t.status}
- Entity count: ${t.entityCount}
- Current config: ${JSON.stringify(t.config)}

Work with this specific instance. Use adapters_discover to see its entities. To update config, call adapters_configure with id="${t.instanceId}" and type="${t.type}".`;
  }

  if (context.setupSkill) {
    ctx += `\n\n## Mode: ADAPTER SETUP
You are in an adapter setup flow. Follow the skill instructions below step by step.
Do NOT query memories, list adapters, or discover gateways unless the skill instructs you to.
Skip the normal "Before Answering" and "Before Acting" protocols — the skill provides the complete procedure.
When collecting credentials (API keys, passwords, tokens): use ask_user with input_type: "secret" — never as plain text.

${context.setupSkill}`;
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
