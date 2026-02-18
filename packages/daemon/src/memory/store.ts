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
        scope TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Migration: add scope column if missing
    const columns = this.db
      .prepare(`PRAGMA table_info(memories)`)
      .all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === "scope")) {
      this.db.exec(`ALTER TABLE memories ADD COLUMN scope TEXT`);
    }
  }

  remember(
    key: string,
    content: string,
    type: MemoryType,
    tags: string[] = [],
    scope: string | null = null,
  ): Memory {
    const now = Date.now();
    const existing = this.get(key);

    if (existing) {
      this.db
        .prepare(
          `UPDATE memories SET content = ?, type = ?, tags = ?, scope = ?, updated_at = ? WHERE key = ?`,
        )
        .run(content, type, JSON.stringify(tags), scope, now, key);
    } else {
      this.db
        .prepare(
          `INSERT INTO memories (key, content, type, tags, scope, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(key, content, type, JSON.stringify(tags), scope, now, now);
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

  recallScoped(query: string, scopes: string[]): Memory[] {
    if (scopes.length === 0) {
      return this.recall(query);
    }
    const placeholders = scopes.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT * FROM memories WHERE (scope IS NULL OR scope IN (${placeholders})) AND (content LIKE ? OR key LIKE ? OR tags LIKE ?) ORDER BY updated_at DESC`,
      )
      .all(...scopes, `%${query}%`, `%${query}%`, `%${query}%`) as MemoryRow[];
    return rows.map((r) => this.rowToMemory(r));
  }

  getAllScoped(scopes: string[]): Memory[] {
    if (scopes.length === 0) {
      return this.getAll();
    }
    const placeholders = scopes.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT * FROM memories WHERE scope IS NULL OR scope IN (${placeholders}) ORDER BY updated_at DESC`,
      )
      .all(...scopes) as MemoryRow[];
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

  recallScopedMulti(queries: string[], scopes: string[]): Memory[] {
    const seen = new Set<string>();
    const results: Memory[] = [];
    for (const query of queries) {
      for (const memory of this.recallScoped(query, scopes)) {
        if (!seen.has(memory.key)) {
          seen.add(memory.key);
          results.push(memory);
        }
      }
    }
    return results;
  }

  recallMulti(queries: string[]): Memory[] {
    const seen = new Set<string>();
    const results: Memory[] = [];
    for (const query of queries) {
      for (const memory of this.recall(query)) {
        if (!seen.has(memory.key)) {
          seen.add(memory.key);
          results.push(memory);
        }
      }
    }
    return results;
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
      scope: row.scope ?? null,
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
  scope: string | null;
  created_at: number;
  updated_at: number;
}
