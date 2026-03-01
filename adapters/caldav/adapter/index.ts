import { runAdapter, type Adapter, type PropertyName, type RegistrationResult, type QueryResult } from "@holms/adapter-sdk";
import { CalDavClient } from "./caldav-client.js";
import { parseVCalendar, expandRecurring, buildVEvent } from "./ical-parser.js";
import type { CalDavAdapterConfig, CalendarInfo, CalendarEvent } from "./types.js";

interface CalendarState {
  info: CalendarInfo;
  events: CalendarEvent[];
  lastActive: boolean;
  lastNextUid?: string;
}

class CalDavAdapter implements Adapter {
  private client: CalDavClient;
  private config: CalDavAdapterConfig;
  private calendars = new Map<string, CalendarState>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private onStateChanged: ((entityId: string, property: PropertyName, state: Record<string, unknown>) => void) | null = null;

  constructor(config: Record<string, unknown>) {
    // Normalize: accept "url" as alias for "server_url"
    if (!config.server_url && config.url) {
      config.server_url = config.url;
    }
    this.config = config as unknown as CalDavAdapterConfig;
    if (!this.config.server_url) {
      throw new Error("Missing required config: server_url");
    }
    this.client = new CalDavClient(this.config);
  }

  async register(): Promise<RegistrationResult> {
    await this.client.connect();
    const calendars = await this.client.getCalendars();

    const entities = calendars.map((cal) => {
      const entityId = this.calendarEntityId(cal);
      this.calendars.set(entityId, {
        info: cal,
        events: [],
        lastActive: false,
      });

      return {
        entityId,
        displayName: cal.displayName,
        properties: [{
          property: "schedule" as PropertyName,
          features: ["events", "recurring", "create", "update", "delete"],
          commandHints: {
            create_event: { type: "object" as const, description: "{ summary, start (epoch ms), end (epoch ms), description?, location?, all_day? }" },
            update_event: { type: "object" as const, description: "{ uid (required), summary?, start?, end?, description?, location?, all_day? }" },
            delete_event: { type: "object" as const, description: "{ uid }" },
          },
        }],
      };
    });

    console.log(`Registered ${entities.length} calendar(s)`);
    return { entities };
  }

  async observe(entityId: string, _property: PropertyName): Promise<Record<string, unknown>> {
    const cal = this.calendars.get(entityId);
    if (!cal) throw new Error(`Unknown calendar: ${entityId}`);

    // Fetch today's events for a quick snapshot
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(dayStart.getTime() + 86400000);

    const objects = await this.client.fetchEvents(cal.info.url, dayStart, dayEnd);
    const events: CalendarEvent[] = [];
    for (const obj of objects) {
      if (!obj.data) continue;
      const parsed = expandRecurring(obj.data, dayStart, dayEnd);
      for (const evt of parsed) {
        evt.raw_url = obj.url;
        evt.etag = obj.etag;
        events.push(evt);
      }
    }

    events.sort((a, b) => a.start - b.start);
    cal.events = events;

    const nowMs = now.getTime();
    const currentEvent = events.find((e) => e.start <= nowMs && e.end > nowMs);
    const nextEvent = events.find((e) => e.start > nowMs);

    const state: Record<string, unknown> = {
      active: !!currentEvent,
      event_count: events.length,
    };

    if (currentEvent) {
      state.current_event = {
        uid: currentEvent.uid,
        summary: currentEvent.summary,
        start: currentEvent.start,
        end: currentEvent.end,
        all_day: currentEvent.all_day,
      };
    }

    if (nextEvent) {
      state.next_event = {
        uid: nextEvent.uid,
        summary: nextEvent.summary,
        start: nextEvent.start,
        end: nextEvent.end,
        all_day: nextEvent.all_day,
      };
    }

    return state;
  }

