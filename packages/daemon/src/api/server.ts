import http from "http";
import fs from "fs";
import path from "path";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { WebSocketServer } from "ws";
import { appRouter } from "./router.js";
import type { TRPCContext } from "./context.js";
import { initEventPersistence } from "./routers/events.js";
import { authenticateHttp, authenticateWs, extractRefreshCookie, sendUnauthorized } from "../auth/middleware.js";
import type { AuthStore } from "../auth/auth-store.js";
import { NativeGateway } from "./native/gateway.js";
import { generateMapKitToken } from "./mapkit-token.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

function tryServeStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  distDir: string
): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");
  let filePath = path.join(distDir, url.pathname);

  // If path is a directory, try index.html
  if (filePath.endsWith("/")) filePath += "index.html";

  try {
    const stat = fs.statSync(filePath);
    if (stat.isFile()) {
      const ext = path.extname(filePath);
      const mime = MIME_TYPES[ext] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime });
      fs.createReadStream(filePath).pipe(res);
      return true;
    }
  } catch {
    // File not found — fall through
  }
  return false;
}

function serveSpaFallback(res: http.ServerResponse, distDir: string): void {
  const indexPath = path.join(distDir, "index.html");
  try {
    const html = fs.readFileSync(indexPath);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

// --- Rate limiting for pairing endpoint ---

const pairAttempts = new Map<string, { count: number; resetAt: number }>();
const PAIR_RATE_LIMIT = 5;
const PAIR_RATE_WINDOW_MS = 60_000;

function checkPairRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = pairAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    pairAttempts.set(ip, { count: 1, resetAt: now + PAIR_RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= PAIR_RATE_LIMIT;
}

// --- JSON body parser ---

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf-8");
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: unknown, headers?: Record<string, string>): void {
  const allHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };
  res.writeHead(status, allHeaders);
  res.end(JSON.stringify(data));
}

function setRefreshCookie(res: http.ServerResponse, token: string): void {
  const maxAge = 30 * 24 * 60 * 60; // 30 days in seconds
  res.setHeader(
    "Set-Cookie",
    `holms_refresh=${token}; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=${maxAge}`
  );
}

function clearRefreshCookie(res: http.ServerResponse): void {
  res.setHeader(
    "Set-Cookie",
    "holms_refresh=; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=0"
  );
}

// --- Auth route handler ---

async function handleAuthRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  authStore: AuthStore,
): Promise<boolean> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return true;
  }

  try {
    if (pathname === "/api/auth/status") {
      const isSetup = authStore.hasPassword();
      // Check if caller is authenticated
      const identity = await authenticateHttp(req, authStore);
      sendJson(res, 200, { isSetup, isAuthenticated: !!identity });
      return true;
    }

    if (pathname === "/api/auth/setup") {
      if (authStore.hasPassword()) {
        sendJson(res, 400, { error: "Password already set" });
        return true;
      }
      const body = await readJsonBody(req);
      const password = body.password;
      if (typeof password !== "string" || password.length < 4) {
        sendJson(res, 400, { error: "Password must be at least 4 characters" });
        return true;
      }
      await authStore.setPassword(password);
      // Auto-login after setup
      const session = await authStore.createSession(req.headers["user-agent"]);
      setRefreshCookie(res, session.refreshToken);
      sendJson(res, 200, { accessToken: session.accessToken });
      return true;
    }

    if (pathname === "/api/auth/login") {
      const body = await readJsonBody(req);
      const password = body.password;
      if (typeof password !== "string") {
        sendJson(res, 400, { error: "Password required" });
        return true;
      }
      const valid = await authStore.verifyPassword(password);
      if (!valid) {
        sendJson(res, 401, { error: "Invalid password" });
        return true;
      }
      const session = await authStore.createSession(req.headers["user-agent"]);
      setRefreshCookie(res, session.refreshToken);
      sendJson(res, 200, { accessToken: session.accessToken });
      return true;
    }

    if (pathname === "/api/auth/refresh") {
      const refreshToken = extractRefreshCookie(req);
      if (!refreshToken) {
        sendJson(res, 401, { error: "No refresh token" });
        return true;
      }
      const session = await authStore.refreshSession(refreshToken, req.headers["user-agent"]);
      if (!session) {
        clearRefreshCookie(res);
        sendJson(res, 401, { error: "Invalid or expired refresh token" });
        return true;
      }
      setRefreshCookie(res, session.refreshToken);
      sendJson(res, 200, { accessToken: session.accessToken });
      return true;
    }

    if (pathname === "/api/auth/logout") {
      const identity = await authenticateHttp(req, authStore);
      if (!identity) {
        sendUnauthorized(res);
        return true;
      }
      const refreshToken = extractRefreshCookie(req);
      if (refreshToken) {
        authStore.revokeRefreshToken(refreshToken);
      }
      clearRefreshCookie(res);
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (pathname === "/api/auth/pair") {
      const ip = req.socket.remoteAddress ?? "unknown";
      if (!checkPairRateLimit(ip)) {
        sendJson(res, 429, { error: "Too many pairing attempts. Try again later." });
        return true;
      }
      const body = await readJsonBody(req);
      const code = body.code;
      const deviceName = body.deviceName;
      if (typeof code !== "string" || typeof deviceName !== "string") {
        sendJson(res, 400, { error: "code and deviceName required" });
        return true;
      }
      const result = await authStore.claimPairingCode(code, deviceName, req.headers["user-agent"]);
      if (!result) {
        sendJson(res, 401, { error: "Invalid or expired pairing code" });
        return true;
      }
      sendJson(res, 200, { token: result.token, deviceId: result.deviceId });
      return true;
    }
  } catch (err) {
    console.error("[Auth] Route error:", err);
    sendJson(res, 500, { error: "Internal server error" });
    return true;
  }

  return false; // Not an auth route
}

