import {
  runAdapter,
  type Adapter,
  type AdapterFactory,
  type RegistrationResult,
  type PairResult,
  type PropertyName,
} from "@holms/adapter-sdk";
import type {
  BrinkAdapterConfig,
  ParameterDescriptor,
  MenuItem,
} from "./types.js";
import {
  FAN_SPEED_MAP,
  MODE_MAP,
  BYPASS_MAP,
  PARAM_KEYWORDS,
} from "./types.js";
import { BrinkClient } from "./brink-client.js";

export class BrinkAdapter implements Adapter {
  private client: BrinkClient | null = null;
  private configured: boolean;
  private systemId: number = 0;
  private gatewayId: number = 0;
  private pollInterval: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /** Matched parameter descriptors keyed by semantic name */
  private paramCache = new Map<string, ParameterDescriptor>();
  /** Last translated air_quality state for diff detection */
  private lastState: Record<string, unknown> | null = null;

  constructor(config: Record<string, unknown>) {
    const cfg = config as unknown as BrinkAdapterConfig;
    this.pollInterval = Math.max(30, cfg.pollInterval ?? 60) * 1000;

    const missing = ["username", "password", "systemId", "gatewayId"]
      .filter((k) => !cfg[k as keyof BrinkAdapterConfig]);
    if (missing.length > 0) {
      console.warn(`Missing config fields: ${missing.join(", ")}. Received keys: ${Object.keys(config).join(", ") || "(empty)"}`);
      this.configured = false;
      return;
    }

    this.configured = true;
    this.systemId = cfg.systemId!;
    this.gatewayId = cfg.gatewayId!;
    this.client = new BrinkClient(cfg.username!, cfg.password!);
  }

  async register(): Promise<RegistrationResult> {
    if (!this.configured || !this.client) {
      console.warn("Skipping registration — adapter not configured");
      return { entities: [], groups: [] };
    }

    await this.client.login();
    console.info(`Logged in, fetching state for gateway=${this.gatewayId} system=${this.systemId}`);
    const state = await this.client.getState(this.gatewayId, this.systemId);
    console.info(`Got ${state.menuItems?.length ?? 0} menu items`);
    this.indexParameters(state.menuItems);

    return {
      entities: [
        {
          entityId: `brink-${this.systemId}`,
          displayName: "Brink Ventilation",
          properties: [
            {
              property: "air_quality",
              features: ["purification"],
              commandHints: {
                fan_speed: { type: "number", values: [0, 1, 2, 3], description: "Fan level: 0=standby, 1=low, 2=medium, 3=high. Automatically sets mode to manual." },
                mode: { type: "string", values: ["auto", "manual", "holiday", "party", "night"], description: "Operating mode. 'auto' = on-demand ventilation (sensor-driven). Setting fan_speed implicitly sets mode to 'manual'." },
                fan_on: { type: "boolean", description: "true defaults to level 2 (medium) + manual mode. false = standby (level 0)." },
              },
            },
          ],
        },
      ],
    };
  }

  async observe(entityId: string, property: PropertyName): Promise<Record<string, unknown>> {
    if (!this.configured || !this.client) throw new Error("Adapter not configured");
    if (property !== "air_quality") throw new Error(`Unsupported property: ${property}`);

    const state = await this.client.getState(this.gatewayId, this.systemId);
    this.indexParameters(state.menuItems);
    const translated = this.translateState();
    this.lastState = translated;
    return translated;
  }

  async execute(
    entityId: string,
    property: PropertyName,
    command: Record<string, unknown>,
  ): Promise<void> {
    if (!this.configured || !this.client) throw new Error("Adapter not configured");
    if (property !== "air_quality") throw new Error(`Unsupported property: ${property}`);

    const params = this.translateCommand(command);
    if (params.length === 0) throw new Error("No writable parameters for command");

    console.info(`Writing ${params.length} param(s): ${JSON.stringify(params)}`);
    await this.client.writeParameters(this.gatewayId, this.systemId, params);
    console.info("Write succeeded");
  }