  async query(entityId: string, _property: PropertyName, params: Record<string, unknown>): Promise<QueryResult> {
    const cal = this.calendars.get(entityId);
    if (!cal) throw new Error(`Unknown calendar: ${entityId}`);

    const from = typeof params.from === "number" ? new Date(params.from) : new Date();
    const to = typeof params.to === "number"
      ? new Date(params.to)
      : new Date(from.getTime() + 7 * 86400000); // Default: 1 week

    const objects = await this.client.fetchEvents(cal.info.url, from, to);
    const events: CalendarEvent[] = [];

    for (const obj of objects) {
      if (!obj.data) continue;
      const parsed = expandRecurring(obj.data, from, to);
      for (const evt of parsed) {
        evt.raw_url = obj.url;
        evt.etag = obj.etag;
        events.push(evt);
      }
    }

    events.sort((a, b) => a.start - b.start);

    const items = events.map((e) => ({
      id: e.uid,
      uid: e.uid,
      summary: e.summary,
      description: e.description,
      location: e.location,
      start: e.start,
      end: e.end,
      all_day: e.all_day,
      recurring: e.recurring,
    }));

    return { items, total: items.length };
  }

  async execute(entityId: string, _property: PropertyName, command: Record<string, unknown>): Promise<void> {
    const cal = this.calendars.get(entityId);
    if (!cal) throw new Error(`Unknown calendar: ${entityId}`);

    if (command.create_event) {
      const evt = command.create_event as Record<string, unknown>;
      const uid = `holms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const icalData = buildVEvent({
        uid,
        summary: String(evt.summary ?? ""),
        description: evt.description ? String(evt.description) : undefined,
        location: evt.location ? String(evt.location) : undefined,
        start: Number(evt.start),
        end: Number(evt.end),
        all_day: Boolean(evt.all_day),
      });
      await this.client.createEvent(cal.info.url, icalData, uid);
      console.log(`Created event "${evt.summary}" (${uid})`);
    } else if (command.update_event) {
      const evt = command.update_event as Record<string, unknown>;
      const uid = String(evt.uid);

      // Find the existing event to get its URL and current data
      const existing = cal.events.find((e) => e.uid === uid);
      if (!existing?.raw_url) throw new Error(`Event ${uid} not found or has no URL`);

      const icalData = buildVEvent({
        uid,
        summary: evt.summary ? String(evt.summary) : existing.summary,
        description: evt.description !== undefined ? String(evt.description) : existing.description,
        location: evt.location !== undefined ? String(evt.location) : existing.location,
        start: evt.start ? Number(evt.start) : existing.start,
        end: evt.end ? Number(evt.end) : existing.end,
        all_day: evt.all_day !== undefined ? Boolean(evt.all_day) : existing.all_day,
      });

      await this.client.updateEvent(existing.raw_url, icalData, existing.etag);
      console.log(`Updated event "${uid}"`);
    } else if (command.delete_event) {
      const evt = command.delete_event as Record<string, unknown>;
      const uid = String(evt.uid);

      const existing = cal.events.find((e) => e.uid === uid);
      if (!existing?.raw_url) throw new Error(`Event ${uid} not found or has no URL`);

      await this.client.deleteEvent(existing.raw_url, existing.etag);
      console.log(`Deleted event "${uid}"`);
    } else {
      throw new Error(`Unknown command: ${Object.keys(command).join(", ")}`);
    }
  }

  async subscribe(
    cb: (entityId: string, property: PropertyName, state: Record<string, unknown>) => void,
  ): Promise<void> {
    this.onStateChanged = cb;
    const interval = this.config.poll_interval_ms ?? 300000; // 5 min default

    this.pollTimer = setInterval(async () => {
      for (const [entityId] of this.calendars) {
        try {
          const state = await this.observe(entityId, "schedule");
          const cal = this.calendars.get(entityId)!;

          // Emit state_changed if active/next changed
          const active = Boolean(state.active);
          const nextUid = (state.next_event as Record<string, unknown> | undefined)?.uid as string | undefined;

          if (active !== cal.lastActive || nextUid !== cal.lastNextUid) {
            cal.lastActive = active;
            cal.lastNextUid = nextUid;
            cb(entityId, "schedule", state);
          }
        } catch (err) {
          console.error(`Poll failed for ${entityId}:`, err instanceof Error ? err.message : err);
        }
      }
    }, interval);
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

  private calendarEntityId(cal: CalendarInfo): string {
    // Generate stable entity ID from calendar URL
    const slug = cal.displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return `cal-${slug}`;
  }
}

runAdapter((config) => new CalDavAdapter(config));

export default CalDavAdapter;
