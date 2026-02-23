import { DuckDBInstance, DuckDBConnection, timestampValue } from "@duckdb/node-api";

export interface HistoryRow {
  entity_id: string;
  timestamp: Date;
  value_num: number | null;
  value_str: string | null;
  domain: string;
  area: string;
}

export interface CatalogEntry {
  entity_id: string;
  friendly_name: string;
  domain: string;
  area: string;
  unit: string;
  value_type: "numeric" | "categorical" | "boolean";
  first_seen: Date;
  last_seen: Date;
  sample_count: number;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  columnNames: string[];
  columnTypes: string[];
  executionTimeMs: number;
}

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS entity_history (
    entity_id VARCHAR NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    value_num DOUBLE,
    value_str VARCHAR,
    domain VARCHAR,
    area VARCHAR
  )`,
  `CREATE TABLE IF NOT EXISTS entity_catalog (
    entity_id VARCHAR PRIMARY KEY,
    friendly_name VARCHAR,
    domain VARCHAR,
    area VARCHAR,
    unit VARCHAR,
    value_type VARCHAR,
    first_seen TIMESTAMPTZ,
    last_seen TIMESTAMPTZ,
    sample_count INTEGER DEFAULT 0
  )`,
];

const ROW_LIMIT = 10000;
const QUERY_TIMEOUT_MS = 30_000;

function dateToTimestamp(d: Date) {
  return timestampValue(BigInt(d.getTime()) * 1000n);
}

export class HistoryStore {
  private constructor(
    private instance: DuckDBInstance,
    private writeConn: DuckDBConnection,
    private readConn: DuckDBConnection,
  ) {}

  static async create(dbPath: string): Promise<HistoryStore> {
    const instance = await DuckDBInstance.create(dbPath);
    const writeConn = await instance.connect();
    const readConn = await instance.connect();

    for (const stmt of SCHEMA_SQL) {
      await writeConn.run(stmt);
    }

    console.log(`[Init] History store initialized (${dbPath})`);
    return new HistoryStore(instance, writeConn, readConn);
  }

  async insertBatch(rows: HistoryRow[]): Promise<void> {
    if (rows.length === 0) return;

    const appender = await this.writeConn.createAppender("entity_history");
    for (const row of rows) {
      appender.appendVarchar(row.entity_id);
      appender.appendTimestamp(dateToTimestamp(row.timestamp));
      if (row.value_num !== null) {
        appender.appendDouble(row.value_num);
      } else {
        appender.appendNull();
      }
      if (row.value_str !== null) {
        appender.appendVarchar(row.value_str);
      } else {
        appender.appendNull();
      }
      appender.appendVarchar(row.domain);
      appender.appendVarchar(row.area);
      appender.endRow();
    }
    appender.flushSync();
    appender.closeSync();
  }

  async upsertCatalog(entry: CatalogEntry): Promise<void> {
    await this.writeConn.run(
      `INSERT OR REPLACE INTO entity_catalog
        (entity_id, friendly_name, domain, area, unit, value_type, first_seen, last_seen, sample_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.entity_id,
        entry.friendly_name,
        entry.domain,
        entry.area,
        entry.unit,
        entry.value_type,
        entry.first_seen.toISOString(),
        entry.last_seen.toISOString(),
        entry.sample_count,
      ],
    );
  }

  async refreshCatalog(): Promise<void> {
    await this.writeConn.run(`
      UPDATE entity_catalog SET
        last_seen = sub.last_seen,
        sample_count = sub.cnt
      FROM (
        SELECT entity_id, MAX(timestamp) as last_seen, COUNT(*) as cnt
        FROM entity_history
        GROUP BY entity_id
      ) sub
      WHERE entity_catalog.entity_id = sub.entity_id
    `);
  }

  async query(sql: string): Promise<QueryResult> {
    const trimmed = sql.trim();
    const upper = trimmed.toUpperCase();

    if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) {
      throw new Error("Only SELECT or WITH queries are allowed");
    }

    if (trimmed.includes(";")) {
      throw new Error("Statement chaining (;) is not allowed");
    }

    const wrappedSql = `SELECT * FROM (${trimmed}) __limited LIMIT ${ROW_LIMIT + 1}`;

    const start = Date.now();

    const reader = await Promise.race([
      this.readConn.runAndReadAll(wrappedSql),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Query timed out (30s limit)")), QUERY_TIMEOUT_MS),
      ),
    ]);

    const executionTimeMs = Date.now() - start;
    const rowsJson = reader.getRowObjectsJson() as Record<string, unknown>[];

    if (rowsJson.length > ROW_LIMIT) {
      throw new Error(
        `Query returned more than ${ROW_LIMIT} rows. Add aggregation (GROUP BY, time_bucket) or filters (WHERE) to reduce result size.`,
      );
    }

    const colNames = reader.columnNames();
    const colTypes = reader.columnTypes().map((t) => String(t));

    return {
      rows: rowsJson,
      rowCount: rowsJson.length,
      columnNames: colNames,
      columnTypes: colTypes,
      executionTimeMs,
    };
  }

  async getCatalog(filters?: {
    domain?: string;
    search?: string;
    value_type?: string;
  }): Promise<Record<string, unknown>[]> {
    const conditions: string[] = [];
    if (filters?.domain) {
      conditions.push(`domain = '${filters.domain.replace(/'/g, "''")}'`);
    }
    if (filters?.value_type) {
      conditions.push(`value_type = '${filters.value_type.replace(/'/g, "''")}'`);
    }
    if (filters?.search) {
      const escaped = filters.search.replace(/'/g, "''");
      conditions.push(
        `(entity_id ILIKE '%${escaped}%' OR friendly_name ILIKE '%${escaped}%')`,
      );
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const reader = await this.readConn.runAndReadAll(
      `SELECT * FROM entity_catalog ${where} ORDER BY sample_count DESC`,
    );
    return reader.getRowObjectsJson() as Record<string, unknown>[];
  }

  async deleteByEntityPrefix(
    prefix: string,
    start: Date,
    end: Date,
  ): Promise<void> {
    await this.writeConn.run(
      `DELETE FROM entity_history WHERE entity_id LIKE $1 AND timestamp >= $2 AND timestamp <= $3`,
      [`${prefix}%`, start.toISOString(), end.toISOString()],
    );
    await this.writeConn.run(
      `DELETE FROM entity_catalog WHERE entity_id LIKE $1`,
      [`${prefix}%`],
    );
  }

  async close(): Promise<void> {
    this.readConn.closeSync();
    this.writeConn.closeSync();
    this.instance.closeSync();
  }
}
