import http from "http";
import fs from "fs";
import path from "path";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { WebSocketServer } from "ws";
import { appRouter } from "./router.js";
import type { TRPCContext } from "./context.js";
import { initEventPersistence } from "./routers/events.js";

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

export function startApiServer(
  ctx: TRPCContext,
  port: number,
  frontendDistDir?: string
) {
  // Register event persistence listeners (activity persistence is initialized in index.ts)
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

  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

    // tRPC routes take priority — strip /trpc prefix so procedure names resolve correctly
    if (pathname.startsWith("/trpc")) {
      req.url = req.url!.replace(/^\/trpc/, "") || "/";
      handler(req, res);
      return;
    }

    // Serve frontend static files if available
    if (hasFrontend) {
      if (!tryServeStatic(req, res, frontendDistDir!)) {
        serveSpaFallback(res, frontendDistDir!);
      }
      return;
    }

    // No frontend — pass everything to tRPC
    handler(req, res);
  });

  const wss = new WebSocketServer({ server });

  applyWSSHandler({
    wss,
    router: appRouter,
    createContext: () => ctx,
  });

  server.listen(port, "0.0.0.0");
  console.log(`[API] HTTP + WebSocket server listening on 0.0.0.0:${port}`);

  return {
    close: () => {
      wss.close();
      server.close();
    },
  };
}
