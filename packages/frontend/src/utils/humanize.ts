export function humanizeToolUse(tool: string, input: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;

  if (tool === "mcp__device-command__execute_device_command") {
    const device = inp.device_id ?? inp.deviceId ?? "device";
    const cmd = inp.command ?? "action";
    return `Controlled ${device}: ${cmd}`;
  }
  if (tool === "mcp__device-query__list_devices") return "Checked device states";
  if (tool === "mcp__device-query__get_device") return `Checked ${inp.device_id ?? inp.deviceId ?? "device"}`;
  if (tool === "mcp__memory__memory_write") {
    const tags = inp.tags as string[] | undefined;
    return `Stored memory: ${tags?.length ? tags.join(", ") : "memory"}`;
  }
  if (tool === "mcp__memory__memory_query") return `Queried memories: ${inp.query ?? "all"}`;
  if (tool === "mcp__memory__memory_rewrite") return `Updated memory #${inp.id ?? "?"}`;
  if (tool === "mcp__memory__memory_forget") return `Forgot memory #${inp.id ?? "?"}`;
  if (tool === "mcp__memory__memory_reflect") return "Reflecting on memory health";
  if (tool === "mcp__deep-reason__deep_reason") return `Deep reasoning: ${(inp.problem as string)?.slice(0, 60) ?? "analyzing"}`;
  if (tool === "mcp__reflex__create_reflex") return "Created automation rule";
  if (tool === "mcp__triage__set_triage_rule") return `Set triage rule: ${inp.lane ?? "rule"}`;
  if (tool === "mcp__triage__list_triage_rules") return "Listed triage rules";
  if (tool === "mcp__triage__remove_triage_rule") return "Removed triage rule";
  if (tool === "mcp__triage__toggle_triage_rule") return `${inp.enabled ? "Enabled" : "Disabled"} triage rule`;
  if (tool.startsWith("mcp__schedule__")) return "Managed schedule";
  if (tool.startsWith("deep_reason:")) {
    const inner = tool.slice("deep_reason:".length);
    return `Deep reason: ${inner.replace(/^mcp__[^_]+(?:-[^_]+)*__/, "").replace(/_/g, " ")}`;
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
  if (tool === "mcp__memory__memory_query") return false;
  if (tool === "mcp__memory__memory_reflect") return false;
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
