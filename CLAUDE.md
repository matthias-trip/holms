# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (both daemon + frontend concurrently)
npm run dev

# Individual packages
npm run dev:daemon          # tsx watch on port 3100
npm run dev:frontend        # vite on port 5173

# Build (must be in order: shared → daemon → frontend)
npm run build

# Type checking
npm run typecheck -w @holms/daemon
npm run typecheck -w @holms/frontend
npm run typecheck -w @holms/shared
```

No test framework is configured yet.

## Architecture

npm workspaces monorepo: `packages/shared`, `packages/daemon`, `packages/frontend`.

**Shared** (`@holms/shared`) — TypeScript types only, no runtime code. Defines device types, memory types, reflex triggers/actions, approval workflow types, chat messages, and agent activity types.

**Daemon** (`@holms/daemon`) — Node.js server on port 3100. Two main responsibilities:

1. **tRPC API** — HTTP + WebSocket server (manual `http.createServer` for CORS + `applyWSSHandler`). Routers: `devices`, `chat`, `memory`, `reflex`, `approval`, `events`. WebSocket subscriptions push real-time updates.

2. **Coordinator** — Wraps Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`). The agent receives batched device events, user messages, proactive wakeups, and outcome feedback. It interacts with 5 MCP tool servers (device-query, device-command, memory, reflex, approval) running in-process via `createSdkMcpServer`. Session continuity via stored `sessionId` + SDK `resume` option.

Supporting subsystems wired together in `src/index.ts`:
- **DeviceManager** — Provider-based device abstraction (currently only `DummyProvider` with 6 simulated devices)
- **MemoryStore** — SQLite-backed persistent memory (observation, preference, pattern, goal, reflection, plan)
- **ReflexEngine** — Fast local rules engine, triggers on device events without AI reasoning
- **ApprovalQueue** — Filters agent actions by confidence/category; auto-executes routine+high-confidence, queues others for user approval
- **OutcomeObserver** — Watches for user reversals within 5-min window, feeds learning back to coordinator
- **ProactiveScheduler** — Periodic wakeups (situational checks, reflection, goal review, daily summary)
- **EventBus** — Central typed pub/sub connecting all subsystems

**Frontend** (`@holms/frontend`) — React 19 + Vite + Tailwind v4. tRPC client with split links (WebSocket for subscriptions, HTTP batching for queries/mutations). Five panels: Dashboard, Chat, Devices, Memory, Reflexes.

## Event Flow

```
Device Event → DeviceManager → EventBus("device:event")
  → ReflexEngine (instant local rules)
  → OutcomeObserver (tracks agent action reversals)
  → Coordinator (batched, configurable delay)
  → Frontend (tRPC subscription)
```

## Key Conventions

- **Zod v4** — Required by agent SDK. `z.record()` needs 2 args: `z.record(z.string(), z.unknown())`
- **SDK streaming input** — `query()` with MCP tools requires async generator prompt yielding `SDKUserMessage` objects (need `session_id` and `parent_tool_use_id` fields)
- **tRPC v11** — Uses `createHTTPHandler` (not `createHTTPServer`)
- **TypeScript** — Both daemon and frontend use `noEmit: true` + `declaration: false`; shared uses `composite: true` with actual output
- **ESM throughout** — All packages are `"type": "module"`, use `.js` extensions in imports
- **Daemon config** — Environment variables loaded from `packages/daemon/.env` via `--env-file`: `HOLMS_PORT`, `HOLMS_DB_PATH`, `HOLMS_CLAUDE_CONFIG_DIR`
- **Database** — SQLite via `better-sqlite3`, tables: `memories`, `reflexes`
