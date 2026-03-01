import ICAL from "ical.js";
import type { CalendarEvent } from "./types.js";

type ICALTime = InstanceType<typeof ICAL.Time>;

/**
 * Parse a VCALENDAR string into CalendarEvent objects (non-recurring only).
 */
export function parseVCalendar(icalData: string): CalendarEvent[] {
  const jcalData = ICAL.parse(icalData);
  const comp = new ICAL.Component(jcalData);
  const vevents = comp.getAllSubcomponents("vevent");
  const events: CalendarEvent[] = [];

  for (const vevent of vevents) {
    const uid = vevent.getFirstPropertyValue("uid") as string;
    if (!uid) continue;

    const summary = (vevent.getFirstPropertyValue("summary") as string) ?? "(no title)";
    const description = vevent.getFirstPropertyValue("description") as string | undefined;
    const location = vevent.getFirstPropertyValue("location") as string | undefined;

    const dtstart = vevent.getFirstProperty("dtstart");
    const dtend = vevent.getFirstProperty("dtend");
    const duration = vevent.getFirstPropertyValue("duration") as InstanceType<typeof ICAL.Duration> | null;

    if (!dtstart) continue;

    const startTime = dtstart.getFirstValue() as ICALTime | null;
    if (!startTime) continue;
    const allDay = startTime.isDate;

    let endTime: ICALTime;
    if (dtend) {
      endTime = dtend.getFirstValue() as ICALTime;
    } else if (duration) {
      endTime = startTime.clone();
      endTime.addDuration(duration);
    } else {
      endTime = startTime.clone();
      if (allDay) {
        endTime.adjust(1, 0, 0, 0);
      } else {
        endTime.adjust(0, 1, 0, 0);
      }
    }

    const recurring = vevent.getFirstProperty("rrule") !== null;

    events.push({
      uid,
      summary,
      description: description || undefined,
      location: location || undefined,
      start: startTime.toJSDate().getTime(),
      end: endTime.toJSDate().getTime(),
      all_day: allDay,
      recurring,
    });
  }

  return events;
}

/**
 * Expand recurring events within a time range.
 * Returns individual occurrences as separate CalendarEvent objects.
 */
export function expandRecurring(icalData: string, from: Date, to: Date): CalendarEvent[] {
  const jcalData = ICAL.parse(icalData);
  const comp = new ICAL.Component(jcalData);
  const vevents = comp.getAllSubcomponents("vevent");
  const events: CalendarEvent[] = [];

  for (const vevent of vevents) {
    const uid = vevent.getFirstPropertyValue("uid") as string;
    if (!uid) continue;

    const summary = (vevent.getFirstPropertyValue("summary") as string) ?? "(no title)";
    const description = vevent.getFirstPropertyValue("description") as string | undefined;
    const location = vevent.getFirstPropertyValue("location") as string | undefined;

    const rrule = vevent.getFirstProperty("rrule");
    const dtstart = vevent.getFirstProperty("dtstart");
    if (!dtstart) continue;

    const startTime = dtstart.getFirstValue() as ICALTime | null;
    if (!startTime) continue;
    const allDay = startTime.isDate;

    // Calculate event duration
    const dtend = vevent.getFirstProperty("dtend");
    const durationProp = vevent.getFirstPropertyValue("duration") as InstanceType<typeof ICAL.Duration> | null;
    let durationMs: number;

    if (dtend) {
      const endTime = dtend.getFirstValue() as ICALTime | null;
      durationMs = endTime ? endTime.toJSDate().getTime() - startTime.toJSDate().getTime() : (allDay ? 86400000 : 3600000);
    } else if (durationProp) {
      durationMs = durationProp.toSeconds() * 1000;
    } else {
      durationMs = allDay ? 86400000 : 3600000;
    }

    if (rrule) {
      // Expand recurring event
      const expand = new ICAL.RecurExpansion({
        component: vevent,
        dtstart: startTime,
      });

      const toTime = ICAL.Time.fromJSDate(to, false);
      let next: ICALTime | null;
      while ((next = expand.next() as ICALTime | null)) {
        if (next.compare(toTime) > 0) break;

        const occStart = next.toJSDate().getTime();
        const occEnd = occStart + durationMs;

        if (occEnd < from.getTime()) continue;

        events.push({
          uid: `${uid}_${occStart}`,
          summary,
          description: description || undefined,
          location: location || undefined,
          start: occStart,
          end: occEnd,
          all_day: allDay,
          recurring: true,
        });
      }
    } else {
      // Non-recurring event — include if it overlaps the range
      const start = startTime.toJSDate().getTime();
      const end = start + durationMs;
      if (end >= from.getTime() && start <= to.getTime()) {
        events.push({
          uid,
          summary,
          description: description || undefined,
          location: location || undefined,
          start,
          end,
          all_day: allDay,
          recurring: false,
        });
      }
    }
  }

  return events.sort((a, b) => a.start - b.start);
}

/**
 * Build a VCALENDAR string from event data for PUT operations.
 */
export function buildVEvent(event: {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  start: number;
  end: number;
  all_day?: boolean;
}): string {
  const comp = new ICAL.Component(["vcalendar", [], []]);
  comp.addPropertyWithValue("prodid", "-//Holms//CalDAV Adapter//EN");
  comp.addPropertyWithValue("version", "2.0");

  const vevent = new ICAL.Component("vevent");

  vevent.addPropertyWithValue("uid", event.uid);
  vevent.addPropertyWithValue("summary", event.summary);

  if (event.description) {
    vevent.addPropertyWithValue("description", event.description);
  }
  if (event.location) {
    vevent.addPropertyWithValue("location", event.location);
  }

  const startDate = new Date(event.start);
  const endDate = new Date(event.end);

  if (event.all_day) {
    const dtstart = ICAL.Time.fromJSDate(startDate, false);
    dtstart.isDate = true;
    vevent.addPropertyWithValue("dtstart", dtstart);

    const dtend = ICAL.Time.fromJSDate(endDate, false);
    dtend.isDate = true;
    vevent.addPropertyWithValue("dtend", dtend);
  } else {
    vevent.addPropertyWithValue("dtstart", ICAL.Time.fromJSDate(startDate, false));
    vevent.addPropertyWithValue("dtend", ICAL.Time.fromJSDate(endDate, false));
  }

  vevent.addPropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), false));

  comp.addSubcomponent(vevent);

  return comp.toString();
}
