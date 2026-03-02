import * as jose from "jose";
import fs from "fs";

/**
 * Generates short-lived MapKit JS JWT tokens.
 * Requires:
 *   HOLMS_MAPKIT_KEY_PATH — path to the .p8 private key file
 *   HOLMS_MAPKIT_KEY_ID   — the Key ID (from Apple Developer portal)
 *   HOLMS_MAPKIT_TEAM_ID  — your Apple Developer Team ID
 */

const TOKEN_TTL = 30 * 60; // 30 minutes

let cachedKey: CryptoKey | null = null;
let cachedToken: { jwt: string; expiresAt: number } | null = null;

function getConfig() {
  const keyPath = process.env.HOLMS_MAPKIT_KEY_PATH;
  const keyId = process.env.HOLMS_MAPKIT_KEY_ID;
  const teamId = process.env.HOLMS_MAPKIT_TEAM_ID;

  if (!keyPath || !keyId || !teamId) return null;
  return { keyPath, keyId, teamId };
}

async function loadPrivateKey(keyPath: string): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const pem = fs.readFileSync(keyPath, "utf-8");
  cachedKey = (await jose.importPKCS8(pem, "ES256")) as CryptoKey;
  return cachedKey;
}

export function isMapKitConfigured(): boolean {
  return getConfig() !== null;
}

export async function generateMapKitToken(): Promise<string | null> {
  const config = getConfig();
  if (!config) return null;

  const now = Math.floor(Date.now() / 1000);

  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return cachedToken.jwt;
  }

  const key = await loadPrivateKey(config.keyPath);
  const exp = now + TOKEN_TTL;

  const jwt = await new jose.SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: config.keyId, typ: "JWT" })
    .setIssuer(config.teamId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key);

  cachedToken = { jwt, expiresAt: exp };
  return jwt;
}
