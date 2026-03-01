import {
  runAdapter,
  type Adapter,
  type AdapterFactory,
  type RegistrationResult,
  type PropertyName,
  type QueryResult,
} from "@holms/adapter-sdk";
import type { PirateWeatherConfig } from "./types.js";
import { PirateWeatherClient } from "./api-client.js";
import { translateCurrentState, translateForecastItems } from "./translators.js";

const STATE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const DEFAULT_POLL_INTERVAL = 15 * 60 * 1000; // 15 minutes

export class PirateWeatherAdapter implements Adapter {
  private client: PirateWeatherClient;
  private config: PirateWeatherConfig;
  private entityId: string;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private cachedState: Record<string, unknown> | null = null;
  private cachedStateTime = 0;

  constructor(config: Record<string, unknown>) {
    const cfg = config as unknown as PirateWeatherConfig;
    this.config = cfg;
    this.entityId = `weather-${cfg.latitude}-${cfg.longitude}`;
    this.client = new PirateWeatherClient(
      cfg.api_key,
      cfg.latitude,
      cfg.longitude,
      cfg.units ?? "si",
    );
  }

  async register(): Promise<RegistrationResult> {
    // Validate API key by fetching initial data
    const data = await this.client.fetch();
    this.cachedState = translateCurrentState(data.currently);
    this.cachedStateTime = Date.now();

    const displayName = this.config.location_name
      ? `Weather - ${this.config.location_name}`
      : `Weather (${this.config.latitude}, ${this.config.longitude})`;

    return {
      entities: [
        {
          entityId: this.entityId,
          displayName,
          properties: [
            {
              property: "weather",
              features: ["current", "hourly_forecast", "daily_forecast", "alerts"],
            },
          ],
        },
      ],
    };
  }

  async observe(entityId: string, _property: PropertyName): Promise<Record<string, unknown>> {
    if (entityId !== this.entityId) throw new Error(`Unknown entity: ${entityId}`);

    // Return cached state if fresh enough
    if (this.cachedState && Date.now() - this.cachedStateTime < STATE_CACHE_TTL) {
      return this.cachedState;
    }

    const data = await this.client.fetch();
    this.cachedState = translateCurrentState(data.currently);
    this.cachedStateTime = Date.now();
    return this.cachedState;
  }

  async query(
    entityId: string,
    _property: PropertyName,
    params: Record<string, unknown>,
  ): Promise<QueryResult> {
    if (entityId !== this.entityId) throw new Error(`Unknown entity: ${entityId}`);

    const data = await this.client.fetch();
    // Also update state cache since we have fresh data
    this.cachedState = translateCurrentState(data.currently);
    this.cachedStateTime = Date.now();

    const items = translateForecastItems(
      data.hourly.data,
      data.daily.data,
      {
        from: params.from as number | undefined,
        to: params.to as number | undefined,
        granularity: params.granularity as "hourly" | "daily" | undefined,
      },
    );

    return { items, total: items.length };
  }

  async subscribe(
    cb: (entityId: string, property: PropertyName, state: Record<string, unknown>) => void,
  ): Promise<void> {
    const interval = this.config.poll_interval_ms ?? DEFAULT_POLL_INTERVAL;

    this.pollTimer = setInterval(async () => {
      try {
        const data = await this.client.fetch();
        const state = translateCurrentState(data.currently);

        // Only emit if state changed
        if (JSON.stringify(state) !== JSON.stringify(this.cachedState)) {
          this.cachedState = state;
          this.cachedStateTime = Date.now();
          cb(this.entityId, "weather", state);
        } else {
          this.cachedStateTime = Date.now();
        }
      } catch {
        // Silently skip failed polls — ping() will report unhealthy
      }
    }, interval);
  }

  async execute(): Promise<void> {
    throw new Error("Weather is read-only — no commands supported");
  }

  async ping(): Promise<boolean> {
    return this.client.ping();
  }

  async destroy(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

const createPirateWeatherAdapter: AdapterFactory = (config) => new PirateWeatherAdapter(config);
export default createPirateWeatherAdapter;

// Standalone entry point — when run as a process, start the SDK harness
runAdapter(createPirateWeatherAdapter);
