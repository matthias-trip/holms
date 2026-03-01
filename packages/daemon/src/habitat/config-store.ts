import type Database from "better-sqlite3";
import type {
  AdapterConfig,
  SpaceConfig,
  SourceConfig,
  SourcePropertyConfig,
  PropertyName,
} from "./types.js";

export class HabitatConfigStore {
  constructor(private db: Database.Database) {
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS spaces (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        floor TEXT
      );

      CREATE TABLE IF NOT EXISTS adapters (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        config TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        adapter_id TEXT NOT NULL REFERENCES adapters(id) ON DELETE CASCADE,
        entity_id TEXT NOT NULL,
        UNIQUE(adapter_id, entity_id)
      );

      CREATE TABLE IF NOT EXISTS source_properties (
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        property TEXT NOT NULL,
        role TEXT NOT NULL,
        mounting TEXT,
        features TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (source_id, property)
      );

      CREATE TABLE IF NOT EXISTS source_state (
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        property TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT '{}',
        previous_state TEXT,
        timestamp INTEGER NOT NULL,
        PRIMARY KEY (source_id, property)
      );

      CREATE TABLE IF NOT EXISTS source_collection_items (
        source_id  TEXT    NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        property   TEXT    NOT NULL,
        item_id    TEXT    NOT NULL,
        data       TEXT    NOT NULL DEFAULT '{}',
        starts_at  INTEGER,
        ends_at    INTEGER,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (source_id, property, item_id)
      );

      CREATE INDEX IF NOT EXISTS idx_collection_time
        ON source_collection_items(source_id, property, starts_at);
    `);

    // Additive migration: display_name for adapters
    try {
      this.db.exec("ALTER TABLE adapters ADD COLUMN display_name TEXT");
    } catch {
      // Column already exists
    }
  }

  // ── Spaces ──────────────────────────────────────────────────────────────

  listSpaces(): SpaceConfig[] {
    return this.db
      .prepare("SELECT id, display_name as displayName, floor FROM spaces")
      .all() as SpaceConfig[];
  }

  getSpace(id: string): SpaceConfig | undefined {
    return this.db
      .prepare("SELECT id, display_name as displayName, floor FROM spaces WHERE id = ?")
      .get(id) as SpaceConfig | undefined;
  }

  createSpace(space: SpaceConfig): void {
    this.db
      .prepare("INSERT INTO spaces (id, display_name, floor) VALUES (?, ?, ?)")
      .run(space.id, space.displayName, space.floor ?? null);
  }

  updateSpace(id: string, updates: Partial<Omit<SpaceConfig, "id">>): void {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.displayName !== undefined) {
      fields.push("display_name = ?");
      values.push(updates.displayName);
    }
    if (updates.floor !== undefined) {
      fields.push("floor = ?");
      values.push(updates.floor);
    }
    if (fields.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE spaces SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  }

  deleteSpace(id: string): void {
    this.db.prepare("DELETE FROM spaces WHERE id = ?").run(id);
  }

  // ── Sources ─────────────────────────────────────────────────────────────

  listSources(spaceId?: string): SourceConfig[] {
    if (spaceId) {
      return this.db
        .prepare(
          "SELECT id, space_id as spaceId, adapter_id as adapterId, entity_id as entityId FROM sources WHERE space_id = ?",
        )
        .all(spaceId) as SourceConfig[];
    }
    return this.db
      .prepare(
        "SELECT id, space_id as spaceId, adapter_id as adapterId, entity_id as entityId FROM sources",
      )
      .all() as SourceConfig[];
  }

  getSource(id: string): SourceConfig | undefined {
    return this.db
      .prepare(
        "SELECT id, space_id as spaceId, adapter_id as adapterId, entity_id as entityId FROM sources WHERE id = ?",
      )
      .get(id) as SourceConfig | undefined;
  }

  createSource(source: SourceConfig): void {
    this.db
      .prepare("INSERT INTO sources (id, space_id, adapter_id, entity_id) VALUES (?, ?, ?, ?)")
      .run(source.id, source.spaceId, source.adapterId, source.entityId);
  }

  deleteSource(id: string): void {
    this.db.prepare("DELETE FROM sources WHERE id = ?").run(id);
  }

  // ── Source Properties ───────────────────────────────────────────────────

  listSourceProperties(sourceId: string): SourcePropertyConfig[] {
    const rows = this.db
      .prepare(
        "SELECT source_id as sourceId, property, role, mounting, features FROM source_properties WHERE source_id = ?",
      )
      .all(sourceId) as Array<{
      sourceId: string;
      property: PropertyName;
      role: string;
      mounting: string | null;
      features: string;
    }>;
    return rows.map((r) => ({
      sourceId: r.sourceId,
      property: r.property,
      role: r.role,
      mounting: r.mounting ?? undefined,
      features: JSON.parse(r.features) as string[],
    }));
  }

  setSourceProperty(prop: SourcePropertyConfig): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO source_properties (source_id, property, role, mounting, features)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        prop.sourceId,
        prop.property,
        prop.role,
        prop.mounting ?? null,
        JSON.stringify(prop.features),
      );
  }

  deleteSourceProperty(sourceId: string, property: PropertyName): void {
    this.db
      .prepare("DELETE FROM source_properties WHERE source_id = ? AND property = ?")
      .run(sourceId, property);
  }

  // ── Adapters ────────────────────────────────────────────────────────────

  listAdapters(): AdapterConfig[] {
    const rows = this.db.prepare("SELECT id, type, display_name, config FROM adapters").all() as Array<{
      id: string;
      type: string;
      display_name: string | null;
      config: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      ...(r.display_name ? { displayName: r.display_name } : {}),
      config: JSON.parse(r.config) as Record<string, unknown>,
    }));
  }

  getAdapter(id: string): AdapterConfig | undefined {
    const row = this.db.prepare("SELECT id, type, display_name, config FROM adapters WHERE id = ?").get(id) as
      | { id: string; type: string; display_name: string | null; config: string }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      type: row.type,
      ...(row.display_name ? { displayName: row.display_name } : {}),
      config: JSON.parse(row.config),
    };
  }

  createAdapter(adapter: AdapterConfig): void {
    this.db
      .prepare("INSERT INTO adapters (id, type, display_name, config) VALUES (?, ?, ?, ?)")
      .run(adapter.id, adapter.type, adapter.displayName ?? null, JSON.stringify(adapter.config));
  }

  updateAdapter(id: string, updates: Partial<Omit<AdapterConfig, "id">>): void {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.type !== undefined) {
      fields.push("type = ?");
      values.push(updates.type);
    }
    if (updates.displayName !== undefined) {
      fields.push("display_name = ?");
      values.push(updates.displayName);
    }
    if (updates.config !== undefined) {
      fields.push("config = ?");
      values.push(JSON.stringify(updates.config));
    }
    if (fields.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE adapters SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  }

  deleteAdapter(id: string): void {
    this.db.prepare("DELETE FROM adapters WHERE id = ?").run(id);
  }

  // ── Source State ───────────────────────────────────────────────────────

  upsertState(
    sourceId: string,
    property: string,
    state: Record<string, unknown>,
    previousState: Record<string, unknown> | undefined,
    timestamp: number,
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO source_state (source_id, property, state, previous_state, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sourceId, property, JSON.stringify(state), previousState ? JSON.stringify(previousState) : null, timestamp);
  }

  getState(sourceId: string, property: string): { state: Record<string, unknown>; timestamp: number } | null {
    const row = this.db
      .prepare("SELECT state, timestamp FROM source_state WHERE source_id = ? AND property = ?")
      .get(sourceId, property) as { state: string; timestamp: number } | undefined;
    if (!row) return null;
    return { state: JSON.parse(row.state), timestamp: row.timestamp };
  }

  getAllState(): Map<string, Record<string, unknown>> {
    const rows = this.db
      .prepare("SELECT source_id, property, state FROM source_state")
      .all() as Array<{ source_id: string; property: string; state: string }>;
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      map.set(`${r.source_id}:${r.property}`, JSON.parse(r.state));
    }
    return map;
  }

  getStateForSource(sourceId: string): Array<{ property: string; state: Record<string, unknown>; timestamp: number }> {
    const rows = this.db
      .prepare("SELECT property, state, timestamp FROM source_state WHERE source_id = ?")
      .all(sourceId) as Array<{ property: string; state: string; timestamp: number }>;
    return rows.map((r) => ({ property: r.property, state: JSON.parse(r.state), timestamp: r.timestamp }));
  }

  // ── Collection Items ──────────────────────────────────────────────────

  syncCollectionItems(
    sourceId: string,
    property: string,
    items: Record<string, unknown>[],
    fetchedAt: number,
  ): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO source_collection_items (source_id, property, item_id, data, starts_at, ends_at, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = this.db.transaction(() => {
      for (const item of items) {
        const itemId = String(item.id ?? item.uid ?? "");
        if (!itemId) continue;
        const data = { ...item };
        delete data.id;
        const startsAt = typeof item.start === "number" ? item.start : null;
        const endsAt = typeof item.end === "number" ? item.end : null;
        stmt.run(sourceId, property, itemId, JSON.stringify(data), startsAt, endsAt, fetchedAt);
      }
    });
    tx();
  }

  getCollectionItems(
    sourceId: string,
    property: string,
    opts?: { from?: number; to?: number },
  ): Array<{ item_id: string; data: Record<string, unknown>; starts_at: number | null; ends_at: number | null; fetched_at: number }> {
    let sql = "SELECT item_id, data, starts_at, ends_at, fetched_at FROM source_collection_items WHERE source_id = ? AND property = ?";
    const params: unknown[] = [sourceId, property];

    if (opts?.from !== undefined) {
      sql += " AND (ends_at IS NULL OR ends_at >= ?)";
      params.push(opts.from);
    }
    if (opts?.to !== undefined) {
      sql += " AND (starts_at IS NULL OR starts_at <= ?)";
      params.push(opts.to);
    }

    sql += " ORDER BY starts_at ASC NULLS LAST";

    const rows = this.db.prepare(sql).all(...params) as Array<{
      item_id: string;
      data: string;
      starts_at: number | null;
      ends_at: number | null;
      fetched_at: number;
    }>;

    return rows.map((r) => ({
      item_id: r.item_id,
      data: JSON.parse(r.data),
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      fetched_at: r.fetched_at,
    }));
  }

  deleteCollectionItems(sourceId: string, property: string, itemIds: string[]): void {
    if (itemIds.length === 0) return;
    const placeholders = itemIds.map(() => "?").join(", ");
    this.db
      .prepare(`DELETE FROM source_collection_items WHERE source_id = ? AND property = ? AND item_id IN (${placeholders})`)
      .run(sourceId, property, ...itemIds);
  }

  pruneCollectionItems(sourceId: string, property: string, beforeMs: number): void {
    this.db
      .prepare("DELETE FROM source_collection_items WHERE source_id = ? AND property = ? AND ends_at IS NOT NULL AND ends_at < ?")
      .run(sourceId, property, beforeMs);
  }

  // ── Bulk Load ───────────────────────────────────────────────────────────

  loadAll(): {
    spaces: SpaceConfig[];
    sources: SourceConfig[];
    sourceProperties: SourcePropertyConfig[];
    adapters: AdapterConfig[];
  } {
    return {
      spaces: this.listSpaces(),
      sources: this.listSources(),
      sourceProperties: this.db
        .prepare("SELECT source_id as sourceId, property, role, mounting, features FROM source_properties")
        .all()
        .map((r: any) => ({
          sourceId: r.sourceId,
          property: r.property,
          role: r.role,
          mounting: r.mounting ?? undefined,
          features: JSON.parse(r.features) as string[],
        })),
      adapters: this.listAdapters(),
    };
  }
}
