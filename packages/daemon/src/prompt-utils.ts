import { readFileSync } from "fs";
import { execSync } from "child_process";
import { resolve, dirname } from "path";

const cache = new Map<string, string>();

/**
 * Load a prompt .md file, processing native skill directives:
 *   @filename  — inline the contents of a referenced file (relative to current file)
 *   !`cmd`     — execute a shell command and inline its stdout
 */
export function loadPromptFile(filePath: string): string {
  const abs = resolve(filePath);
  const cached = cache.get(abs);
  if (cached) return cached;

  const raw = readFileSync(abs, "utf-8");
  const processed = processDirectives(raw, dirname(abs), new Set([abs]));
  cache.set(abs, processed);
  return processed;
}

function processDirectives(
  content: string,
  baseDir: string,
  seen: Set<string>,
): string {
  // Process !`cmd` — shell command injection
  let result = content.replace(/!`([^`]+)`/g, (_match, cmd: string) => {
    try {
      return execSync(cmd, { encoding: "utf-8", cwd: baseDir }).trim();
    } catch {
      return `[command failed: ${cmd}]`;
    }
  });

  // Process @filename — file inclusion (must look like a path with an extension)
  result = result.replace(
    /(?<=^|[\s(])@([\w./-]+\.\w+)/gm,
    (match, filename: string) => {
      const target = resolve(baseDir, filename);
      if (seen.has(target)) return match; // prevent circular includes
      try {
        const included = readFileSync(target, "utf-8");
        const next = new Set(seen);
        next.add(target);
        return processDirectives(included, dirname(target), next);
      } catch {
        return match; // leave as-is if file not found
      }
    },
  );

  return result;
}
