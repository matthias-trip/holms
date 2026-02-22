import Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import type { ChannelRoute } from "@holms/shared";
import type { ChannelConversation } from "./types.js";

interface ChannelConfigRow {
  id: string;
  enabled: number;
  config_json: string;
  created_at: number;
  updated_at: number;
}

export class ChannelStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS channel_configs (
        id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        config_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channel_routes (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channel_conversations (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        external_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        topic TEXT,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  getConfig(id: string): { enabled: boolean; config: Record<string, unknown> } | null {
    const row = this.db.prepare("SELECT * FROM channel_configs WHERE id = ?").get(id) as ChannelConfigRow | undefined;
    if (!row) return null;
    return {
      enabled: row.enabled === 1,
      config: JSON.parse(row.config_json),
    };
  }

  setConfig(id: string, enabled: boolean, config: Record<string, unknown>): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO channel_configs (id, enabled, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        enabled = excluded.enabled,
        config_json = excluded.config_json,
        updated_at = excluded.updated_at
    `).run(id, enabled ? 1 : 0, JSON.stringify(config), now, now);
  }

  getAllConfigs(): Map<string, { enabled: boolean; config: Record<string, unknown> }> {
    const rows = this.db.prepare("SELECT * FROM channel_configs").all() as ChannelConfigRow[];
    const map = new Map<string, { enabled: boolean; config: Record<string, unknown> }>();
    for (const row of rows) {
      map.set(row.id, {
        enabled: row.enabled === 1,
        config: JSON.parse(row.config_json),
      });
    }
    return map;
  }

  getRoutes(): ChannelRoute[] {
    const rows = this.db.prepare("SELECT * FROM channel_routes ORDER BY created_at DESC").all() as any[];
    return rows.map((r) => ({
      id: r.id,
      eventType: r.event_type,
      channelId: r.channel_id,
      enabled: r.enabled === 1,
      createdAt: r.created_at,
    }));
  }

  getRoutesForEvent(eventType: string): ChannelRoute[] {
    const rows = this.db.prepare(
      "SELECT * FROM channel_routes WHERE event_type = ? AND enabled = 1"
    ).all(eventType) as any[];
    return rows.map((r) => ({
      id: r.id,
      eventType: r.event_type,
      channelId: r.channel_id,
      enabled: r.enabled === 1,
      createdAt: r.created_at,
    }));
  }

  addRoute(eventType: string, channelId: string): ChannelRoute {
    const id = uuid();
    const now = Date.now();
    this.db.prepare(
      "INSERT INTO channel_routes (id, event_type, channel_id, enabled, created_at) VALUES (?, ?, ?, 1, ?)"
    ).run(id, eventType, channelId, now);
    return { id, eventType: eventType as any, channelId, enabled: true, createdAt: now };
  }

  removeRoute(id: string): void {
    this.db.prepare("DELETE FROM channel_routes WHERE id = ?").run(id);
  }

  toggleRoute(id: string, enabled: boolean): void {
    this.db.prepare("UPDATE channel_routes SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  }

  getConversationsByProvider(providerId: string): ChannelConversation[] {
    const rows = this.db.prepare(
      "SELECT * FROM channel_conversations WHERE provider_id = ? ORDER BY updated_at DESC"
    ).all(providerId) as any[];
    return rows.map((r) => ({
      id: r.id,
      providerId: r.provider_id,
      externalId: r.external_id,
      displayName: r.display_name,
      topic: r.topic ?? undefined,
    }));
  }

  upsertConversation(conv: ChannelConversation): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO channel_conversations (id, provider_id, external_id, display_name, topic, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        topic = excluded.topic,
        updated_at = excluded.updated_at
    `).run(conv.id, conv.providerId, conv.externalId, conv.displayName, conv.topic ?? null, now);
  }

  removeConversation(id: string): void {
    this.db.prepare("DELETE FROM channel_conversations WHERE id = ?").run(id);
  }

  close(): void {
    this.db.close();
  }
}
