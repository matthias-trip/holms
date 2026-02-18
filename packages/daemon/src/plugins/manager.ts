import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "fs";
import { join, resolve } from "path";
import type { PluginInfo } from "@holms/shared";

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
    private pluginsDir: string,
    private stateFilePath: string,
  ) {
    this.loadState();
    this.scan();
  }

  scan(): PluginInfo[] {
    this.plugins = [];

    if (!existsSync(this.pluginsDir)) {
      mkdirSync(this.pluginsDir, { recursive: true });
      return this.plugins;
    }

    const entries = readdirSync(this.pluginsDir);

    for (const entry of entries) {
      const pluginPath = resolve(this.pluginsDir, entry);

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

      this.plugins.push({
        name,
        version: manifest.version || "0.0.0",
        description: manifest.description || "",
        author: manifest.author,
        path: pluginPath,
        enabled,
        capabilities,
      });
    }

    console.log(`[Plugins] Discovered ${this.plugins.length} plugin(s) in ${this.pluginsDir}`);
    return this.plugins;
  }

  getAll(): PluginInfo[] {
    return this.plugins;
  }

  getEnabledSdkPlugins(): Array<{ type: "local"; path: string }> {
    return this.plugins
      .filter((p) => p.enabled)
      .map((p) => ({ type: "local" as const, path: p.path }));
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
