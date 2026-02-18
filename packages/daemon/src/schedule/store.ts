import Database from "better-sqlite3";
import type { Schedule, ScheduleRecurrence } from "@holms/shared";
import { v4 as uuid } from "uuid";

export function computeNextFireAt(
  hour: number,
  minute: number,
  recurrence: ScheduleRecurrence,
  dayOfWeek: number | null,
  after: number = Date.now(),
): number {
  const base = new Date(after);

  // Start from today at the target time
  const candidate = new Date(base);
  candidate.setHours(hour, minute, 0, 0);

  // If the candidate is in the past, move to the next day
  if (candidate.getTime() <= after) {
    candidate.setDate(candidate.getDate() + 1);
  }

  switch (recurrence) {
    case "once":
    case "daily":
      // candidate is already the next occurrence
      break;

    case "weekdays":
      // 0=Sun, 6=Sat
      while (candidate.getDay() === 0 || candidate.getDay() === 6) {
        candidate.setDate(candidate.getDate() + 1);
      }
      break;

    case "weekends":
      while (candidate.getDay() !== 0 && candidate.getDay() !== 6) {
        candidate.setDate(candidate.getDate() + 1);
      }
      break;

    case "weekly":
      if (dayOfWeek != null) {
        while (candidate.getDay() !== dayOfWeek) {
          candidate.setDate(candidate.getDate() + 1);
        }
      }
      break;
  }

  return candidate.getTime();
}

export class ScheduleStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        instruction TEXT NOT NULL,
        hour INTEGER NOT NULL,
        minute INTEGER NOT NULL,
        recurrence TEXT NOT NULL DEFAULT 'daily',
        day_of_week INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        last_fired_at INTEGER,
        next_fire_at INTEGER NOT NULL
      )
    `);
  }

  create(input: {
    instruction: string;
    hour: number;
    minute: number;
    recurrence: ScheduleRecurrence;
    dayOfWeek?: number | null;
  }): Schedule {
    const id = uuid();
    const now = Date.now();
    const dayOfWeek = input.dayOfWeek ?? null;
    const nextFireAt = computeNextFireAt(input.hour, input.minute, input.recurrence, dayOfWeek);

    this.db
      .prepare(
        `INSERT INTO schedules (id, instruction, hour, minute, recurrence, day_of_week, enabled, created_at, last_fired_at, next_fire_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, NULL, ?)`,
      )
      .run(id, input.instruction, input.hour, input.minute, input.recurrence, dayOfWeek, now, nextFireAt);

    return this.get(id)!;
  }

  get(id: string): Schedule | undefined {
    const row = this.db
      .prepare(`SELECT * FROM schedules WHERE id = ?`)
      .get(id) as ScheduleRow | undefined;
    return row ? this.rowToSchedule(row) : undefined;
  }

  getAll(): Schedule[] {
    const rows = this.db
      .prepare(`SELECT * FROM schedules ORDER BY next_fire_at ASC`)
      .all() as ScheduleRow[];
    return rows.map((r) => this.rowToSchedule(r));
  }

  getDue(now: number): Schedule[] {
    const rows = this.db
      .prepare(`SELECT * FROM schedules WHERE enabled = 1 AND next_fire_at <= ?`)
      .all(now) as ScheduleRow[];
    return rows.map((r) => this.rowToSchedule(r));
  }

  update(
    id: string,
    fields: Partial<{
      instruction: string;
      hour: number;
      minute: number;
      recurrence: ScheduleRecurrence;
      dayOfWeek: number | null;
      enabled: boolean;
    }>,
  ): Schedule | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;

    const instruction = fields.instruction ?? existing.instruction;
    const hour = fields.hour ?? existing.hour;
    const minute = fields.minute ?? existing.minute;
    const recurrence = fields.recurrence ?? existing.recurrence;
    const dayOfWeek = fields.dayOfWeek !== undefined ? fields.dayOfWeek : existing.dayOfWeek;
    const enabled = fields.enabled !== undefined ? fields.enabled : existing.enabled;

    const nextFireAt = computeNextFireAt(hour, minute, recurrence, dayOfWeek);

    this.db
      .prepare(
        `UPDATE schedules SET instruction = ?, hour = ?, minute = ?, recurrence = ?, day_of_week = ?, enabled = ?, next_fire_at = ? WHERE id = ?`,
      )
      .run(instruction, hour, minute, recurrence, dayOfWeek, enabled ? 1 : 0, nextFireAt, id);

    return this.get(id);
  }

  markFired(id: string): void {
    const schedule = this.get(id);
    if (!schedule) return;

    const now = Date.now();

    if (schedule.recurrence === "once") {
      this.db
        .prepare(`UPDATE schedules SET last_fired_at = ?, enabled = 0 WHERE id = ?`)
        .run(now, id);
    } else {
      const nextFireAt = computeNextFireAt(
        schedule.hour,
        schedule.minute,
        schedule.recurrence,
        schedule.dayOfWeek,
        now,
      );
      this.db
        .prepare(`UPDATE schedules SET last_fired_at = ?, next_fire_at = ? WHERE id = ?`)
        .run(now, nextFireAt, id);
    }
  }

  remove(id: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM schedules WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }

  private rowToSchedule(row: ScheduleRow): Schedule {
    return {
      id: row.id,
      instruction: row.instruction,
      hour: row.hour,
      minute: row.minute,
      recurrence: row.recurrence as ScheduleRecurrence,
      dayOfWeek: row.day_of_week,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      lastFiredAt: row.last_fired_at,
      nextFireAt: row.next_fire_at,
    };
  }
}

interface ScheduleRow {
  id: string;
  instruction: string;
  hour: number;
  minute: number;
  recurrence: string;
  day_of_week: number | null;
  enabled: number;
  created_at: number;
  last_fired_at: number | null;
  next_fire_at: number;
}
