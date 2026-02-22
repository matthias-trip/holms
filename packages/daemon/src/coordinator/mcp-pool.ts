import type { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";

type McpServer = ReturnType<typeof createSdkMcpServer>;
type McpServerFactory = () => McpServer;

/**
 * Pool of MCP server factories. Each `query()` call must get fresh server
 * instances because the SDK's McpServer holds a single transport — concurrent
 * queries sharing the same instance will hijack each other's transport and hang.
 */
export class McpServerPool {
  private _factories: Record<string, McpServerFactory> = {};
  private _allowedTools: string[] = [];

  register(name: string, factory: McpServerFactory): void {
    this._factories[name] = factory;
    this._allowedTools.push(`mcp__${name}__*`);
  }

  /** Create a fresh set of MCP server instances (one per registered name). */
  get servers(): Record<string, McpServer> {
    const instances: Record<string, McpServer> = {};
    for (const [name, factory] of Object.entries(this._factories)) {
      instances[name] = factory();
    }
    return instances;
  }

  get allowedTools(): string[] {
    return [...this._allowedTools];
  }
}
