import {
  runAdapter,
  type Adapter,
  type AdapterFactory,
  type RegistrationResult,
  type PropertyName,
  type DiscoverResult,
  type QueryResult,
} from "@holms/adapter-sdk";
import type { AfvalinfoConfig, TrashApiEntry } from "./types.js";

const API_BASE = "https://trashapi.azurewebsites.net/trash";
const POLL_INTERVAL_MS = 2.5 * 60 * 60 * 1000; // 2.5 hours

const DISPLAY_NAMES: Record<string, string> = {
  gft: "GFT (Organic)",
  papier: "Papier (Paper)",
  pbd: "PMD (Plastic/Metal/Drink cartons)",
  restafval: "Restafval (Residual)",
  textiel: "Textiel (Textiles)",
  grofvuil: "Grofvuil (Bulky waste)",
  kerstboom: "Kerstboom (Christmas tree)",
  takken: "Takken (Branches)",
  kca: "KCA (Chemical waste)",
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function buildApiUrl(zipcode: string, houseNumber: string, suffix?: string): string {
  const params = new URLSearchParams({
    Location: "",
    ZipCode: zipcode.replace(/\s/g, ""),
    HouseNumber: houseNumber,
    HouseNumberSuffix: suffix ?? "",
    DiftarCode: "",
    ShowWholeYear: "true",
    GetCleanprofsData: "false",
  });
  return `${API_BASE}?${params.toString()}`;
}

function startOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function parseDate(iso: string): Date {
  return new Date(iso);
}

export class AfvalinfoAdapter implements Adapter {
  private configured: boolean;
  private zipcode: string;
  private houseNumber: string;
  private suffix: string;

  /** waste type slug → sorted dates (epoch ms) */
  private cache = new Map<string, number[]>();
  /** waste type slug → display name */
  private entityNames = new Map<string, string>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Record<string, unknown>) {
    const cfg = config as unknown as AfvalinfoConfig;
    this.zipcode = cfg.zipcode ?? "";
    this.houseNumber = cfg.house_number ?? "";
    this.suffix = cfg.house_number_suffix ?? "";

    this.configured = !!(this.zipcode && this.houseNumber);
  }

  async register(): Promise<RegistrationResult> {
    if (!this.configured) return { entities: [] };

    const entries = await this.fetchData();
    this.updateCache(entries);

    const entities = [...this.cache.keys()].map((slug) => ({
      entityId: slug,
      displayName: this.entityNames.get(slug) ?? slug,
      properties: [{ property: "schedule" as PropertyName, features: ["events", "recurring"] }],
    }));

    return { entities };
  }

  async observe(entityId: string, property: PropertyName): Promise<Record<string, unknown>> {
    if (property !== "schedule") throw new Error(`Unsupported property: ${property}`);
    const dates = this.cache.get(entityId);
    if (!dates) throw new Error(`Unknown entity: ${entityId}`);

    const todayMs = startOfDay(new Date());
    const todayEnd = todayMs + 86400000;

    const currentDate = dates.find((d) => d >= todayMs && d < todayEnd);
    const nextDate = dates.find((d) => d >= todayEnd);

    return {
      active: currentDate !== undefined,
      current_event: currentDate !== undefined
        ? { summary: this.entityNames.get(entityId) ?? entityId, start: currentDate, all_day: true }
        : null,
      next_event: nextDate !== undefined
        ? { summary: this.entityNames.get(entityId) ?? entityId, start: nextDate, all_day: true }
        : null,
      event_count: dates.length,
    };
  }

  async query(
    entityId: string,
    property: PropertyName,
    params: Record<string, unknown>,
  ): Promise<QueryResult> {
    if (property !== "schedule") throw new Error(`Unsupported property: ${property}`);
    const dates = this.cache.get(entityId);
    if (!dates) throw new Error(`Unknown entity: ${entityId}`);

    const from = (params.from as number) ?? 0;
    const to = (params.to as number) ?? Infinity;
    const name = this.entityNames.get(entityId) ?? entityId;

    const items = dates
      .filter((d) => d >= from && d <= to)
      .map((d, i) => ({
        uid: `${entityId}-${d}`,
        summary: name,
        start: d,
        end: d + 86400000,
        all_day: true,
        recurring: true,
      }));

    return { items, total: items.length };
  }

  async execute(
    _entityId: string,
    _property: PropertyName,
    _command: Record<string, unknown>,
  ): Promise<void> {
    // Read-only calendar — no commands to send
  }

  async subscribe(
    cb: (entityId: string, property: PropertyName, state: Record<string, unknown>) => void,
  ): Promise<void> {
    if (!this.configured) return;

    this.pollTimer = setInterval(async () => {
      try {
        const entries = await this.fetchData();
        const oldCache = new Map(this.cache);
        this.updateCache(entries);

        for (const [slug, dates] of this.cache) {
          const oldDates = oldCache.get(slug);
          if (JSON.stringify(dates) !== JSON.stringify(oldDates)) {
            const state = await this.observe(slug, "schedule");
            cb(slug, "schedule", state);
          }
        }
      } catch {
        // Silently skip poll failures — next poll will retry
      }
    }, POLL_INTERVAL_MS);
  }

  async discover(params: Record<string, unknown>): Promise<DiscoverResult> {
    const zipcode = (params.zipcode as string) ?? this.zipcode;
    const houseNumber = (params.house_number as string) ?? this.houseNumber;
    const suffix = (params.house_number_suffix as string) ?? this.suffix;

    if (!zipcode || !houseNumber) {
      return { gateways: [], message: "Provide zipcode and house_number to look up your waste collector." };
    }

    try {
      const url = buildApiUrl(zipcode, houseNumber, suffix);
      const res = await fetch(url);
      if (!res.ok) {
        return { gateways: [], message: `TrashAPI returned ${res.status}. Check the address and try again.` };
      }

      const data = (await res.json()) as TrashApiEntry[];
      if (!Array.isArray(data) || data.length === 0) {
        return { gateways: [], message: "No waste collection data found for this address. Verify the zip code and house number." };
      }

      // Derive collector name from the data (use first entry's name as hint)
      const types = [...new Set(data.map((e) => e.name))];
      const collectorHint = `${types.length} waste types found (${types.slice(0, 3).join(", ")}${types.length > 3 ? ", ..." : ""})`;

      return {
        gateways: [{
          id: "address",
          name: collectorHint,
          address: `${zipcode} ${houseNumber}${suffix ? ` ${suffix}` : ""}`,
        }],
      };
    } catch (err) {
      return {
        gateways: [],
        message: `Failed to reach TrashAPI: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async ping(): Promise<boolean> {
    if (!this.configured) return true;
    try {
      const url = buildApiUrl(this.zipcode, this.houseNumber, this.suffix);
      const res = await fetch(url);
      return res.ok;
    } catch {
      return false;
    }
  }

  async destroy(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.cache.clear();
    this.entityNames.clear();
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private async fetchData(): Promise<TrashApiEntry[]> {
    const url = buildApiUrl(this.zipcode, this.houseNumber, this.suffix);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TrashAPI returned ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Unexpected API response");
    return data as TrashApiEntry[];
  }

  private updateCache(entries: TrashApiEntry[]): void {
    const grouped = new Map<string, number[]>();

    for (const entry of entries) {
      const slug = slugify(entry.name);
      const epochMs = startOfDay(parseDate(entry.date));

      if (!grouped.has(slug)) grouped.set(slug, []);
      grouped.get(slug)!.push(epochMs);

      if (!this.entityNames.has(slug)) {
        this.entityNames.set(slug, DISPLAY_NAMES[slug] ?? entry.name);
      }
    }

    // Sort dates ascending per waste type
    for (const [slug, dates] of grouped) {
      dates.sort((a, b) => a - b);
      this.cache.set(slug, dates);
    }
  }
}

const createAfvalinfoAdapter: AdapterFactory = (config) => new AfvalinfoAdapter(config);
export default createAfvalinfoAdapter;

runAdapter(createAfvalinfoAdapter);
