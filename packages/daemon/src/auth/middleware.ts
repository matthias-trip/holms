import type http from "node:http";
import type { AuthStore, AuthIdentity } from "./auth-store.js";

/**
 * Extract bearer token from Authorization header.
 */
function extractBearerToken(req: http.IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const parts = auth.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  return parts[1];
}

/**
 * Extract token from query string (?token=...) for WebSocket upgrades.
 */
function extractQueryToken(req: http.IncomingMessage): string | null {
  const url = new URL(req.url ?? "/", "http://localhost");
  return url.searchParams.get("token");
}

/**
 * Extract refresh token from cookie.
 */
export function extractRefreshCookie(req: http.IncomingMessage): string | null {
  const cookies = req.headers.cookie;
  if (!cookies) return null;
  const match = cookies.match(/(?:^|;\s*)holms_refresh=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Authenticate an HTTP request. Returns an AuthIdentity if authorized, null otherwise.
 * Tries JWT first, then device token.
 */
export async function authenticateHttp(
  req: http.IncomingMessage,
  authStore: AuthStore,
): Promise<AuthIdentity | null> {
  const token = extractBearerToken(req);
  if (!token) return null;
  return resolveToken(token, authStore);
}

/**
 * Authenticate a WebSocket upgrade request. Returns an AuthIdentity if authorized.
 * Checks both Authorization header and ?token= query parameter.
 */
export async function authenticateWs(
  req: http.IncomingMessage,
  authStore: AuthStore,
): Promise<AuthIdentity | null> {
  const token = extractBearerToken(req) ?? extractQueryToken(req);
  if (!token) return null;
  return resolveToken(token, authStore);
}

/**
 * Try JWT verification first, then device token lookup.
 */
async function resolveToken(token: string, authStore: AuthStore): Promise<AuthIdentity | null> {
  // Try JWT first (access tokens are JWTs — they contain dots)
  if (token.includes(".")) {
    const identity = await authStore.verifyAccessToken(token);
    if (identity) return identity;
  }

  // Try device token (hex strings, no dots)
  return authStore.verifyDeviceToken(token);
}

/**
 * Send a 401 Unauthorized response.
 */
export function sendUnauthorized(res: http.ServerResponse): void {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Unauthorized" }));
}
