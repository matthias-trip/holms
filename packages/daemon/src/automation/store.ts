import Database from "better-sqlite3";
import type { Automation, AutomationDisplay, AutomationTrigger } from "@holms/shared";
import { v4 as uuid } from "uuid";
import { CronExpressionParser } from "cron-parser";

export function computeNextCronFireAt(expression: string, after: number = Date.now()): number {
  const interval = CronExpressionParser.parse(expression, { currentDate: new Date(after) });
  return interval.next().toDate().getTime();
}

/** Convert legacy time trigger fields to a 5-field cron expression. */
function timeToCron(hour: number, minute: number, recurrence: string, dayOfWeek: number | null): string {
  switch (recurrence) {
    case "weekdays":
      return `${minute} ${hour} * * 1-5`;
    case "weekends":
      return `${minute} ${hour} * * 0,6`;
    case "weekly":
      return `${minute} ${hour} * * ${dayOfWeek ?? 0}`;
    case "once":
    case "daily":
    default:
      return `${minute} ${hour} * * *`;
  }
}

export class AutomationStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    // Create new table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS automations (
        id TEXT PRIMARY KEY,
        summary TEXT NOT NULL DEFAULT '',
        instruction TEXT NOT NULL,
        trigger_json TEXT NOT NULL,
        hour INTEGER NOT NULL DEFAULT 0,
        minute INTEGER NOT NULL DEFAULT 0,
        recurrence TEXT NOT NULL DEFAULT 'daily',
        day_of_week INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        last_fired_at INTEGER,
        next_fire_at INTEGER,
        channel TEXT
      )
    `);

    // Migrate from legacy schedules table if it exists
    try {
      const hasSchedules = this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schedules'`)
        .get();

      if (hasSchedules) {
        // Copy legacy rows into automations table, converting directly to cron triggers
        const legacyRows = this.db
          .prepare(`SELECT * FROM schedules`)
          .all() as LegacyScheduleRow[];

        const insert = this.db.prepare(
          `INSERT OR IGNORE INTO automations (id, summary, instruction, trigger_json, hour, minute, recurrence, day_of_week, enabled, created_at, last_fired_at, next_fire_at, channel)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );

        for (const row of legacyRows) {
          const expression = timeToCron(row.hour, row.minute, row.recurrence, row.day_of_week);
          const trigger: AutomationTrigger = { type: "cron", expression };
          const nextFireAt = computeNextCronFireAt(expression);
          const summary = row.instruction.slice(0, 80);
          insert.run(
            row.id,
            summary,
            row.instruction,
            JSON.stringify(trigger),
            row.hour,
            row.minute,
            row.recurrence,
            row.day_of_week,
            row.enabled,
            row.created_at,
            row.last_fired_at,
            nextFireAt,
            row.channel ?? null,
          );
        }

        console.log(`[AutomationStore] Migrated ${legacyRows.length} legacy schedules`);
      }
    } catch {
      // Migration not needed or already done
    }

    // Add display_json column if missing
    try {
      this.db.exec(`ALTER TABLE automations ADD COLUMN display_json TEXT`);
    } catch {
      // Column already exists
    }

    // Migrate existing time triggers → cron triggers (idempotent)
    try {
      const timeRows = this.db
        .prepare(`SELECT id, trigger_json FROM automations WHERE trigger_json LIKE '%"type":"time"%'`)
        .all() as { id: string; trigger_json: string }[];

      if (timeRows.length > 0) {
        const update = this.db.prepare(
          `UPDATE automations SET trigger_json = ?, next_fire_at = ? WHERE id = ?`,
        );

        for (const row of timeRows) {
          const old = JSON.parse(row.trigger_json) as { hour: number; minute: number; recurrence: string; dayOfWeek: number | null };
          const expression = timeToCron(old.hour, old.minute, old.recurrence, old.dayOfWeek);
          const trigger: AutomationTrigger = { type: "cron", expression };
          const nextFireAt = computeNextCronFireAt(expression);
          update.run(JSON.stringify(trigger), nextFireAt, row.id);
        }

        console.log(`[AutomationStore] Migrated ${timeRows.length} time triggers → cron`);
      }
    } catch (err) {
      console.error("[AutomationStore] Time→cron migration error:", err);
    }
  }

  create(input: {
    summary: string;
    instruction: string;
    trigger: AutomationTrigger;
    display?: AutomationDisplay;
    channel?: string | null;
  }): Automation {
    const id = uuid();
    const now = Date.now();
    const channel = input.channel ?? null;
    const displayJson = input.display ? JSON.stringify(input.display) : null;

    const nextFireAt = input.trigger.type === "cron"
      ? computeNextCronFireAt(input.trigger.expression)
      : null;

    this.db
      .prepare(
        `INSERT INTO automations (id, summary, instruction, trigger_json, hour, minute, recurrence, day_of_week, enabled, created_at, last_fired_at, next_fire_at, channel, display_json)
         VALUES (?, ?, ?, ?, 0, 0, 'daily', NULL, 1, ?, NULL, ?, ?, ?)`,
      )
      .run(id, input.summary, input.instruction, JSON.stringify(input.trigger), now, nextFireAt, channel, displayJson);

    return this.get(id)!;
  }

  get(id: string): Automation | undefined {
    const row = this.db
      .prepare(`SELECT * FROM automations WHERE id = ?`)
      .get(id) as AutomationRow | undefined;
    return row ? this.rowToAutomation(row) : undefined;
  }

  getAll(): Automation[] {
    const rows = this.db
      .prepare(`SELECT * FROM automations ORDER BY created_at DESC`)
      .all() as AutomationRow[];
    return rows.map((r) => this.rowToAutomation(r));
  }

  getDueCronTriggers(now: number): Automation[] {
    const rows = this.db
      .prepare(`SELECT * FROM automations WHERE enabled = 1 AND next_fire_at IS NOT NULL AND next_fire_at <= ?`)
      .all(now) as AutomationRow[];
    return rows
      .map((r) => this.rowToAutomation(r))
      .filter((a) => a.trigger.type === "cron");
  }

  getDeviceEventAutomations(): Automation[] {
    const rows = this.db
      .prepare(`SELECT * FROM automations WHERE enabled = 1`)
      .all() as AutomationRow[];
    return rows
      .map((r) => this.rowToAutomation(r))
      .filter((a) => a.trigger.type === "device_event");
  }

  getStateThresholdAutomations(): Automation[] {
    const rows = this.db
      .prepare(`SELECT * FROM automations WHERE enabled = 1`)
      .all() as AutomationRow[];
    return rows
      .map((r) => this.rowToAutomation(r))
      .filter((a) => a.trigger.type === "state_threshold");
  }

  update(
    id: string,
    fields: Partial<{
      summary: string;
      instruction: string;
      trigger: AutomationTrigger;
      display: AutomationDisplay;
      enabled: boolean;
    }>,
  ): Automation | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;

    const summary = fields.summary ?? existing.summary;
    const instruction = fields.instruction ?? existing.instruction;
    const trigger = fields.trigger ?? existing.trigger;
    const enabled = fields.enabled !== undefined ? fields.enabled : existing.enabled;
    const displayJson = fields.display !== undefined
      ? JSON.stringify(fields.display)
      : (existing.display ? JSON.stringify(existing.display) : null);

    const nextFireAt = trigger.type === "cron"
      ? computeNextCronFireAt(trigger.expression)
      : null;

    this.db
      .prepare(
        `UPDATE automations SET summary = ?, instruction = ?, trigger_json = ?, hour = 0, minute = 0, recurrence = 'daily', day_of_week = NULL, enabled = ?, next_fire_at = ?, display_json = ? WHERE id = ?`,
      )
      .run(summary, instruction, JSON.stringify(trigger), enabled ? 1 : 0, nextFireAt, displayJson, id);

    return this.get(id);
  }

  markFired(id: string): void {
    const automation = this.get(id);
    if (!automation) return;

    const now = Date.now();

    if (automation.trigger.type === "cron") {
      const nextFireAt = computeNextCronFireAt(automation.trigger.expression, now);
      this.db
        .prepare(`UPDATE automations SET last_fired_at = ?, next_fire_at = ? WHERE id = ?`)
        .run(now, nextFireAt, id);
    } else {
      // Non-time triggers: just update last_fired_at
      this.db
        .prepare(`UPDATE automations SET last_fired_at = ? WHERE id = ?`)
        .run(now, id);
    }
  }

  remove(id: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM automations WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }

  private rowToAutomation(row: AutomationRow): Automation {
    const trigger: AutomationTrigger = JSON.parse(row.trigger_json);
    const display = row.display_json ? JSON.parse(row.display_json) : undefined;
    return {
      id: row.id,
      summary: row.summary,
      instruction: row.instruction,
      trigger,
      ...(display && { display }),
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      lastFiredAt: row.last_fired_at,
      nextFireAt: row.next_fire_at,
      channel: row.channel,
    };
  }
}

interface AutomationRow {
  id: string;
  summary: string;
  instruction: string;
  trigger_json: string;
  hour: number;
  minute: number;
  recurrence: string;
  day_of_week: number | null;
  enabled: number;
  created_at: number;
  last_fired_at: number | null;
  next_fire_at: number | null;
  channel: string | null;
  display_json: string | null;
}

interface LegacyScheduleRow {
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
  channel: string | null;
}
