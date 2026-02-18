import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { SpecialistDomain, Device, Memory } from "@holms/shared";
import { loadPromptFile } from "../prompt-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadSkill(domain: SpecialistDomain): string {
  return loadPromptFile(resolve(__dirname, "skills", `${domain}.md`));
}

const templatePath = resolve(__dirname, "skills", "_specialist.md");

export function buildSpecialistPrompt(
  skillContent: string,
  context: {
    domain: SpecialistDomain;
    devices: Device[];
    memories: Memory[];
    currentTime: string;
    eventContext: string;
  },
): string {
  const deviceSummary =
    context.devices
      .map((d) => `- ${d.name} (${d.id}, ${d.type}): ${JSON.stringify(d.state)}`)
      .join("\n") || "No devices provided.";

  const memorySummary =
    context.memories.length > 0
      ? context.memories
          .slice(0, 15)
          .map((m) => `- [${m.type}${m.scope ? ` @${m.scope}` : ""}] ${m.key}: ${m.content}`)
          .join("\n")
      : "No relevant memories.";

  const template = loadPromptFile(templatePath);

  return `## Domain: ${context.domain}

## Current Context
- **Time**: ${context.currentTime}
- **Event/Request**: ${context.eventContext}

## Relevant Devices
${deviceSummary}

## Relevant Memories
${memorySummary}

---

${template}

---

${skillContent}`;
}
