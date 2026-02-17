import http from "http";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { WebSocketServer } from "ws";
import { appRouter } from "./router.js";
import type { TRPCContext } from "./context.js";

export function startApiServer(ctx: TRPCContext, port: number) {
  const handler = createHTTPHandler({
    router: appRouter,
    createContext: () => ctx,
  });

  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }
    handler(req, res);
  });

  const wss = new WebSocketServer({ server });

  applyWSSHandler({
    wss,
    router: appRouter,
    createContext: () => ctx,
  });

  server.listen(port);
  console.log(`[API] HTTP + WebSocket server listening on port ${port}`);

  return {
    close: () => {
      wss.close();
      server.close();
    },
  };
}
