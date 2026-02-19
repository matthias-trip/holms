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

2. **Coordinator** — Wraps Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`). The agent receives batched device events, user messages, proactive wakeups, and outcome feedback. It interacts with 7 MCP tool servers running in-process via `createSdkMcpServer`: device-query, device-command, memory, reflex, approval, schedule, triage. Plugins can add more. Session continuity via stored `sessionId` + SDK `resume` option. Only MCP tools are allowed (`mcp__*` pattern); Bash, Read, Write, and other file tools are explicitly disallowed.

Supporting subsystems wired together in `src/index.ts`:
- **DeviceManager** — Provider-based device abstraction (currently only `DummyProvider` with 6 simulated devices)
- **MemoryStore** — SQLite-backed persistent memory with embedding vectors (all-MiniLM-L6-v2 via `@huggingface/transformers`) for semantic search
- **ReflexEngine** — Fast local rules engine, triggers on device events without AI reasoning
- **TriageEngine** — Classifies incoming events into lanes (immediate / batch / silent) with command echo suppression
- **ApprovalQueue** — Routes agent actions by confidence/category; `propose_action` always requires user approval
- **OutcomeObserver** — Watches for user reversals within 5-min window, feeds learning back to coordinator
- **ProactiveScheduler** — Periodic wakeups (situational checks, reflection, goal review, daily summary) plus agent-created scheduled tasks
- **PluginManager** — Discovers Claude Code extensions in `~/.holms/plugins/` (and builtin `plugins/`); plugins can provide MCP servers and agents
- **EventBus** — Central typed pub/sub connecting all subsystems

**Frontend** (`@holms/frontend`) — React 19 + Vite + Tailwind v4. tRPC client with split links (WebSocket for subscriptions, HTTP batching for queries/mutations). Panels: Overview, Chat, Devices, Memory, Reflexes, Schedules, Activity, Plugins.

## Event Flow

```
Device Event → DeviceManager → EventBus("device:event")
  → TriageEngine (classifies: immediate / batch / silent)
  → ReflexEngine (instant local rules)
  → OutcomeObserver (tracks agent action reversals)
  → Coordinator (immediate or batched via triage lane)
  → Frontend (tRPC subscription)
```

## Database

SQLite via `better-sqlite3`. Tables: `memories_v2` (with embedding BLOBs), `reflexes`, `chat_messages`, `agent_activities`, `bus_events`, `triage_rules`, `schedules`.

## Configuration

Environment variables in `packages/daemon/.env` (loaded via `--env-file`):

| Variable | Default | Description |
|----------|---------|-------------|
| `HOLMS_PORT` | `3100` | Daemon API port |
| `HOLMS_DB_PATH` | `./holms.db` | SQLite database path |
| `HOLMS_HF_CACHE_DIR` | `~/.holms/models` | HuggingFace model cache for embeddings |
| `HOLMS_CLAUDE_CONFIG_DIR` | `~/.claude` | Claude config directory |
| `HOLMS_PLUGINS_DIR` | `~/.holms/plugins` | Plugin discovery directory |
| `HOLMS_MODEL_COORDINATOR` | `claude-sonnet-4-6` | Model for main coordinator agent |
| `HOLMS_MODEL_DEEP_REASON` | `claude-sonnet-4-6` | Model for deep reasoning sub-agent |
| `HOLMS_DEEP_REASON_MAX_TURNS` | `10` | Max tool-use turns for deep reasoning |

Agent behavior (batch delay, max turns, budget, proactive intervals) is configured in `packages/daemon/src/config.ts`.

## Key Conventions

- **Zod v4** — Required by agent SDK. `z.record()` needs 2 args: `z.record(z.string(), z.unknown())`
- **SDK streaming input** — `query()` with MCP tools requires async generator prompt yielding `SDKUserMessage` objects (need `session_id` and `parent_tool_use_id` fields)
- **tRPC v11** — Uses `createHTTPHandler` (not `createHTTPServer`)
- **TypeScript** — Both daemon and frontend use `noEmit: true` + `declaration: false`; shared uses `composite: true` with actual output
- **ESM throughout** — All packages are `"type": "module"`, use `.js` extensions in imports
- **MCP tool servers** — Created with `createSdkMcpServer()` + `tool()` for individual tools with Zod schemas
- **Plugin structure** — Directory with `.claude-plugin/plugin.json` for metadata, optional `.mcp.json` for MCP servers, optional `agents/` for agent specs
