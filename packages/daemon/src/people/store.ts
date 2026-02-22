import Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import type { Person, PersonChannel } from "@holms/shared";

interface PersonRow {
  id: string;
  name: string;
  primary_channel: string | null;
  created_at: number;
  updated_at: number;
}

interface PersonChannelRow {
  person_id: string;
  channel_id: string;
  sender_id: string | null;
}

export class PeopleStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS people (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        properties TEXT NOT NULL DEFAULT '{}',
        primary_channel TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS person_channels (
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        channel_id TEXT NOT NULL,
        sender_id TEXT,
        PRIMARY KEY (person_id, channel_id)
      )
    `);

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_person_channels_channel ON person_channels(channel_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_person_channels_sender ON person_channels(sender_id) WHERE sender_id IS NOT NULL`);

    // Enable foreign keys for CASCADE
    this.db.pragma("foreign_keys = ON");
  }

  create(name: string, primaryChannel?: string): Person {
    const id = uuid();
    const now = Date.now();
    this.db
      .prepare(`INSERT INTO people (id, name, properties, primary_channel, created_at, updated_at) VALUES (?, ?, '{}', ?, ?, ?)`)
      .run(id, name, primaryChannel ?? null, now, now);
    return this.get(id)!;
  }

  get(id: string): Person | undefined {
    const row = this.db.prepare(`SELECT * FROM people WHERE id = ?`).get(id) as PersonRow | undefined;
    if (!row) return undefined;
    return this.hydrate(row);
  }

  getAll(): Person[] {
    const rows = this.db.prepare(`SELECT * FROM people ORDER BY name`).all() as PersonRow[];
    return rows.map((r) => this.hydrate(r));
  }

  update(id: string, updates: { name?: string; primaryChannel?: string | null }): Person | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;

    const name = updates.name ?? existing.name;
    const primaryChannel = updates.primaryChannel !== undefined ? updates.primaryChannel : (existing.primaryChannel ?? null);
    const now = Date.now();

    this.db
      .prepare(`UPDATE people SET name = ?, primary_channel = ?, updated_at = ? WHERE id = ?`)
      .run(name, primaryChannel, now, id);

    return this.get(id);
  }

  remove(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM people WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  linkChannel(personId: string, channelId: string, senderId?: string): void {
    this.db
      .prepare(`INSERT OR REPLACE INTO person_channels (person_id, channel_id, sender_id) VALUES (?, ?, ?)`)
      .run(personId, channelId, senderId ?? null);

    this.db.prepare(`UPDATE people SET updated_at = ? WHERE id = ?`).run(Date.now(), personId);
  }

  unlinkChannel(personId: string, channelId: string): void {
    this.db
      .prepare(`DELETE FROM person_channels WHERE person_id = ? AND channel_id = ?`)
      .run(personId, channelId);

    this.db.prepare(`UPDATE people SET updated_at = ? WHERE id = ?`).run(Date.now(), personId);
  }

  resolveByChannel(channelId: string): Person | undefined {
    const row = this.db
      .prepare(`SELECT p.* FROM people p JOIN person_channels pc ON p.id = pc.person_id WHERE pc.channel_id = ?`)
      .get(channelId) as PersonRow | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  resolveBySenderId(senderId: string): Person | undefined {
    const row = this.db
      .prepare(`SELECT p.* FROM people p JOIN person_channels pc ON p.id = pc.person_id WHERE pc.sender_id = ?`)
      .get(senderId) as PersonRow | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  close(): void {
    this.db.close();
  }

  private hydrate(row: PersonRow): Person {
    const channelRows = this.db
      .prepare(`SELECT * FROM person_channels WHERE person_id = ?`)
      .all(row.id) as PersonChannelRow[];

    const channels: PersonChannel[] = channelRows.map((c) => ({
      channelId: c.channel_id,
      senderId: c.sender_id ?? undefined,
    }));

    return {
      id: row.id,
      name: row.name,
      primaryChannel: row.primary_channel ?? undefined,
      channels,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
