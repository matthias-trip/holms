import Database from "better-sqlite3";
import type { AgentActivity, BusEvent } from "@holms/shared";

export class ActivityStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_activities (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        agent_id TEXT,
        turn_id TEXT
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bus_events (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);

    // Migrate: add turn_id column if missing
    const columns = this.db.pragma("table_info(agent_activities)") as { name: string }[];
    if (!columns.some((c) => c.name === "turn_id")) {
      this.db.exec(`ALTER TABLE agent_activities ADD COLUMN turn_id TEXT`);
    }

    // Indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_agent_activities_ts ON agent_activities(timestamp DESC)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_bus_events_ts ON bus_events(timestamp DESC)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_agent_activities_turn ON agent_activities(turn_id)
    `);
  }

  addActivity(activity: AgentActivity): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO agent_activities (id, type, data, timestamp, agent_id, turn_id) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        activity.id,
        activity.type,
        JSON.stringify(activity.data),
        activity.timestamp,
        activity.agentId ?? null,
        activity.turnId ?? null,
      );
  }

  getActivities(limit = 100, before?: number): AgentActivity[] {
    const rows = before !== undefined
      ? this.db
          .prepare(
            `SELECT * FROM (SELECT * FROM agent_activities WHERE timestamp < ? ORDER BY timestamp DESC LIMIT ?) ORDER BY timestamp ASC`,
          )
          .all(before, limit) as ActivityRow[]
      : this.db
          .prepare(
            `SELECT * FROM (SELECT * FROM agent_activities ORDER BY timestamp DESC LIMIT ?) ORDER BY timestamp ASC`,
          )
          .all(limit) as ActivityRow[];

    return rows.map(mapRow);
  }

  getActivitiesByTurn(turnId: string): AgentActivity[] {
    const rows = this.db
      .prepare(`SELECT * FROM agent_activities WHERE turn_id = ? ORDER BY timestamp ASC`)
      .all(turnId) as ActivityRow[];
    return rows.map(mapRow);
  }

  getProactiveTurns(limit = 20): { turnId: string; activities: AgentActivity[] }[] {
    const turnStarts = this.db
      .prepare(
        `SELECT * FROM agent_activities
         WHERE type = 'turn_start' AND json_extract(data, '$.trigger') = 'proactive'
         ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(limit) as ActivityRow[];

    return turnStarts.map((row) => ({
      turnId: row.turn_id!,
      activities: this.getActivitiesByTurn(row.turn_id!),
    }));
  }

  getOrphanActivities(limit = 100): AgentActivity[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM (
          SELECT * FROM agent_activities WHERE turn_id IS NULL AND type != 'triage_classify' ORDER BY timestamp DESC LIMIT ?
          UNION ALL
          SELECT * FROM agent_activities WHERE turn_id IS NULL AND type = 'triage_classify' ORDER BY timestamp DESC LIMIT 20
        ) ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(limit, limit) as ActivityRow[];
    // Return in ascending order
    rows.reverse();
    return rows.map(mapRow);
  }

  getApprovalHistory(limit = 50): AgentActivity[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM (SELECT * FROM agent_activities WHERE type IN ('approval_pending', 'approval_resolved') ORDER BY timestamp DESC LIMIT ?) ORDER BY timestamp ASC`,
      )
      .all(limit) as ActivityRow[];
    return rows.map(mapRow);
  }

  getRecentTurns(limit = 50): { turnId: string; activities: AgentActivity[] }[] {
    const turnStarts = this.db
      .prepare(
        `SELECT * FROM agent_activities WHERE type = 'turn_start' ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(limit) as ActivityRow[];

    return turnStarts.reverse().map((row) => {
      const activities = this.getActivitiesByTurn(row.turn_id!);
      return { turnId: row.turn_id!, activities };
    });
  }

  addEvent(event: BusEvent): void {
    this.db
      .prepare(
        `INSERT INTO bus_events (type, data, timestamp) VALUES (?, ?, ?)`,
      )
      .run(event.type, JSON.stringify(event.data), event.timestamp);
  }

  getEvents(limit = 200, before?: number): BusEvent[] {
    const rows = before !== undefined
      ? this.db
          .prepare(
            `SELECT * FROM (SELECT * FROM bus_events WHERE timestamp < ? ORDER BY timestamp DESC LIMIT ?) ORDER BY timestamp ASC`,
          )
          .all(before, limit) as EventRow[]
      : this.db
          .prepare(
            `SELECT * FROM (SELECT * FROM bus_events ORDER BY timestamp DESC LIMIT ?) ORDER BY timestamp ASC`,
          )
          .all(limit) as EventRow[];

    return rows.map((r) => ({
      type: r.type,
      data: JSON.parse(r.data),
      timestamp: r.timestamp,
    }));
  }

  purge(maxAgeMs: number): { activities: number; events: number } {
    const cutoff = Date.now() - maxAgeMs;
    const activities = this.db.prepare(
      `DELETE FROM agent_activities WHERE timestamp < ?`,
    ).run(cutoff).changes;
    const events = this.db.prepare(
      `DELETE FROM bus_events WHERE timestamp < ?`,
    ).run(cutoff).changes;
    return { activities, events };
  }

  close(): void {
    this.db.close();
  }
}

function mapRow(r: ActivityRow): AgentActivity {
  return {
    id: r.id,
    type: r.type as AgentActivity["type"],
    data: JSON.parse(r.data),
    timestamp: r.timestamp,
    agentId: r.agent_id ?? undefined,
    turnId: r.turn_id ?? undefined,
  };
}

interface ActivityRow {
  id: string;
  type: string;
  data: string;
  timestamp: number;
  agent_id: string | null;
  turn_id: string | null;
}

interface EventRow {
  rowid: number;
  type: string;
  data: string;
  timestamp: number;
}
