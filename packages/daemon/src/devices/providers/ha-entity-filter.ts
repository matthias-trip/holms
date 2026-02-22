import Database from "better-sqlite3";

export class HAEntityFilter {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ha_entity_filter (
        entity_id TEXT PRIMARY KEY,
        added_at INTEGER NOT NULL
      )
    `);
  }

  /** Get all allowed entity IDs */
  getAllowed(): Set<string> {
    const rows = this.db.prepare("SELECT entity_id FROM ha_entity_filter").all() as { entity_id: string }[];
    return new Set(rows.map((r) => r.entity_id));
  }

  /** Check if an entity is allowed */
  isAllowed(entityId: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM ha_entity_filter WHERE entity_id = ?").get(entityId);
    return !!row;
  }

  /** Set the full list of allowed entities (replaces existing) */
  setAllowed(entityIds: string[]): void {
    const now = Date.now();
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM ha_entity_filter").run();
      const insert = this.db.prepare("INSERT INTO ha_entity_filter (entity_id, added_at) VALUES (?, ?)");
      for (const id of entityIds) {
        insert.run(id, now);
      }
    });
    tx();
  }

  /** Get count of allowed entities */
  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM ha_entity_filter").get() as { cnt: number };
    return row.cnt;
  }

  close(): void {
    this.db.close();
  }
}
