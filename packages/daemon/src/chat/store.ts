import Database from "better-sqlite3";
import type { ChatMessage } from "@holms/shared";

export class ChatStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);
  }

  add(msg: ChatMessage): void {
    this.db
      .prepare(
        `INSERT INTO chat_messages (id, role, content, timestamp) VALUES (?, ?, ?, ?)`,
      )
      .run(msg.id, msg.role, msg.content, msg.timestamp);
  }

  getHistory(limit = 100, before?: number): ChatMessage[] {
    if (before !== undefined) {
      return this.db
        .prepare(
          `SELECT * FROM chat_messages WHERE timestamp < ? ORDER BY timestamp ASC LIMIT ?`,
        )
        .all(before, limit) as ChatMessage[];
    }

    // Get the last N messages in chronological order
    const rows = this.db
      .prepare(
        `SELECT * FROM (SELECT * FROM chat_messages ORDER BY timestamp DESC LIMIT ?) ORDER BY timestamp ASC`,
      )
      .all(limit) as ChatMessage[];
    return rows;
  }

  clear(): void {
    this.db.exec(`DELETE FROM chat_messages`);
  }

  close(): void {
    this.db.close();
  }
}
