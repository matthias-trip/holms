import crypto from "node:crypto";
import type Database from "better-sqlite3";
import * as jose from "jose";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";

const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PAIRING_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const BCRYPT_ROUNDS = 12;

export interface DeviceTokenInfo {
  id: string;
  name: string;
  tokenPrefix: string;
  personId: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  userAgent: string | null;
}

export interface AuthIdentity {
  type: "session" | "device";
  deviceId?: string;
  personId?: string;
}

export class AuthStore {
  private db: Database.Database;
  private signingKey: Uint8Array | null = null;

  constructor(db: Database.Database) {
    this.db = db;

    // Ensure settings table exists (may already exist from old TokenStore)
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS credentials (
        id TEXT PRIMARY KEY DEFAULT 'admin',
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        token TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        user_agent TEXT
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS device_tokens (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        token_prefix TEXT NOT NULL,
        person_id TEXT,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        user_agent TEXT
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS pairing_codes (
        code TEXT PRIMARY KEY,
        person_id TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        claimed INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Clean up legacy api_token if it exists (migration)
    const legacyToken = db
      .prepare("SELECT value FROM settings WHERE key = 'api_token'")
      .get() as { value: string } | undefined;
    if (legacyToken) {
      console.log("[Auth] Found legacy api_token — will be removed once password is set");
    }
  }

  // --- JWT Signing Key ---

  private async getSigningKey(): Promise<Uint8Array> {
    if (this.signingKey) return this.signingKey;

    const row = this.db
      .prepare("SELECT value FROM settings WHERE key = 'jwt_signing_key'")
      .get() as { value: string } | undefined;

    if (row) {
      this.signingKey = Buffer.from(row.value, "hex");
      return this.signingKey;
    }

    // Generate new 256-bit key
    const key = crypto.randomBytes(32);
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES ('jwt_signing_key', ?)")
      .run(key.toString("hex"));
    this.signingKey = key;
    console.log("[Auth] Generated JWT signing key");
    return this.signingKey;
  }

  // --- Password Management ---

  hasPassword(): boolean {
    const row = this.db
      .prepare("SELECT id FROM credentials WHERE id = 'admin'")
      .get();
    return !!row;
  }

  async setPassword(password: string): Promise<void> {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO credentials (id, password_hash, created_at, updated_at)
         VALUES ('admin', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET password_hash = ?, updated_at = ?`
      )
      .run(hash, now, now, hash, now);

    // Remove legacy api_token on first password set
    this.db.prepare("DELETE FROM settings WHERE key = 'api_token'").run();
    console.log("[Auth] Password set");
  }

  async verifyPassword(password: string): Promise<boolean> {
    const row = this.db
      .prepare("SELECT password_hash FROM credentials WHERE id = 'admin'")
      .get() as { password_hash: string } | undefined;
    if (!row) return false;
    return bcrypt.compare(password, row.password_hash);
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<boolean> {
    const valid = await this.verifyPassword(currentPassword);
    if (!valid) return false;
    await this.setPassword(newPassword);
    return true;
  }

  // --- Session (JWT) Management ---

  async createSession(userAgent?: string): Promise<{ accessToken: string; refreshToken: string }> {
    const key = await this.getSigningKey();
    const secret = new Uint8Array(key);

    const accessToken = await new jose.SignJWT({ type: "session" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(ACCESS_TOKEN_EXPIRY)
      .sign(secret);

    const refreshToken = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    const expiresAt = now + REFRESH_TOKEN_EXPIRY_MS;

    this.db
      .prepare("INSERT INTO refresh_tokens (token, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?)")
      .run(refreshToken, now, expiresAt, userAgent ?? null);

    return { accessToken, refreshToken };
  }

  async refreshSession(oldRefreshToken: string, userAgent?: string): Promise<{ accessToken: string; refreshToken: string } | null> {
    const now = Date.now();
    const row = this.db
      .prepare("SELECT token, expires_at FROM refresh_tokens WHERE token = ?")
      .get(oldRefreshToken) as { token: string; expires_at: number } | undefined;

    if (!row || row.expires_at < now) {
      // Expired or not found — clean up
      if (row) this.db.prepare("DELETE FROM refresh_tokens WHERE token = ?").run(oldRefreshToken);
      return null;
    }

    // Rotate: delete old, create new
    this.db.prepare("DELETE FROM refresh_tokens WHERE token = ?").run(oldRefreshToken);
    return this.createSession(userAgent);
  }

  async verifyAccessToken(token: string): Promise<AuthIdentity | null> {
    try {
      const key = await this.getSigningKey();
      const secret = new Uint8Array(key);
      await jose.jwtVerify(token, secret);
      return { type: "session" };
    } catch {
      return null;
    }
  }

  revokeRefreshToken(token: string): void {
    this.db.prepare("DELETE FROM refresh_tokens WHERE token = ?").run(token);
  }

  revokeAllSessions(): void {
    this.db.prepare("DELETE FROM refresh_tokens").run();
    // Regenerate signing key to invalidate all JWTs
    const key = crypto.randomBytes(32);
    this.db
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('jwt_signing_key', ?)")
      .run(key.toString("hex"));
    this.signingKey = key;
    console.log("[Auth] All sessions revoked (signing key regenerated)");
  }

  // --- Device Token Management ---

  async verifyDeviceToken(token: string): Promise<AuthIdentity | null> {
    const row = this.db
      .prepare("SELECT id, person_id FROM device_tokens WHERE token = ?")
      .get(token) as { id: string; person_id: string | null } | undefined;

    if (!row) return null;

    // Update last_used_at
    this.db.prepare("UPDATE device_tokens SET last_used_at = ? WHERE id = ?").run(Date.now(), row.id);

    return {
      type: "device",
      deviceId: row.id,
      personId: row.person_id ?? undefined,
    };
  }

  listDeviceTokens(): DeviceTokenInfo[] {
    const rows = this.db
      .prepare(
        "SELECT id, name, token_prefix, person_id, created_at, last_used_at, user_agent FROM device_tokens ORDER BY created_at DESC"
      )
      .all() as Array<{
        id: string;
        name: string;
        token_prefix: string;
        person_id: string | null;
        created_at: number;
        last_used_at: number | null;
        user_agent: string | null;
      }>;

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      tokenPrefix: r.token_prefix,
      personId: r.person_id,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      userAgent: r.user_agent,
    }));
  }

  revokeDeviceToken(id: string): boolean {
    const result = this.db.prepare("DELETE FROM device_tokens WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // --- Pairing Codes ---

  async createPairingCode(
    personId?: string,
    serverUrl?: string
  ): Promise<{ code: string; expiresAt: number; qrSvg: string }> {
    // Generate 6-digit code
    const code = String(crypto.randomInt(100000, 999999));
    const now = Date.now();
    const expiresAt = now + PAIRING_CODE_TTL_MS;

    this.db
      .prepare("INSERT INTO pairing_codes (code, person_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(code, personId ?? null, now, expiresAt);

    // Generate QR code SVG
    const qrData = JSON.stringify({
      url: serverUrl ?? "",
      code,
    });
    const qrSvg = await QRCode.toString(qrData, { type: "svg", margin: 1 });

    return { code, expiresAt, qrSvg };
  }

  async claimPairingCode(
    code: string,
    deviceName: string,
    userAgent?: string
  ): Promise<{ token: string; deviceId: string } | null> {
    const now = Date.now();
    const row = this.db
      .prepare("SELECT code, person_id, expires_at, claimed FROM pairing_codes WHERE code = ?")
      .get(code) as { code: string; person_id: string | null; expires_at: number; claimed: number } | undefined;

    if (!row || row.claimed || row.expires_at < now) {
      return null;
    }

    // Mark as claimed
    this.db.prepare("UPDATE pairing_codes SET claimed = 1 WHERE code = ?").run(code);

    // Create device token
    const deviceId = crypto.randomUUID();
    const token = crypto.randomBytes(48).toString("hex");
    const tokenPrefix = token.slice(0, 8);

    this.db
      .prepare(
        "INSERT INTO device_tokens (id, token, name, token_prefix, person_id, created_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(deviceId, token, deviceName, tokenPrefix, row.person_id, now, userAgent ?? null);

    console.log(`[Auth] Device paired: ${deviceName} (${tokenPrefix}...)`);
    return { token, deviceId };
  }

  // --- Cleanup ---

  /** Remove expired refresh tokens and pairing codes. Called periodically. */
  cleanup(): void {
    const now = Date.now();
    this.db.prepare("DELETE FROM refresh_tokens WHERE expires_at < ?").run(now);
    this.db.prepare("DELETE FROM pairing_codes WHERE expires_at < ?").run(now);
  }
}
