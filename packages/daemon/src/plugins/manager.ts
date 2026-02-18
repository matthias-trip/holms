import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { PluginInfo } from "@holms/shared";

const execFileAsync = promisify(execFile);

interface PluginManifest {
  name?: string;
  version?: string;
  description?: string;
  author?: string;
}

interface PluginState {
  [name: string]: { enabled: boolean };
}

const CAPABILITY_MARKERS: [string, string][] = [
  [".mcp.json", "mcp"],
  ["commands", "commands"],
  ["agents", "agents"],
  ["skills", "skills"],
  ["hooks", "hooks"],
];

export class PluginManager {
  private plugins: PluginInfo[] = [];
  private state: PluginState = {};

  constructor(
    private builtinPluginsDir: string,
    private userPluginsDir: string,
    private stateFilePath: string,
  ) {
    this.loadState();
    this.scan();
  }

  scan(): PluginInfo[] {
    this.plugins = [];

    // Scan user plugins first so we know which names to skip from builtin
    const userPlugins = this.scanDir(this.userPluginsDir, "user");
    const userNames = new Set(userPlugins.map((p) => p.name));

    // Scan builtin plugins, skipping any overridden by user
    const builtinPlugins = this.scanDir(this.builtinPluginsDir, "builtin")
      .filter((p) => !userNames.has(p.name));

    this.plugins = [...builtinPlugins, ...userPlugins];

    const dirs = [this.builtinPluginsDir, this.userPluginsDir].join(", ");
    console.log(`[Plugins] Discovered ${this.plugins.length} plugin(s) from ${dirs}`);
    return this.plugins;
  }

  private scanDir(dir: string, origin: "builtin" | "user"): PluginInfo[] {
    const results: PluginInfo[] = [];

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      return results;
    }

    const entries = readdirSync(dir);

    for (const entry of entries) {
      const pluginPath = resolve(dir, entry);

      try {
        if (!statSync(pluginPath).isDirectory()) continue;
      } catch {
        continue;
      }

      const manifestPath = join(pluginPath, ".claude-plugin", "plugin.json");
      let manifest: PluginManifest = {};

      if (existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as PluginManifest;
        } catch {
          // Invalid manifest — use defaults
        }
      }

      const name = manifest.name || entry;
      const capabilities: string[] = [];

      for (const [marker, cap] of CAPABILITY_MARKERS) {
        if (existsSync(join(pluginPath, marker))) {
          capabilities.push(cap);
        }
      }

      const enabled = this.state[name]?.enabled ?? true;

      const hasPackageJson = existsSync(join(pluginPath, "package.json"));
      const hasNodeModules = existsSync(join(pluginPath, "node_modules"));
      const installed = !hasPackageJson || hasNodeModules;

      results.push({
        name,
        version: manifest.version || "0.0.0",
        description: manifest.description || "",
        author: manifest.author,
        path: pluginPath,
        enabled,
        capabilities,
        installed,
        origin,
      });
    }

    return results;
  }

  getAll(): PluginInfo[] {
    return this.plugins;
  }

  getEnabledSdkPlugins(): Array<{ type: "local"; path: string }> {
    return this.plugins
      .filter((p) => p.enabled)
      .map((p) => ({ type: "local" as const, path: p.path }));
  }

  /** Returns allowedTools patterns for all enabled plugins (MCP servers + agents). */
  getEnabledToolPatterns(): string[] {
    const patterns: string[] = [];

    for (const plugin of this.plugins) {
      if (!plugin.enabled) continue;

      // MCP servers from .mcp.json
      if (plugin.capabilities.includes("mcp")) {
        const mcpPath = join(plugin.path, ".mcp.json");
        try {
          const mcpConfig = JSON.parse(readFileSync(mcpPath, "utf-8")) as { mcpServers?: Record<string, unknown> };
          if (mcpConfig.mcpServers) {
            for (const serverName of Object.keys(mcpConfig.mcpServers)) {
              patterns.push(`mcp__${serverName}__*`);
            }
          }
        } catch {
          // skip unreadable .mcp.json
        }
      }

      // Agents from agents/ directory
      if (plugin.capabilities.includes("agents")) {
        const agentsDir = join(plugin.path, "agents");
        try {
          for (const file of readdirSync(agentsDir)) {
            if (file.endsWith(".md")) {
              patterns.push(file.replace(/\.md$/, ""));
            }
          }
        } catch {
          // skip unreadable agents dir
        }
      }
    }

    return patterns;
  }

  setEnabled(name: string, enabled: boolean): PluginInfo {
    const plugin = this.plugins.find((p) => p.name === name);
    if (!plugin) {
      throw new Error(`Plugin "${name}" not found`);
    }

    plugin.enabled = enabled;
    this.state[name] = { enabled };
    this.saveState();

    return plugin;
  }

  async install(name: string): Promise<{ success: boolean; output: string }> {
    const plugin = this.plugins.find((p) => p.name === name);
    if (!plugin) {
      return { success: false, output: `Plugin "${name}" not found` };
    }

    const packageJsonPath = join(plugin.path, "package.json");
    if (!existsSync(packageJsonPath)) {
      return { success: false, output: `Plugin "${name}" has no package.json` };
    }

    try {
      const { stdout, stderr } = await execFileAsync("npm", ["install"], {
        cwd: plugin.path,
        timeout: 120_000,
      });
      const output = [stdout, stderr].filter(Boolean).join("\n");

      // Rescan to update install status
      this.scan();

      return { success: true, output };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: message };
    }
  }

  refresh(): PluginInfo[] {
    this.loadState();
    return this.scan();
  }

  private loadState(): void {
    if (existsSync(this.stateFilePath)) {
      try {
        this.state = JSON.parse(readFileSync(this.stateFilePath, "utf-8")) as PluginState;
      } catch {
        this.state = {};
      }
    }
  }

  private saveState(): void {
    const dir = this.stateFilePath.substring(0, this.stateFilePath.lastIndexOf("/"));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2));
  }
}
