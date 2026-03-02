import Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import type { Person, PersonChannel, LocationZone, LocationUpdate } from "@holms/shared";

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

interface LocationZoneRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  created_at: number;
  updated_at: number;
}

interface LocationHistoryRow {
  id: string;
  person_id: string;
  zone_id: string | null;
  zone_name: string;
  event: string;
  timestamp: number;
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

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS location_zones (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        radius_meters REAL NOT NULL DEFAULT 100,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS location_history (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        zone_id TEXT,
        zone_name TEXT NOT NULL,
        event TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_location_history_person_time ON location_history(person_id, timestamp)`);

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

  // ── Zone CRUD ──────────────────────────────────────────────────────

  createZone(name: string, latitude: number, longitude: number, radiusMeters = 100): LocationZone {
    const id = uuid();
    const now = Date.now();
    this.db
      .prepare(`INSERT INTO location_zones (id, name, latitude, longitude, radius_meters, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, name, latitude, longitude, radiusMeters, now, now);
    return this.getZone(id)!;
  }

  getZone(id: string): LocationZone | undefined {
    const row = this.db.prepare(`SELECT * FROM location_zones WHERE id = ?`).get(id) as LocationZoneRow | undefined;
    return row ? this.hydrateZone(row) : undefined;
  }

  getZones(): LocationZone[] {
    const rows = this.db.prepare(`SELECT * FROM location_zones ORDER BY name`).all() as LocationZoneRow[];
    return rows.map((r) => this.hydrateZone(r));
  }

  updateZone(id: string, updates: { name?: string; latitude?: number; longitude?: number; radiusMeters?: number }): LocationZone | undefined {
    const existing = this.getZone(id);
    if (!existing) return undefined;
    const now = Date.now();
    this.db
      .prepare(`UPDATE location_zones SET name = ?, latitude = ?, longitude = ?, radius_meters = ?, updated_at = ? WHERE id = ?`)
      .run(
        updates.name ?? existing.name,
        updates.latitude ?? existing.latitude,
        updates.longitude ?? existing.longitude,
        updates.radiusMeters ?? existing.radiusMeters,
        now,
        id,
      );
    return this.getZone(id);
  }

  removeZone(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM location_zones WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  // ── Location History ──────────────────────────────────────────────

  recordLocationChange(personId: string, zoneId: string | null, zoneName: string, event: "enter" | "exit"): LocationUpdate {
    const id = uuid();
    const timestamp = Date.now();
    this.db
      .prepare(`INSERT INTO location_history (id, person_id, zone_id, zone_name, event, timestamp) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, personId, zoneId, zoneName, event, timestamp);
    return { zoneId, zoneName, event, timestamp };
  }

  getLocationHistory(personId: string, opts?: { limit?: number; since?: number; until?: number }): LocationUpdate[] {
    const limit = opts?.limit ?? 50;
    const conditions = ["person_id = ?"];
    const params: (string | number)[] = [personId];

    if (opts?.since) {
      conditions.push("timestamp >= ?");
      params.push(opts.since);
    }
    if (opts?.until) {
      conditions.push("timestamp <= ?");
      params.push(opts.until);
    }

    params.push(limit);
    const rows = this.db
      .prepare(`SELECT * FROM location_history WHERE ${conditions.join(" AND ")} ORDER BY timestamp DESC LIMIT ?`)
      .all(...params) as LocationHistoryRow[];

    return rows.map((r) => ({
      zoneId: r.zone_id,
      zoneName: r.zone_name,
      event: r.event as "enter" | "exit",
      timestamp: r.timestamp,
    }));
  }

  getCurrentLocation(personId: string): LocationUpdate | undefined {
    const row = this.db
      .prepare(`SELECT * FROM location_history WHERE person_id = ? ORDER BY timestamp DESC LIMIT 1`)
      .get(personId) as LocationHistoryRow | undefined;
    if (!row) return undefined;
    return {
      zoneId: row.zone_id,
      zoneName: row.zone_name,
      event: row.event as "enter" | "exit",
      timestamp: row.timestamp,
    };
  }

  private hydrateZone(row: LocationZoneRow): LocationZone {
    return {
      id: row.id,
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      radiusMeters: row.radius_meters,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
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
