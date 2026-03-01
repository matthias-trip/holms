import { DAVClient, type DAVObject } from "tsdav";
import type { CalDavAdapterConfig, CalendarInfo } from "./types.js";

export class CalDavClient {
  private client: DAVClient | null = null;
  private config: CalDavAdapterConfig;

  constructor(config: CalDavAdapterConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    this.client = new DAVClient({
      serverUrl: this.config.server_url,
      credentials: {
        username: this.config.username,
        password: this.config.password,
      },
      authMethod: this.config.auth_method === "digest" ? "Digest" : "Basic",
      defaultAccountType: "caldav",
    });
    await this.client.login();
  }

  async getCalendars(): Promise<CalendarInfo[]> {
    if (!this.client) throw new Error("Not connected");

    const calendars = await this.client.fetchCalendars();
    const result: CalendarInfo[] = [];

    for (const cal of calendars) {
      const displayName = String(cal.displayName ?? cal.url);

      // Filter by configured calendar names
      if (this.config.calendars && this.config.calendars.length > 0) {
        if (!this.config.calendars.some((n) => displayName.toLowerCase().includes(n.toLowerCase()))) {
          continue;
        }
      }

      result.push({
        url: cal.url,
        displayName,
        ctag: cal.ctag,
        color: (cal as Record<string, unknown>).calendarColor as string | undefined,
      });
    }

    return result;
  }

  async fetchEvents(calendarUrl: string, from: Date, to: Date): Promise<DAVObject[]> {
    if (!this.client) throw new Error("Not connected");

    const calendars = await this.client.fetchCalendars();
    const calendar = calendars.find((c) => c.url === calendarUrl);
    if (!calendar) throw new Error(`Calendar not found: ${calendarUrl}`);

    return this.client.fetchCalendarObjects({
      calendar,
      timeRange: {
        start: from.toISOString(),
        end: to.toISOString(),
      },
    });
  }

  async createEvent(calendarUrl: string, icalData: string, filename: string): Promise<void> {
    if (!this.client) throw new Error("Not connected");

    const calendars = await this.client.fetchCalendars();
    const calendar = calendars.find((c) => c.url === calendarUrl);
    if (!calendar) throw new Error(`Calendar not found: ${calendarUrl}`);

    await this.client.createCalendarObject({
      calendar,
      filename: `${filename}.ics`,
      iCalString: icalData,
    });
  }

  async updateEvent(objectUrl: string, icalData: string, etag?: string): Promise<void> {
    if (!this.client) throw new Error("Not connected");

    await this.client.updateCalendarObject({
      calendarObject: {
        url: objectUrl,
        data: icalData,
        etag: etag ?? "",
      },
    });
  }

  async deleteEvent(objectUrl: string, etag?: string): Promise<void> {
    if (!this.client) throw new Error("Not connected");

    await this.client.deleteCalendarObject({
      calendarObject: {
        url: objectUrl,
        etag: etag ?? "",
      },
    });
  }

  async ping(): Promise<boolean> {
    try {
      if (!this.client) return false;
      await this.client.fetchCalendars();
      return true;
    } catch {
      return false;
    }
  }
}
