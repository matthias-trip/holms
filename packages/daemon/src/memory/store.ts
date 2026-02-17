import Database from "better-sqlite3";
import type { Memory, MemoryType } from "@holms/shared";

export class MemoryStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        key TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        type TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  remember(
    key: string,
    content: string,
    type: MemoryType,
    tags: string[] = [],
  ): Memory {
    const now = Date.now();
    const existing = this.get(key);

    if (existing) {
      this.db
        .prepare(
          `UPDATE memories SET content = ?, type = ?, tags = ?, updated_at = ? WHERE key = ?`,
        )
        .run(content, type, JSON.stringify(tags), now, key);
    } else {
      this.db
        .prepare(
          `INSERT INTO memories (key, content, type, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(key, content, type, JSON.stringify(tags), now, now);
    }

    return this.get(key)!;
  }

  get(key: string): Memory | undefined {
    const row = this.db
      .prepare(`SELECT * FROM memories WHERE key = ?`)
      .get(key) as MemoryRow | undefined;
    return row ? this.rowToMemory(row) : undefined;
  }

  recall(query: string): Memory[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM memories WHERE content LIKE ? OR key LIKE ? OR tags LIKE ? ORDER BY updated_at DESC`,
      )
      .all(`%${query}%`, `%${query}%`, `%${query}%`) as MemoryRow[];
    return rows.map((r) => this.rowToMemory(r));
  }

  forget(key: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM memories WHERE key = ?`)
      .run(key);
    return result.changes > 0;
  }

  getByType(type: MemoryType): Memory[] {
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE type = ? ORDER BY updated_at DESC`)
      .all(type) as MemoryRow[];
    return rows.map((r) => this.rowToMemory(r));
  }

  getAll(): Memory[] {
    const rows = this.db
      .prepare(`SELECT * FROM memories ORDER BY updated_at DESC`)
      .all() as MemoryRow[];
    return rows.map((r) => this.rowToMemory(r));
  }

  close(): void {
    this.db.close();
  }

  private rowToMemory(row: MemoryRow): Memory {
    return {
      key: row.key,
      content: row.content,
      type: row.type as MemoryType,
      tags: JSON.parse(row.tags),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

interface MemoryRow {
  key: string;
  content: string;
  type: string;
  tags: string;
  created_at: number;
  updated_at: number;
}
