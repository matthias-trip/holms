import Database from "better-sqlite3";
import type { ChatMessage } from "@holms/shared";

interface ChatMessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  status: string | null;
  approval_id: string | null;
}

function rowToMessage(row: ChatMessageRow): ChatMessage {
  const msg: ChatMessage = {
    id: row.id,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
  };
  if (row.status) msg.status = row.status as ChatMessage["status"];
  if (row.approval_id) msg.approvalId = row.approval_id;
  return msg;
}

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

    // Migrate: add status column if missing
    const columns = this.db.pragma("table_info(chat_messages)") as { name: string }[];
    if (!columns.some((c) => c.name === "status")) {
      this.db.exec(`ALTER TABLE chat_messages ADD COLUMN status TEXT`);
    }

    // Migrate: add approval_id column if missing
    if (!columns.some((c) => c.name === "approval_id")) {
      this.db.exec(`ALTER TABLE chat_messages ADD COLUMN approval_id TEXT`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_approval_id ON chat_messages(approval_id) WHERE approval_id IS NOT NULL`);
    }
  }

  add(msg: ChatMessage): void {
    this.db
      .prepare(
        `INSERT INTO chat_messages (id, role, content, timestamp, status, approval_id) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(msg.id, msg.role, msg.content, msg.timestamp, msg.status ?? null, msg.approvalId ?? null);
  }

  updateMessage(id: string, fields: { content?: string; status?: string | null; timestamp?: number }): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (fields.content !== undefined) { sets.push("content = ?"); values.push(fields.content); }
    if ("status" in fields) { sets.push("status = ?"); values.push(fields.status ?? null); }
    if (fields.timestamp !== undefined) { sets.push("timestamp = ?"); values.push(fields.timestamp); }
    if (sets.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE chat_messages SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  }

  getHistory(limit = 100, before?: number): ChatMessage[] {
    if (before !== undefined) {
      return (this.db
        .prepare(
          `SELECT id, role, content, timestamp, status, approval_id FROM chat_messages WHERE timestamp < ? ORDER BY timestamp ASC LIMIT ?`,
        )
        .all(before, limit) as ChatMessageRow[]).map(rowToMessage);
    }

    return (this.db
      .prepare(
        `SELECT id, role, content, timestamp, status, approval_id FROM (SELECT * FROM chat_messages ORDER BY timestamp DESC LIMIT ?) ORDER BY timestamp ASC`,
      )
      .all(limit) as ChatMessageRow[]).map(rowToMessage);
  }

  /** Find a chat message by its approval_id column */
  findByApprovalId(approvalId: string): ChatMessage | undefined {
    const row = this.db
      .prepare(
        `SELECT id, role, content, timestamp, status, approval_id FROM chat_messages WHERE approval_id = ?`,
      )
      .get(approvalId) as ChatMessageRow | undefined;
    return row ? rowToMessage(row) : undefined;
  }

  clear(): void {
    this.db.exec(`DELETE FROM chat_messages`);
  }

  close(): void {
    this.db.close();
  }
}