  async subscribe(
    cb: (entityId: string, property: PropertyName, state: Record<string, unknown>) => void,
  ): Promise<void> {
    if (!this.configured || !this.client) return;

    const entityId = `brink-${this.systemId}`;

    this.pollTimer = setInterval(async () => {
      try {
        const state = await this.client!.getState(this.gatewayId, this.systemId);
        this.indexParameters(state.menuItems);
        const translated = this.translateState();

        if (JSON.stringify(translated) !== JSON.stringify(this.lastState)) {
          this.lastState = translated;
          cb(entityId, "air_quality", translated);
        }
      } catch (err) {
        console.warn("Poll failed:", err instanceof Error ? err.message : String(err));
      }
    }, this.pollInterval);
  }

  async pair(params: Record<string, unknown>): Promise<PairResult> {
    const username = params.username as string;
    const password = params.password as string;

    if (!username || !password) {
      return { success: false, error: "username and password are required" };
    }

    try {
      const client = new BrinkClient(username, password);
      await client.login();
      const systems = await client.getSystemList();
      console.info(`getSystemList returned ${systems.length} system(s): ${JSON.stringify(systems)}`);

      if (systems.length === 0) {
        return { success: false, error: "No ventilation systems found on this account" };
      }

      if (systems.length === 1) {
        const sys = systems[0];
        return {
          success: true,
          credentials: {
            username,
            password,
            systemId: sys.id,
            gatewayId: sys.gatewayId,
          },
          message: `Found system: ${sys.name}`,
        };
      }

      // Multiple systems — return first but list all in message
      const sys = systems[0];
      const list = systems
        .map((s) => `- ${s.name} (SystemId: ${s.id}, GatewayId: ${s.gatewayId})`)
        .join("\n");

      return {
        success: true,
        credentials: {
          username,
          password,
          systemId: sys.id,
          gatewayId: sys.gatewayId,
        },
        message: `Found ${systems.length} systems:\n${list}\n\nDefaulting to "${sys.name}". Use ask_user to let the user pick if needed.`,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async ping(): Promise<boolean> {
    if (!this.configured || !this.client) return true;
    return this.client.ping();
  }

  async destroy(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.client = null;
    this.paramCache.clear();
    this.lastState = null;
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  /**
   * Walk the nested menuItems tree, find known parameters by description text,
   * and cache their descriptors (including valueId needed for writes).
   */
  private indexParameters(menuItems: MenuItem[]): void {
    const flat = this.flattenDescriptors(menuItems);

    for (const desc of flat) {
      // Check uiId, name, and description fields for keyword matches
      const searchFields = [
        desc.uiId ?? "",
        desc.name ?? "",
        desc.description ?? "",
      ].map((f) => f.toLowerCase());

      const matchesKeyword = (keywords: readonly string[]): boolean =>
        keywords.some((kw) => searchFields.some((f) => f.includes(kw.toLowerCase())));

      if (!this.paramCache.has("fanSpeed") && matchesKeyword(PARAM_KEYWORDS.fanSpeed)) {
        this.paramCache.set("fanSpeed", desc);
      }
      if (!this.paramCache.has("mode") && matchesKeyword(PARAM_KEYWORDS.mode)) {
        this.paramCache.set("mode", desc);
      }
      if (!this.paramCache.has("filterAlarm") && matchesKeyword(PARAM_KEYWORDS.filterAlarm)) {
        this.paramCache.set("filterAlarm", desc);
      }
      if (!this.paramCache.has("bypass") && matchesKeyword(PARAM_KEYWORDS.bypass)) {
        this.paramCache.set("bypass", desc);
      }
    }
  }

  private flattenDescriptors(menuItems: MenuItem[]): ParameterDescriptor[] {
    const result: ParameterDescriptor[] = [];
    for (const item of menuItems) {
      // Direct parameterDescriptors (legacy structure)
      if (item.parameterDescriptors) {
        result.push(...item.parameterDescriptors);
      }
      // Pages contain parameterDescriptors in current API
      if (item.pages) {
        for (const page of item.pages) {
          if (page.parameterDescriptors) {
            result.push(...page.parameterDescriptors);
          }
        }
      }
      if (item.menuItems) {
        result.push(...this.flattenDescriptors(item.menuItems));
      }
    }
    return result;
  }

  private translateState(): Record<string, unknown> {
    const state: Record<string, unknown> = {};

    const mode = this.paramCache.get("mode");
    if (mode) {
      state.mode = MODE_MAP[mode.value] ?? "unknown";
    }

    const fanSpeed = this.paramCache.get("fanSpeed");
    if (fanSpeed) {
      // When mode=auto(0), the system is on-demand — fan_speed reflects current demand level
      state.fan_speed = FAN_SPEED_MAP[fanSpeed.value] ?? 0;
      state.fan_on = fanSpeed.value > 0;
    }

    const filterAlarm = this.paramCache.get("filterAlarm");
    if (filterAlarm) {
      state.filter_alarm = filterAlarm.value !== 0;
    }

    const bypass = this.paramCache.get("bypass");
    if (bypass) {
      state.bypass = BYPASS_MAP[bypass.value] ?? "unknown";
    }

    return state;
  }

  private translateCommand(command: Record<string, unknown>): Array<{ ValueId: number; Value: string }> {
    const params: Array<{ ValueId: number; Value: string }> = [];
    const fanSpeedParam = this.paramCache.get("fanSpeed");
    const modeParam = this.paramCache.get("mode");

    // Setting a mode explicitly (auto, manual, holiday, party, night)
    // Per Homey: mode=auto(0) activates on-demand without changing fan level.
    // Other modes just set the mode register directly.
    if (typeof command.mode === "string") {
      if (modeParam) {
        const modeValue = this.modeStringToInt(command.mode as string);
        if (modeValue !== null) {
          params.push({ ValueId: modeParam.valueId, Value: String(modeValue) });
        }
      }
      if (typeof command.fan_speed !== "number" && command.fan_on === undefined) {
        return params;
      }
    }

    // Handle fan_on: false → standby (level 0, mode=manual)
    if (command.fan_on === false) {
      if (modeParam && !params.some((p) => p.ValueId === modeParam.valueId)) {
        params.push({ ValueId: modeParam.valueId, Value: "1" });
      }
      if (fanSpeedParam) {
        params.push({ ValueId: fanSpeedParam.valueId, Value: "0" });
      }
      return params;
    }

    // Handle fan_speed: set level + mode=manual (per Homey: levels 0-3 require manual mode)
    if (typeof command.fan_speed === "number") {
      const level = this.clampFanLevel(command.fan_speed as number);
      if (modeParam && !params.some((p) => p.ValueId === modeParam.valueId)) {
        params.push({ ValueId: modeParam.valueId, Value: "1" });
      }
      if (fanSpeedParam) {
        params.push({ ValueId: fanSpeedParam.valueId, Value: String(level) });
      }
    } else if (command.fan_on === true) {
      // fan_on: true without speed → default to medium (level 2), mode=manual
      if (modeParam && !params.some((p) => p.ValueId === modeParam.valueId)) {
        params.push({ ValueId: modeParam.valueId, Value: "1" });
      }
      if (fanSpeedParam) {
        params.push({ ValueId: fanSpeedParam.valueId, Value: "2" });
      }
    }

    return params;
  }

  private clampFanLevel(level: number): number {
    if (level <= 0) return 0;
    if (level >= 3) return 3;
    return Math.round(level);
  }

  private modeStringToInt(mode: string): number | null {
    for (const [key, value] of Object.entries(MODE_MAP)) {
      if (value === mode) return Number(key);
    }
    return null;
  }
}

const createBrinkAdapter: AdapterFactory = (config) => new BrinkAdapter(config);
export default createBrinkAdapter;

runAdapter(createBrinkAdapter);
