export function humanizeToolUse(tool: string, input: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;

  if (tool === "mcp__device-command__execute_device_command") {
    const device = inp.device_id ?? inp.deviceId ?? "device";
    const cmd = inp.command ?? "action";
    return `Controlled ${device}: ${cmd}`;
  }
  if (tool === "mcp__device-query__list_devices") return "Checked device states";
  if (tool === "mcp__device-query__get_device") return `Checked ${inp.device_id ?? inp.deviceId ?? "device"}`;
  if (tool === "mcp__memory__remember") return `Stored memory: ${inp.key ?? ""}`;
  if (tool === "mcp__memory__recall") return `Recalled memories about ${inp.query ?? ""}`;
  if (tool === "mcp__memory__recall_multi") {
    const queries = inp.queries as string[] | undefined;
    return queries ? `Recalled memories about ${queries.join(", ")}` : "Recalled memories (multi)";
  }
  if (tool.match(/^mcp__memory-\w+__remember$/)) {
    const scope = tool.match(/^mcp__memory-(\w+)__/)?.[1] ?? "scoped";
    return `Stored ${scope} memory: ${inp.key ?? ""}`;
  }
  if (tool.match(/^mcp__memory-\w+__recall$/)) {
    const scope = tool.match(/^mcp__memory-(\w+)__/)?.[1] ?? "scoped";
    return `Recalled ${scope} memories about ${inp.query ?? ""}`;
  }
  if (tool.match(/^mcp__memory-\w+__recall_multi$/)) {
    const scope = tool.match(/^mcp__memory-(\w+)__/)?.[1] ?? "scoped";
    const queries = inp.queries as string[] | undefined;
    return queries ? `Recalled ${scope} memories about ${queries.join(", ")}` : `Recalled ${scope} memories (multi)`;
  }
  if (tool === "mcp__dispatch__dispatch_to_specialist") return `Consulted ${inp.specialist ?? "specialist"} specialist`;
  if (tool === "mcp__reflex__create_reflex") return "Created automation rule";
  if (tool === "mcp__triage__set_triage_rule") return `Set triage rule: ${inp.lane ?? "rule"}`;
  if (tool === "mcp__triage__list_triage_rules") return "Listed triage rules";
  if (tool === "mcp__triage__remove_triage_rule") return "Removed triage rule";
  if (tool === "mcp__triage__toggle_triage_rule") return `${inp.enabled ? "Enabled" : "Disabled"} triage rule`;
  if (tool.startsWith("mcp__schedule__")) return "Managed schedule";
  if (tool.startsWith("specialist:")) {
    const parts = tool.split(":");
    return `${parts[1] ?? "specialist"}: ${parts[2] ?? "action"}`;
  }
  // Strip mcp__ prefix for readability
  if (tool.startsWith("mcp__")) {
    const clean = tool.replace(/^mcp__/, "").replace(/__/g, " / ");
    return clean;
  }
  return tool;
}

/** Returns true if the tool use is a write action (not read-only) */
export function isWriteAction(tool: string): boolean {
  // Read-only tools to filter out
  if (tool === "mcp__device-query__list_devices") return false;
  if (tool === "mcp__device-query__get_device") return false;
  if (tool === "mcp__memory__recall") return false;
  if (tool === "mcp__memory__recall_multi") return false;
  if (tool.match(/^mcp__memory-\w+__recall$/)) return false;
  if (tool.match(/^mcp__memory-\w+__recall_multi$/)) return false;
  if (tool === "mcp__triage__list_triage_rules") return false;
  return true;
}

export function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