// --- Main server ---

export function startApiServer(
  ctx: TRPCContext,
  port: number,
  frontendDistDir?: string
) {
  const authStore = ctx.authStore;

  // Register event persistence listeners
  initEventPersistence(ctx.eventBus, ctx.activityStore);
  const handler = createHTTPHandler({
    router: appRouter,
    createContext: () => ctx,
  });

  const hasFrontend =
    frontendDistDir && fs.existsSync(path.join(frontendDistDir, "index.html"));

  if (hasFrontend) {
    console.log(`[API] Serving frontend from ${frontendDistDir}`);
  }

  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

    // Auth routes — handle before auth middleware (they manage their own auth)
    if (pathname.startsWith("/api/auth/")) {
      const handled = await handleAuthRoute(req, res, pathname, authStore);
      if (handled) return;
    }

    // Static frontend files — bypass auth (SPA handles its own auth state)
    if (hasFrontend && !pathname.startsWith("/trpc")) {
      if (tryServeStatic(req, res, frontendDistDir!)) return;
      // For non-file paths, serve SPA fallback (the app will handle auth redirect)
      if (!pathname.startsWith("/api")) {
        serveSpaFallback(res, frontendDistDir!);
        return;
      }
    }

    // MapKit token endpoint — no auth required (frontend fetches before full init)
    // but sits behind the SPA check so only API-aware callers hit it
    if (pathname === "/api/mapkit-token") {
      try {
        const token = await generateMapKitToken();
        if (!token) {
          sendJson(res, 404, { error: "MapKit not configured" });
        } else {
          sendJson(res, 200, { token });
        }
      } catch (err) {
        console.error("[MapKit] Token generation error:", err);
        sendJson(res, 500, { error: "Token generation failed" });
      }
      return;
    }

    // Auth check for tRPC and API requests
    const identity = await authenticateHttp(req, authStore);
    if (!identity) {
      sendUnauthorized(res);
      return;
    }

    // tRPC routes — strip /trpc prefix so procedure names resolve correctly
    if (pathname.startsWith("/trpc")) {
      req.url = req.url!.replace(/^\/trpc/, "") || "/";
      handler(req, res);
      return;
    }

    // No frontend — pass everything to tRPC
    handler(req, res);
  });

  // --- WebSocket setup with noServer routing ---
  const trpcWss = new WebSocketServer({ noServer: true });
  applyWSSHandler({
    wss: trpcWss,
    router: appRouter,
    createContext: () => ctx,
  });

  const nativeGateway = new NativeGateway(ctx);
  const nativeWss = nativeGateway.wss;

  server.on("upgrade", async (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

    if (pathname === "/ws/native") {
      const identity = await authenticateWs(req, authStore);
      if (!identity) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      nativeWss.handleUpgrade(req, socket, head, (ws) => {
        // Attach identity info for native gateway to use
        (req as any).__authIdentity = identity;
        nativeWss.emit("connection", ws, req);
      });
      return;
    }

    // Everything else → tRPC WebSocket (with auth)
    const identity = await authenticateWs(req, authStore);
    if (!identity) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    trpcWss.handleUpgrade(req, socket, head, (ws) => {
      trpcWss.emit("connection", ws, req);
    });
  });

  server.listen(port, "0.0.0.0");
  console.log(`[API] HTTP + WebSocket server listening on 0.0.0.0:${port}`);

  // Periodic cleanup of expired tokens/codes
  const cleanupInterval = setInterval(() => authStore.cleanup(), 60_000);

  return {
    nativeGateway,
    close: () => {
      clearInterval(cleanupInterval);
      nativeGateway.close();
      trpcWss.close();
      server.close();
    },
  };
}
