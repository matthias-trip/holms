import Database from "better-sqlite3";
import type { TriageRule, TriageCondition } from "@holms/shared";
import { v4 as uuid } from "uuid";

export class TriageStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS triage_rules (
        id TEXT PRIMARY KEY,
        condition_json TEXT NOT NULL,
        lane TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1
      )
    `);
    this.deduplicate();
  }

  create(
    rule: Omit<TriageRule, "id" | "createdAt">,
  ): TriageRule {
    const id = uuid();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO triage_rules (id, condition_json, lane, reason, created_by, created_at, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        JSON.stringify(rule.condition),
        rule.lane,
        rule.reason,
        rule.createdBy,
        now,
        rule.enabled ? 1 : 0,
      );
    return this.get(id)!;
  }

  get(id: string): TriageRule | undefined {
    const row = this.db
      .prepare(`SELECT * FROM triage_rules WHERE id = ?`)
      .get(id) as TriageRuleRow | undefined;
    return row ? this.rowToRule(row) : undefined;
  }

  getAll(): TriageRule[] {
    const rows = this.db
      .prepare(`SELECT * FROM triage_rules ORDER BY created_at DESC`)
      .all() as TriageRuleRow[];
    return rows.map((r) => this.rowToRule(r));
  }

  getEnabled(): TriageRule[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM triage_rules WHERE enabled = 1 ORDER BY created_at DESC`,
      )
      .all() as TriageRuleRow[];
    return rows.map((r) => this.rowToRule(r));
  }

  update(
    id: string,
    updates: Partial<Pick<TriageRule, "condition" | "lane" | "reason" | "enabled">>,
  ): TriageRule | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;

    if (updates.condition !== undefined) {
      this.db.prepare(`UPDATE triage_rules SET condition_json = ? WHERE id = ?`)
        .run(JSON.stringify(updates.condition), id);
    }
    if (updates.lane !== undefined) {
      this.db.prepare(`UPDATE triage_rules SET lane = ? WHERE id = ?`)
        .run(updates.lane, id);
    }
    if (updates.reason !== undefined) {
      this.db.prepare(`UPDATE triage_rules SET reason = ? WHERE id = ?`)
        .run(updates.reason, id);
    }
    if (updates.enabled !== undefined) {
      this.db.prepare(`UPDATE triage_rules SET enabled = ? WHERE id = ?`)
        .run(updates.enabled ? 1 : 0, id);
    }

    return this.get(id);
  }

  toggle(id: string, enabled: boolean): TriageRule | undefined {
    this.db
      .prepare(`UPDATE triage_rules SET enabled = ? WHERE id = ?`)
      .run(enabled ? 1 : 0, id);
    return this.get(id);
  }

  remove(id: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM triage_rules WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  }

  findByCondition(condition: TriageCondition): TriageRule | undefined {
    const conditionJson = JSON.stringify(condition);
    const row = this.db
      .prepare(`SELECT * FROM triage_rules WHERE condition_json = ?`)
      .get(conditionJson) as TriageRuleRow | undefined;
    return row ? this.rowToRule(row) : undefined;
  }

  close(): void {
    this.db.close();
  }

  private deduplicate(): void {
    // Keep only the newest rule per unique condition_json, delete the rest
    const result = this.db.prepare(`
      DELETE FROM triage_rules WHERE id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY condition_json ORDER BY created_at DESC) AS rn
          FROM triage_rules
        ) WHERE rn = 1
      )
    `).run();
    if (result.changes > 0) {
      console.log(`[TriageStore] Deduplicated ${result.changes} duplicate triage rule(s)`);
    }
  }

  private rowToRule(row: TriageRuleRow): TriageRule {
    return {
      id: row.id,
      condition: JSON.parse(row.condition_json),
      lane: row.lane as TriageRule["lane"],
      reason: row.reason,
      createdBy: row.created_by,
      createdAt: row.created_at,
      enabled: row.enabled === 1,
    };
  }
}

interface TriageRuleRow {
  id: string;
  condition_json: string;
  lane: string;
  reason: string;
  created_by: string;
  created_at: number;
  enabled: number;
}
