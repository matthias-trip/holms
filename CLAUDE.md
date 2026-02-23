# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Philosophy — Agent-First Design

Holms is an **agentic system**. The coordinator is a reasoning AI agent that observes, remembers, decides, and acts — not a programmatic pipeline disguised in AI wrapping.

**Before every change, ask yourself:** _Is this truly agentic reasoning, or am I building a programmatic rule engine with an LLM bolted on?_

Signs you're doing it right:
- The agent **reasons about context** each time (memories, device state, time of day, who's home) before deciding what to do
- New behaviors emerge from the agent **learning preferences** over time, not from hardcoded if/else branches
- Automations start as AI-reasoned responses and only get promoted to reflexes after the agent proves consistent identical outcomes
- The agent can **surprise you** with a better approach because it has the freedom to reason

Signs you're building a disguised rule engine:
- Hardcoding behavior that the agent should learn from interaction
- Adding programmatic conditions where the agent should recall memories and reason
- Creating reflexes (instant, no-reasoning rules) for things that need context
- Building elaborate code paths that remove the agent's ability to adapt

The subsystems (triage, reflexes, approvals) exist to **support** the agent — giving it fast paths for proven patterns, routing events intelligently, and enforcing safety. They don't replace its reasoning. When in doubt, keep reasoning in the agent and keep the surrounding code simple.

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

**Shared** (`@holms/shared`) — TypeScript types only, no runtime code. Defines device types, memory types, reflex triggers/actions, approval workflow types, chat messages, channel types, goal types, and agent activity types.

**Daemon** (`@holms/daemon`) — Node.js server on port 3100. Two main responsibilities:

1. **tRPC API** — HTTP + WebSocket server (manual `http.createServer` for CORS + `applyWSSHandler`). Routers: `devices`, `device-providers`, `chat`, `memory`, `reflex`, `approval`, `events`, `automation`, `triage`, `channels`, `people`, `goals`, `history`, `plugins`, `agents`. WebSocket subscriptions push real-time updates.

2. **CoordinatorHub** — Multi-track architecture wrapping Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`). Routes work to two executor types:
   - **ChatCoordinator** (per-channel, stateful) — one instance per conversation channel. Maintains SDK session via `resume` for conversation history. Serializes turns within a channel; different channels run independently.
   - **EphemeralRunner** (stateless, parallel) — handles device events, proactive wakeups, outcome feedback. Fresh SDK session per turn, fully concurrent.
   - **McpServerPool** — shared pool of in-process MCP tool servers (`createSdkMcpServer`): device-query, device-command, memory, reflex, approval, schedule, triage, automation, channels, people, goals, history. Plugins can add more. Only MCP tools are allowed (`mcp__*` pattern); Bash, Read, Write, and other file tools are explicitly disallowed.

Supporting subsystems wired together in `src/index.ts`:
- **DeviceManager** — Provider-based device abstraction. Providers: Home Assistant (`ha-provider`), with HA entity filter for selecting tracked entities
- **ChannelManager** — Multi-channel messaging: web (built-in), WhatsApp, Slack. Each channel has a provider and descriptor. Channels link to people for auto-identification.
- **MemoryStore** — SQLite-backed persistent memory with embedding vectors (all-MiniLM-L6-v2 via `@huggingface/transformers`) for semantic search. Supports pinned memories, person/entity association, scoped queries.
- **ReflexEngine** — Fast local rules engine, triggers on device events without AI reasoning. Only for proven unconditional patterns.
- **TriageEngine** — Classifies incoming events into lanes (immediate / batch / silent) with command echo suppression
- **ApprovalQueue** — Routes agent actions by confidence/category; `propose_action` always requires user approval
- **OutcomeObserver** — Watches for user reversals within 5-min window, feeds learning back to coordinator
- **ProactiveScheduler** — Periodic wakeups (situational checks, reflection, goal review, daily summary) plus agent-created scheduled tasks
- **AutomationEngine** — Manages automations (time, device-event, state-threshold triggers). Automations fire with full AI reasoning each time — they are the primary automation primitive.
- **GoalStore** — Tracked objectives with timeline events (observations, actions, milestones), attention flagging, and periodic review cycles
- **PeopleStore** — Household members with channel links for auto-identification and person-scoped memories
- **HistoryStore** — Entity history with time-series data for device state over time, supports charting and trend queries
- **PluginManager** — Discovers Claude Code extensions in `~/.holms/plugins/` (and builtin `plugins/`); plugins can provide MCP servers and agents
- **EventBus** — Central typed pub/sub connecting all subsystems

**Frontend** (`@holms/frontend`) — React 19 + Vite + Tailwind v4. tRPC client with split links (WebSocket for subscriptions, HTTP batching for queries/mutations). Components: CycleOverview (main dashboard), ChatPanel, DevicePanel, MemoryPanel, AutomationsPanel, ReflexPanel, TriagePanel, GoalsPanel, PeoplePanel, ChannelsPanel, ApprovalPanel, ActivityPanel, PluginsPanel, IntegrationsPanel, UsagePanel.

## Agent Prompt Architecture

The agent's behavior is defined by layered prompts, not application code:

- **`coordinator.md`** — Core personality, decision framework, memory discipline, approval rules, automation vs reflex guidance. This is the primary behavioral specification.
- **`system-prompt.ts`** — Dynamic context injected each turn: current time, device states with pinned memories, household members, active automations, pending approvals, conversation scope.
- **`history-skill.md`** — Instructions for querying and charting device history data.
- **MCP tool descriptions** (in each subsystem's `tools.ts`) — Self-contained tool docs the agent sees. These intentionally repeat key rules since tools need standalone descriptions.

When changing agent behavior, modify the prompts first. Only add code when the agent genuinely can't handle something through reasoning alone.

## Event Flow

```
Device Event → DeviceManager → EventBus("device:event")
  → TriageEngine (classifies: immediate / batch / silent)
  → ReflexEngine (instant local rules)
  → OutcomeObserver (tracks agent action reversals)
  → AutomationEngine (checks device-event / state-threshold triggers)
  → Coordinator (immediate or batched via triage lane)
  → Frontend (tRPC subscription)
```

## Database

SQLite via `better-sqlite3`. Tables:
- `memories` — with embedding BLOBs, pin support, person/entity association, scope
- `reflexes` — instant no-reasoning rules
- `automations` — AI-reasoned automation triggers and instructions
- `chat_messages` — conversation history per channel
- `agent_activities` / `bus_events` — activity log and event audit trail
- `triage_rules` — event routing configuration
- `goals` / `goal_events` — tracked objectives with timeline
- `people` / `person_channels` — household members and channel links
- `entity_history` / `entity_catalog` — device state time-series
- `channel_configs` / `channel_routes` / `channel_conversations` — channel management
- `device_provider_configs` — provider settings (HA connection, etc.)
- `ha_entity_filter` — Home Assistant entity selection

## Configuration

Environment variables in `packages/daemon/.env` (loaded via `--env-file`):

| Variable | Default | Description |
|----------|---------|-------------|
| `HOLMS_PORT` | `3100` | Daemon API port |
| `HOLMS_DB_PATH` | `./holms.db` | SQLite database path |
| `HOLMS_HF_CACHE_DIR` | `~/.holms/models` | HuggingFace model cache for embeddings |
| `HOLMS_CLAUDE_CONFIG_DIR` | `~/.claude` | Claude config directory |
| `HOLMS_CLAUDE_EXECUTABLE_PATH` | *(auto)* | Path to native `claude` binary for Agent SDK |
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
- **Automations before reflexes** — Always create an automation first. Only promote to reflex after proven consistent identical outcomes with no conditions.
- **Prompt-first changes** — When changing agent behavior, modify `coordinator.md` or tool descriptions before writing application code. The agent should learn and adapt through reasoning, not through hardcoded logic.
