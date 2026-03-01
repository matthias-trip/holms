import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

const REF_PREFIX = "$secret:";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretStore {
  private key: Buffer;
  private db: Database.Database;

  constructor(db: Database.Database, keyPath: string) {
    this.db = db;
    this.key = SecretStore.loadOrCreateKey(keyPath);

    db.exec(`
      CREATE TABLE IF NOT EXISTS secrets (
        id TEXT PRIMARY KEY,
        encrypted BLOB NOT NULL,
        iv BLOB NOT NULL,
        tag BLOB NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
  }

  /** Encrypt plaintext and store it. Returns an opaque reference. */
  store(plaintext: string): string {
    const id = REF_PREFIX + crypto.randomBytes(8).toString("hex");
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    this.db
      .prepare(
        "INSERT INTO secrets (id, encrypted, iv, tag, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, encrypted, iv, tag, Date.now());

    return id;
  }

  /** Resolve an opaque reference to its plaintext. Throws if unknown. */
  resolve(ref: string): string {
    const row = this.db
      .prepare("SELECT encrypted, iv, tag FROM secrets WHERE id = ?")
      .get(ref) as { encrypted: Buffer; iv: Buffer; tag: Buffer } | undefined;

    if (!row) throw new Error(`Unknown secret ref: ${ref}`);

    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, row.iv);
    decipher.setAuthTag(row.tag);
    return decipher.update(row.encrypted) + decipher.final("utf8");
  }

  /** Shallow-walk a config object, resolving all $secret: refs to plaintext. */
  resolveAll(config: Record<string, unknown>): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      resolved[key] = SecretStore.isRef(value) ? this.resolve(value) : value;
    }
    return resolved;
  }

  /** Delete a single secret by reference. */
  delete(ref: string): void {
    this.db.prepare("DELETE FROM secrets WHERE id = ?").run(ref);
  }

  /** Delete all secrets referenced in a config object. */
  deleteForConfig(config: Record<string, unknown>): void {
    for (const value of Object.values(config)) {
      if (SecretStore.isRef(value)) {
        this.delete(value);
      }
    }
  }

  /** Check if a value is a secret reference. */
  static isRef(value: unknown): value is string {
    return typeof value === "string" && value.startsWith(REF_PREFIX);
  }

  /** Load key from file or generate a new one (mode 0o600). */
  private static loadOrCreateKey(keyPath: string): Buffer {
    try {
      return fs.readFileSync(keyPath);
    } catch {
      const dir = path.dirname(keyPath);
      fs.mkdirSync(dir, { recursive: true });
      const key = crypto.randomBytes(32);
      fs.writeFileSync(keyPath, key, { mode: 0o600 });
      console.log(`[SecretStore] Generated encryption key at ${keyPath}`);
      return key;
    }
  }
}
