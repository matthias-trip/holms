import Database from "better-sqlite3";
import type { Goal, GoalEvent, GoalStatus, GoalEventType } from "@holms/shared";
import { v4 as uuid } from "uuid";

interface GoalRow {
  id: string;
  title: string;
  description: string;
  summary: string | null;
  next_steps: string | null;
  status: string;
  needs_attention: number;
  attention_reason: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

interface GoalEventRow {
  id: number;
  goal_id: string;
  type: string;
  content: string;
  timestamp: number;
}

export class GoalStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        needs_attention INTEGER NOT NULL DEFAULT 0,
        attention_reason TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS goal_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_goal_events_goal_ts ON goal_events(goal_id, timestamp)`);

    // Migration: add summary column
    const cols = this.db.pragma("table_info(goals)") as { name: string }[];
    if (!cols.some((c) => c.name === "summary")) {
      this.db.exec(`ALTER TABLE goals ADD COLUMN summary TEXT`);
    }
    if (!cols.some((c) => c.name === "next_steps")) {
      this.db.exec(`ALTER TABLE goals ADD COLUMN next_steps TEXT`);
    }
  }

  create(title: string, description: string): Goal {
    const id = uuid();
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO goals (id, title, description, status, needs_attention, created_at, updated_at) VALUES (?, ?, ?, 'active', 0, ?, ?)`,
    ).run(id, title, description, now, now);

    console.log(`[Goals] Created goal "${title}" (${id})`);
    return this.get(id)!;
  }

  list(status?: GoalStatus): Goal[] {
    let rows: GoalRow[];
    if (status) {
      rows = this.db
        .prepare(`SELECT * FROM goals WHERE status = ? ORDER BY needs_attention DESC, updated_at DESC`)
        .all(status) as GoalRow[];
    } else {
      rows = this.db
        .prepare(`SELECT * FROM goals ORDER BY needs_attention DESC, updated_at DESC`)
        .all() as GoalRow[];
    }
    return rows.map((r) => this.rowToGoal(r));
  }

  get(id: string): Goal | null {
    const row = this.db.prepare(`SELECT * FROM goals WHERE id = ?`).get(id) as GoalRow | undefined;
    return row ? this.rowToGoal(row) : null;
  }

  update(
    id: string,
    updates: { status?: GoalStatus; needsAttention?: boolean; attentionReason?: string; title?: string; description?: string; summary?: string; nextSteps?: string },
  ): Goal | null {
    const existing = this.get(id);
    if (!existing) return null;

    const now = Date.now();
    const newStatus = updates.status ?? existing.status;
    const newAttention = updates.needsAttention !== undefined ? (updates.needsAttention ? 1 : 0) : (existing.needsAttention ? 1 : 0);
    const newReason = updates.attentionReason !== undefined ? updates.attentionReason : (existing.attentionReason ?? null);
    const newTitle = updates.title ?? existing.title;
    const newDescription = updates.description ?? existing.description;
    const newSummary = updates.summary !== undefined ? updates.summary : (existing.summary ?? null);
    const newNextSteps = updates.nextSteps !== undefined ? updates.nextSteps : (existing.nextSteps ?? null);
    const completedAt = (newStatus === "completed" || newStatus === "abandoned") && !existing.completedAt ? now : (existing.completedAt ?? null);

    this.db.prepare(
      `UPDATE goals SET title = ?, description = ?, summary = ?, next_steps = ?, status = ?, needs_attention = ?, attention_reason = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
    ).run(newTitle, newDescription, newSummary, newNextSteps, newStatus, newAttention, newReason, now, completedAt, id);

    // Auto-add status_change event if status changed
    if (updates.status && updates.status !== existing.status) {
      this.addEvent(id, "status_change", `Status changed from ${existing.status} to ${updates.status}`);
    }

    console.log(`[Goals] Updated goal ${id}: ${Object.keys(updates).join(", ")}`);
    return this.get(id);
  }

  addEvent(goalId: string, type: GoalEventType, content: string): GoalEvent {
    const now = Date.now();
    const result = this.db.prepare(
      `INSERT INTO goal_events (goal_id, type, content, timestamp) VALUES (?, ?, ?, ?)`,
    ).run(goalId, type, content, now);

    // Touch the goal's updated_at
    this.db.prepare(`UPDATE goals SET updated_at = ? WHERE id = ?`).run(now, goalId);

    return {
      id: Number(result.lastInsertRowid),
      goalId,
      type,
      content,
      timestamp: now,
    };
  }

  getEvents(goalId: string, limit: number = 50): GoalEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM goal_events WHERE goal_id = ? ORDER BY timestamp DESC LIMIT ?`)
      .all(goalId, limit) as GoalEventRow[];
    return rows.map((r) => ({
      id: r.id,
      goalId: r.goal_id,
      type: r.type as GoalEventType,
      content: r.content,
      timestamp: r.timestamp,
    }));
  }

  delete(id: string): boolean {
    // SQLite cascades handle goal_events
    const result = this.db.prepare(`DELETE FROM goals WHERE id = ?`).run(id);
    console.log(`[Goals] Delete ${id}: ${result.changes > 0 ? "deleted" : "not found"}`);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }

  private rowToGoal(row: GoalRow): Goal {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      summary: row.summary ?? undefined,
      nextSteps: row.next_steps ?? undefined,
      status: row.status as GoalStatus,
      needsAttention: row.needs_attention === 1,
      attentionReason: row.attention_reason ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at ?? undefined,
    };
  }
}
