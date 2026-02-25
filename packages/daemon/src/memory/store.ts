import Database from "better-sqlite3";
import type { Memory, ScoredMemory, MemoryQueryMeta, MemoryReflectStats } from "@holms/shared";
import { createEmbeddingPipeline, cosineSimilarity, EMBEDDING_DIM, type EmbeddingPipeline } from "./embeddings.js";

interface MemoryRow {
  id: number;
  content: string;
  retrieval_cues: string;
  tags: string;
  type: string;
  entity_id: string | null;
  person_id: string | null;
  pinned: number;
  scope: string | null;
  embedding: Buffer | null;
  access_count: number;
  last_accessed_at: number | null;
  created_at: number;
  updated_at: number;
}

export class MemoryStore {
  private db: Database.Database;
  private embedder: EmbeddingPipeline;

  private constructor(db: Database.Database, embedder: EmbeddingPipeline) {
    this.db = db;
    this.embedder = embedder;
  }

  static async create(dbPath: string, hfCacheDir: string): Promise<MemoryStore> {
    const db = new Database(dbPath);

    // Migrate from memories_v2 to memories if needed
    const hasV2 = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memories_v2'`).get();
    const hasMemories = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memories'`).get();

    if (hasV2 && !hasMemories) {
      db.exec(`ALTER TABLE memories_v2 RENAME TO memories`);
    } else if (!hasMemories) {
      db.exec(`
        CREATE TABLE memories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content TEXT NOT NULL,
          retrieval_cues TEXT NOT NULL,
          tags TEXT NOT NULL DEFAULT '[]',
          type TEXT NOT NULL DEFAULT 'memory',
          entity_id TEXT,
          person_id TEXT,
          pinned INTEGER NOT NULL DEFAULT 0,
          scope TEXT,
          embedding BLOB,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
    }

    // Drop the old v2 table if both exist (shouldn't happen, but safety)
    if (hasV2 && hasMemories) {
      db.exec(`DROP TABLE IF EXISTS memories_v2`);
    }

    // Add new columns if missing (migration for existing memories table)
    const cols = db.prepare(`PRAGMA table_info(memories)`).all() as { name: string }[];
    const colNames = new Set(cols.map((c) => c.name));

    if (!colNames.has("type")) {
      db.exec(`ALTER TABLE memories ADD COLUMN type TEXT NOT NULL DEFAULT 'memory'`);
    }
    if (!colNames.has("entity_id")) {
      db.exec(`ALTER TABLE memories ADD COLUMN entity_id TEXT`);
    }
    if (!colNames.has("scope")) {
      db.exec(`ALTER TABLE memories ADD COLUMN scope TEXT`);
    }
    if (!colNames.has("person_id")) {
      db.exec(`ALTER TABLE memories ADD COLUMN person_id TEXT`);
    }
    if (!colNames.has("pinned")) {
      db.exec(`ALTER TABLE memories ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`);
    }
    if (!colNames.has("access_count")) {
      db.exec(`ALTER TABLE memories ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0`);
    }
    if (!colNames.has("last_accessed_at")) {
      db.exec(`ALTER TABLE memories ADD COLUMN last_accessed_at INTEGER`);
    }

    // Migrate existing entity_note rows → pinned memories
    db.exec(`UPDATE memories SET pinned = 1 WHERE type = 'entity_note' AND pinned = 0`);

    // Create indexes
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_entity_id ON memories(entity_id) WHERE entity_id IS NOT NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_person_id ON memories(person_id) WHERE person_id IS NOT NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_pinned ON memories(pinned) WHERE pinned = 1`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope) WHERE scope IS NOT NULL`);

    const embedder = await createEmbeddingPipeline(hfCacheDir);
    return new MemoryStore(db, embedder);
  }

  async write(
    content: string,
    retrievalCues: string,
    tags: string[],
    opts?: { entityId?: string; personId?: string; pinned?: boolean; scope?: string },
  ): Promise<Memory> {
    const entityId = opts?.entityId;
    const personId = opts?.personId;
    const pinned = opts?.pinned ? 1 : 0;
    const scope = opts?.scope;
    console.log(`[Memory] Writing: "${content.slice(0, 80)}${content.length > 80 ? "..." : ""}" tags=[${tags.join(", ")}]${entityId ? ` entity=${entityId}` : ""}${personId ? ` person=${personId}` : ""}${pinned ? " pinned" : ""}${scope ? ` scope=${scope}` : ""}`);
    const now = Date.now();
    const embedding = await this.embedder.embed(retrievalCues);
    const embeddingBuf = Buffer.from(embedding.buffer);

    const result = this.db
      .prepare(
        `INSERT INTO memories (content, retrieval_cues, tags, type, entity_id, person_id, pinned, scope, embedding, created_at, updated_at) VALUES (?, ?, ?, 'memory', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(content, retrievalCues, JSON.stringify(tags), entityId ?? null, personId ?? null, pinned, scope ?? null, embeddingBuf, now, now);

    const id = Number(result.lastInsertRowid);
    console.log(`[Memory] Stored memory #${id}`);
    return this.getById(id)!;
  }

  async query(opts: {
    query?: string;
    tags?: string[];
    timeRange?: { start?: number; end?: number };
    limit?: number;
    scope?: string;
    entityId?: string;
    personId?: string;
  }): Promise<{ memories: ScoredMemory[]; meta: MemoryQueryMeta }> {
    console.log(`[Memory] Query: ${opts.query ? `"${opts.query}"` : "(no text)"} tags=${opts.tags?.join(",") || "any"} scope=${opts.scope ?? "global"} entity=${opts.entityId ?? "any"} person=${opts.personId ?? "any"} limit=${opts.limit ?? 20}`);
    const limit = opts.limit ?? 20;

    // Build SQL filter
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.tags && opts.tags.length > 0) {
      // Filter rows where tags JSON array contains any of the requested tags
      const tagConditions = opts.tags.map(() => `tags LIKE ?`);
      conditions.push(`(${tagConditions.join(" OR ")})`);
      for (const tag of opts.tags) {
        params.push(`%"${tag}"%`);
      }
    }

    if (opts.scope) {
      conditions.push(`(scope IS NULL OR scope = ?)`);
      params.push(opts.scope);
    }

    if (opts.entityId) {
      conditions.push(`entity_id = ?`);
      params.push(opts.entityId);
    }

    if (opts.personId) {
      conditions.push(`person_id = ?`);
      params.push(opts.personId);
    }

    if (opts.timeRange?.start) {
      conditions.push(`created_at >= ?`);
      params.push(opts.timeRange.start);
    }
    if (opts.timeRange?.end) {
      conditions.push(`created_at <= ?`);
      params.push(opts.timeRange.end);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM memories ${where} ORDER BY updated_at DESC`)
      .all(...params) as MemoryRow[];

    let ranked: { memory: Memory; similarity: number }[];

    if (opts.query) {
      const queryEmbedding = await this.embedder.embed(opts.query);
      ranked = rows
        .filter((r) => r.embedding !== null)
        .map((r) => {
          const emb = new Float32Array(
            (r.embedding as Buffer).buffer,
            (r.embedding as Buffer).byteOffset,
            EMBEDDING_DIM,
          );
          return {
            memory: this.rowToMemory(r),
            similarity: cosineSimilarity(queryEmbedding, emb),
          };
        })
        .sort((a, b) => b.similarity - a.similarity);

      // Also include rows without embeddings at the end
      const noEmbedding = rows
        .filter((r) => r.embedding === null)
        .map((r) => ({ memory: this.rowToMemory(r), similarity: 0 }));
      ranked = [...ranked, ...noEmbedding];
    } else {
      // No query — return by recency
      ranked = rows.map((r) => ({ memory: this.rowToMemory(r), similarity: 0 }));
    }

    const totalMatches = ranked.length;
    const limited = ranked.slice(0, limit);
    const memories: ScoredMemory[] = limited.map((r) => ({ ...r.memory, similarity: r.similarity }));

    // Track access counts for returned memories
    if (memories.length > 0) {
      const ids = memories.map((m) => m.id);
      const placeholders = ids.map(() => "?").join(",");
      this.db
        .prepare(`UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id IN (${placeholders})`)
        .run(Date.now(), ...ids);
    }

    // Compute meta
    const timestamps = memories.map((m) => m.createdAt);
    const ageRangeMs: [number, number] = timestamps.length > 0
      ? [Math.min(...timestamps), Math.max(...timestamps)]
      : [0, 0];

    const highSimilarityCluster = opts.query
      ? ranked.filter((r) => r.similarity > 0.9).length >= 3
      : false;

    console.log(`[Memory] Query returned ${memories.length}/${totalMatches} results${opts.query && ranked.length > 0 ? ` (top similarity: ${ranked[0]!.similarity.toFixed(3)})` : ""}`);

    return {
      memories,
      meta: { totalMatches, ageRangeMs, highSimilarityCluster },
    };
  }

  async rewrite(
    id: number,
    updates: { content?: string; retrievalCues?: string; tags?: string[]; scope?: string | null; pinned?: boolean },
  ): Promise<Memory | null> {
    console.log(`[Memory] Rewriting #${id}: ${Object.keys(updates).filter((k) => updates[k as keyof typeof updates] !== undefined).join(", ")}`);
    const existing = this.getById(id);
    if (!existing) {
      console.log(`[Memory] Rewrite failed: #${id} not found`);
      return null;
    }

    const now = Date.now();
    const newContent = updates.content ?? existing.content;
    const newCues = updates.retrievalCues ?? existing.retrievalCues;
    const newTags = updates.tags ?? existing.tags;
    const newScope = updates.scope !== undefined ? updates.scope : (existing.scope ?? null);
    const newPinned = updates.pinned !== undefined ? (updates.pinned ? 1 : 0) : (existing.pinned ? 1 : 0);

    let embeddingBuf: Buffer | undefined;
    if (updates.retrievalCues) {
      const embedding = await this.embedder.embed(newCues);
      embeddingBuf = Buffer.from(embedding.buffer);
    }

    if (embeddingBuf) {
      this.db
        .prepare(
          `UPDATE memories SET content = ?, retrieval_cues = ?, tags = ?, scope = ?, pinned = ?, embedding = ?, updated_at = ? WHERE id = ?`,
        )
        .run(newContent, newCues, JSON.stringify(newTags), newScope, newPinned, embeddingBuf, now, id);
    } else {
      this.db
        .prepare(
          `UPDATE memories SET content = ?, retrieval_cues = ?, tags = ?, scope = ?, pinned = ?, updated_at = ? WHERE id = ?`,
        )
        .run(newContent, newCues, JSON.stringify(newTags), newScope, newPinned, now, id);
    }

    return this.getById(id)!;
  }

  forget(id: number): boolean {
    const result = this.db
      .prepare(`DELETE FROM memories WHERE id = ?`)
      .run(id);
    console.log(`[Memory] Forget #${id}: ${result.changes > 0 ? "deleted" : "not found"}`);
    return result.changes > 0;
  }

  async reflect(): Promise<MemoryReflectStats> {
    console.log(`[Memory] Reflecting on memory store...`);
    const all = this.getAllRows();
    const now = Date.now();

    // Count by tag
    const countsByTag: Record<string, number> = {};
    for (const row of all) {
      const tags = JSON.parse(row.tags) as string[];
      for (const tag of tags) {
        countsByTag[tag] = (countsByTag[tag] ?? 0) + 1;
      }
    }

    // Age distribution buckets
    const buckets = [
      { label: "< 1 hour", maxAge: 60 * 60 * 1000 },
      { label: "1-24 hours", maxAge: 24 * 60 * 60 * 1000 },
      { label: "1-7 days", maxAge: 7 * 24 * 60 * 60 * 1000 },
      { label: "1-30 days", maxAge: 30 * 24 * 60 * 60 * 1000 },
      { label: "> 30 days", maxAge: Infinity },
    ];
    const ageDistribution = buckets.map((b) => ({ bucket: b.label, count: 0 }));
    for (const row of all) {
      const age = now - row.created_at;
      for (let i = 0; i < buckets.length; i++) {
        if (age < buckets[i]!.maxAge) {
          ageDistribution[i]!.count++;
          break;
        }
      }
    }

    // Similar clusters — pairwise comparison on a sample
    const withEmbeddings = all.filter((r) => r.embedding !== null);
    const sample = withEmbeddings.slice(0, 500); // 125k dot products, sub-second
    const clusters: { size: number; sample: string; ids: number[]; contents: string[] }[] = [];
    const visited = new Set<number>();

    for (let i = 0; i < sample.length; i++) {
      if (visited.has(i)) continue;
      const embA = new Float32Array(
        (sample[i]!.embedding as Buffer).buffer,
        (sample[i]!.embedding as Buffer).byteOffset,
        EMBEDDING_DIM,
      );
      const cluster = [i];

      for (let j = i + 1; j < sample.length; j++) {
        if (visited.has(j)) continue;
        const embB = new Float32Array(
          (sample[j]!.embedding as Buffer).buffer,
          (sample[j]!.embedding as Buffer).byteOffset,
          EMBEDDING_DIM,
        );
        if (cosineSimilarity(embA, embB) > 0.85) {
          cluster.push(j);
          visited.add(j);
        }
      }

      if (cluster.length >= 2) {
        visited.add(i);
        clusters.push({
          size: cluster.length,
          sample: sample[i]!.content.slice(0, 100),
          ids: cluster.map((idx) => sample[idx]!.id),
          contents: cluster.map((idx) => sample[idx]!.content.slice(0, 200)),
        });
      }
    }

    // Stale memories: unpinned, not updated in 30+ days, sorted by access count ascending
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const staleMemories = all
      .filter((r) => r.pinned === 0 && r.updated_at < thirtyDaysAgo)
      .sort((a, b) => a.access_count - b.access_count)
      .slice(0, 20)
      .map((r) => ({
        id: r.id,
        content: r.content.slice(0, 200),
        tags: JSON.parse(r.tags) as string[],
        daysSinceUpdate: Math.floor((now - r.updated_at) / (24 * 60 * 60 * 1000)),
        accessCount: r.access_count,
      }));

    // Never-accessed memories: access_count = 0, older than 7 days
    const sevenDaysAgoTs = now - 7 * 24 * 60 * 60 * 1000;
    const neverAccessed = all
      .filter((r) => r.access_count === 0 && r.created_at < sevenDaysAgoTs)
      .slice(0, 20)
      .map((r) => ({
        id: r.id,
        content: r.content.slice(0, 200),
        tags: JSON.parse(r.tags) as string[],
        daysSinceCreation: Math.floor((now - r.created_at) / (24 * 60 * 60 * 1000)),
      }));

    // Growth rate: memories created in last 7 days / 7
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const recentCount = all.filter((r) => r.created_at >= sevenDaysAgo).length;
    const recentGrowthRate = recentCount / 7;

    console.log(`[Memory] Reflect: ${all.length} memories, ${clusters.length} similar clusters, ${staleMemories.length} stale, ${neverAccessed.length} never-accessed, growth ${recentGrowthRate.toFixed(1)}/day`);

    return {
      totalCount: all.length,
      countsByTag,
      ageDistribution,
      similarClusters: clusters,
      staleMemories,
      neverAccessed,
      recentGrowthRate,
    };
  }

  async merge(opts: {
    targetId: number;
    sourceIds: number[];
    content: string;
    retrievalCues: string;
    tags: string[];
  }): Promise<{ memory: Memory; coverageWarnings: { sourceId: number; sourceContent: string; similarity: number }[] } | null> {
    console.log(`[Memory] Merging sources [${opts.sourceIds.join(", ")}] into target #${opts.targetId}`);

    const target = this.getById(opts.targetId);
    if (!target) {
      console.log(`[Memory] Merge failed: target #${opts.targetId} not found`);
      return null;
    }

    // Collect source embeddings before deleting
    const sourceData: { id: number; content: string; embedding: Float32Array | null }[] = [];
    for (const sourceId of opts.sourceIds) {
      const row = this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(sourceId) as MemoryRow | undefined;
      if (row) {
        const emb = row.embedding
          ? new Float32Array((row.embedding as Buffer).buffer, (row.embedding as Buffer).byteOffset, EMBEDDING_DIM)
          : null;
        sourceData.push({ id: row.id, content: row.content, embedding: emb });
      }
    }

    // Rewrite the target with merged content (triggers re-embedding)
    const merged = await this.rewrite(opts.targetId, {
      content: opts.content,
      retrievalCues: opts.retrievalCues,
      tags: opts.tags,
    });
    if (!merged) return null;

    // Get the new embedding for coverage validation
    const targetRow = this.db.prepare(`SELECT embedding FROM memories WHERE id = ?`).get(opts.targetId) as { embedding: Buffer | null } | undefined;
    const newEmbedding = targetRow?.embedding
      ? new Float32Array((targetRow.embedding as Buffer).buffer, (targetRow.embedding as Buffer).byteOffset, EMBEDDING_DIM)
      : null;

    // Check coverage of each source against the new embedding
    const coverageWarnings: { sourceId: number; sourceContent: string; similarity: number }[] = [];
    if (newEmbedding) {
      for (const source of sourceData) {
        if (source.embedding) {
          const sim = cosineSimilarity(newEmbedding, source.embedding);
          if (sim < 0.7) {
            coverageWarnings.push({
              sourceId: source.id,
              sourceContent: source.content.slice(0, 200),
              similarity: Math.round(sim * 100) / 100,
            });
          }
        }
      }
    }

    // Delete all source memories
    for (const sourceId of opts.sourceIds) {
      this.forget(sourceId);
    }

    console.log(`[Memory] Merged ${sourceData.length} sources into #${opts.targetId}${coverageWarnings.length > 0 ? ` (${coverageWarnings.length} coverage warnings)` : ""}`);
    return { memory: merged, coverageWarnings };
  }

  getAll(): Memory[] {
    const rows = this.db
      .prepare(`SELECT * FROM memories ORDER BY updated_at DESC`)
      .all() as MemoryRow[];
    return rows.map((r) => this.rowToMemory(r));
  }

  getById(id: number): Memory | null {
    const row = this.db
      .prepare(`SELECT * FROM memories WHERE id = ?`)
      .get(id) as MemoryRow | undefined;
    return row ? this.rowToMemory(row) : null;
  }

  /** Get all pinned memories, optionally filtered by entity or person. */
  getPinnedMemories(opts?: { entityId?: string; personId?: string }): Memory[] {
    if (opts?.entityId) {
      const rows = this.db
        .prepare(`SELECT * FROM memories WHERE pinned = 1 AND entity_id = ?`)
        .all(opts.entityId) as MemoryRow[];
      return rows.map((r) => this.rowToMemory(r));
    }
    if (opts?.personId) {
      const rows = this.db
        .prepare(`SELECT * FROM memories WHERE pinned = 1 AND person_id = ?`)
        .all(opts.personId) as MemoryRow[];
      return rows.map((r) => this.rowToMemory(r));
    }
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE pinned = 1`)
      .all() as MemoryRow[];
    return rows.map((r) => this.rowToMemory(r));
  }

  /** Get all pinned memories grouped by entity_id. */
  getPinnedByEntity(): Map<string, Memory[]> {
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE pinned = 1 AND entity_id IS NOT NULL`)
      .all() as MemoryRow[];
    const map = new Map<string, Memory[]>();
    for (const row of rows) {
      if (row.entity_id) {
        const list = map.get(row.entity_id) ?? [];
        list.push(this.rowToMemory(row));
        map.set(row.entity_id, list);
      }
    }
    return map;
  }

  /** Get all pinned memories grouped by person_id. */
  getPinnedByPerson(): Map<string, Memory[]> {
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE pinned = 1 AND person_id IS NOT NULL`)
      .all() as MemoryRow[];
    const map = new Map<string, Memory[]>();
    for (const row of rows) {
      if (row.person_id) {
        const list = map.get(row.person_id) ?? [];
        list.push(this.rowToMemory(row));
        map.set(row.person_id, list);
      }
    }
    return map;
  }

  getCount(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM memories`).get() as { cnt: number };
    return row.cnt;
  }

  close(): void {
    this.db.close();
  }

  private getAllRows(): MemoryRow[] {
    return this.db
      .prepare(`SELECT * FROM memories ORDER BY updated_at DESC`)
      .all() as MemoryRow[];
  }

  private rowToMemory(row: MemoryRow): Memory {
    return {
      id: row.id,
      content: row.content,
      retrievalCues: row.retrieval_cues,
      tags: JSON.parse(row.tags),
      entityId: row.entity_id ?? undefined,
      personId: row.person_id ?? undefined,
      pinned: row.pinned === 1,
      scope: row.scope ?? undefined,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
