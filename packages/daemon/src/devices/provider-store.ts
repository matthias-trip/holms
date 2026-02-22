import Database from "better-sqlite3";

interface ProviderConfigRow {
  id: string;
  enabled: number;
  config_json: string;
  created_at: number;
  updated_at: number;
}

export class DeviceProviderStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS device_provider_configs (
        id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        config_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  getConfig(id: string): { enabled: boolean; config: Record<string, unknown> } | null {
    const row = this.db.prepare("SELECT * FROM device_provider_configs WHERE id = ?").get(id) as ProviderConfigRow | undefined;
    if (!row) return null;
    return {
      enabled: row.enabled === 1,
      config: JSON.parse(row.config_json),
    };
  }

  setConfig(id: string, enabled: boolean, config: Record<string, unknown>): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO device_provider_configs (id, enabled, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        enabled = excluded.enabled,
        config_json = excluded.config_json,
        updated_at = excluded.updated_at
    `).run(id, enabled ? 1 : 0, JSON.stringify(config), now, now);
  }

  getAllConfigs(): Map<string, { enabled: boolean; config: Record<string, unknown> }> {
    const rows = this.db.prepare("SELECT * FROM device_provider_configs").all() as ProviderConfigRow[];
    const map = new Map<string, { enabled: boolean; config: Record<string, unknown> }>();
    for (const row of rows) {
      map.set(row.id, {
        enabled: row.enabled === 1,
        config: JSON.parse(row.config_json),
      });
    }
    return map;
  }

  close(): void {
    this.db.close();
  }
}
