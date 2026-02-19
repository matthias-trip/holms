import Database from "better-sqlite3";
import type { Memory, MemoryQueryMeta, MemoryReflectStats } from "@holms/shared";
import { createEmbeddingPipeline, cosineSimilarity, EMBEDDING_DIM, type EmbeddingPipeline } from "./embeddings.js";

interface MemoryRow {
  id: number;
  content: string;
  retrieval_cues: string;
  tags: string;
  embedding: Buffer | null;
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

    // Drop old table if it exists
    db.exec(`DROP TABLE IF EXISTS memories`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS memories_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        retrieval_cues TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        embedding BLOB,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    const embedder = await createEmbeddingPipeline(hfCacheDir);
    return new MemoryStore(db, embedder);
  }

  async write(content: string, retrievalCues: string, tags: string[]): Promise<Memory> {
    console.log(`[Memory] Writing: "${content.slice(0, 80)}${content.length > 80 ? "…" : ""}" tags=[${tags.join(", ")}]`);
    const now = Date.now();
    const embedding = await this.embedder.embed(retrievalCues);
    const embeddingBuf = Buffer.from(embedding.buffer);

    const result = this.db
      .prepare(
        `INSERT INTO memories_v2 (content, retrieval_cues, tags, embedding, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(content, retrievalCues, JSON.stringify(tags), embeddingBuf, now, now);

    const id = Number(result.lastInsertRowid);
    console.log(`[Memory] Stored memory #${id}`);
    return this.getById(id)!;
  }

  async query(opts: {
    query?: string;
    tags?: string[];
    timeRange?: { start?: number; end?: number };
    limit?: number;
  }): Promise<{ memories: Memory[]; meta: MemoryQueryMeta }> {
    console.log(`[Memory] Query: ${opts.query ? `"${opts.query}"` : "(no text)"} tags=${opts.tags?.join(",") || "any"} limit=${opts.limit ?? 20}`);
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
      .prepare(`SELECT * FROM memories_v2 ${where} ORDER BY updated_at DESC`)
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
    const memories = limited.map((r) => r.memory);

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
    updates: { content?: string; retrievalCues?: string; tags?: string[] },
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

    let embeddingBuf: Buffer | undefined;
    if (updates.retrievalCues) {
      const embedding = await this.embedder.embed(newCues);
      embeddingBuf = Buffer.from(embedding.buffer);
    }

    if (embeddingBuf) {
      this.db
        .prepare(
          `UPDATE memories_v2 SET content = ?, retrieval_cues = ?, tags = ?, embedding = ?, updated_at = ? WHERE id = ?`,
        )
        .run(newContent, newCues, JSON.stringify(newTags), embeddingBuf, now, id);
    } else {
      this.db
        .prepare(
          `UPDATE memories_v2 SET content = ?, retrieval_cues = ?, tags = ?, updated_at = ? WHERE id = ?`,
        )
        .run(newContent, newCues, JSON.stringify(newTags), now, id);
    }

    return this.getById(id)!;
  }

  forget(id: number): boolean {
    const result = this.db
      .prepare(`DELETE FROM memories_v2 WHERE id = ?`)
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
    const sample = withEmbeddings.slice(0, 100); // limit pairwise cost
    const clusters: { size: number; sample: string }[] = [];
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
        });
      }
    }

    // Growth rate: memories created in last 7 days / 7
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const recentCount = all.filter((r) => r.created_at >= sevenDaysAgo).length;
    const recentGrowthRate = recentCount / 7;

    console.log(`[Memory] Reflect: ${all.length} memories, ${clusters.length} similar clusters, growth ${recentGrowthRate.toFixed(1)}/day`);

    return {
      totalCount: all.length,
      countsByTag,
      ageDistribution,
      similarClusters: clusters,
      recentGrowthRate,
    };
  }

  getAll(): Memory[] {
    const rows = this.db
      .prepare(`SELECT * FROM memories_v2 ORDER BY updated_at DESC`)
      .all() as MemoryRow[];
    return rows.map((r) => this.rowToMemory(r));
  }

  getById(id: number): Memory | null {
    const row = this.db
      .prepare(`SELECT * FROM memories_v2 WHERE id = ?`)
      .get(id) as MemoryRow | undefined;
    return row ? this.rowToMemory(row) : null;
  }

  close(): void {
    this.db.close();
  }

  private getAllRows(): MemoryRow[] {
    return this.db
      .prepare(`SELECT * FROM memories_v2 ORDER BY updated_at DESC`)
      .all() as MemoryRow[];
  }

  private rowToMemory(row: MemoryRow): Memory {
    return {
      id: row.id,
      content: row.content,
      retrievalCues: row.retrieval_cues,
      tags: JSON.parse(row.tags),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
