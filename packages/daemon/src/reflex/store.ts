import Database from "better-sqlite3";
import type { ReflexRule } from "@holms/shared";
import { v4 as uuid } from "uuid";

export class ReflexStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reflexes (
        id TEXT PRIMARY KEY,
        trigger_json TEXT NOT NULL,
        action_json TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1
      )
    `);
  }

  create(
    rule: Omit<ReflexRule, "id" | "createdAt">,
  ): ReflexRule {
    const id = uuid();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO reflexes (id, trigger_json, action_json, reason, created_by, created_at, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        JSON.stringify(rule.trigger),
        JSON.stringify(rule.action),
        rule.reason,
        rule.createdBy,
        now,
        rule.enabled ? 1 : 0,
      );
    return this.get(id)!;
  }

  get(id: string): ReflexRule | undefined {
    const row = this.db
      .prepare(`SELECT * FROM reflexes WHERE id = ?`)
      .get(id) as ReflexRow | undefined;
    return row ? this.rowToRule(row) : undefined;
  }

  getAll(): ReflexRule[] {
    const rows = this.db
      .prepare(`SELECT * FROM reflexes ORDER BY created_at DESC`)
      .all() as ReflexRow[];
    return rows.map((r) => this.rowToRule(r));
  }

  getEnabled(): ReflexRule[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM reflexes WHERE enabled = 1 ORDER BY created_at DESC`,
      )
      .all() as ReflexRow[];
    return rows.map((r) => this.rowToRule(r));
  }

  toggle(id: string, enabled: boolean): ReflexRule | undefined {
    this.db
      .prepare(`UPDATE reflexes SET enabled = ? WHERE id = ?`)
      .run(enabled ? 1 : 0, id);
    return this.get(id);
  }

  remove(id: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM reflexes WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }

  private rowToRule(row: ReflexRow): ReflexRule {
    return {
      id: row.id,
      trigger: JSON.parse(row.trigger_json),
      action: JSON.parse(row.action_json),
      reason: row.reason,
      createdBy: row.created_by,
      createdAt: row.created_at,
      enabled: row.enabled === 1,
    };
  }
}

interface ReflexRow {
  id: string;
  trigger_json: string;
  action_json: string;
  reason: string;
  created_by: string;
  created_at: number;
  enabled: number;
}
