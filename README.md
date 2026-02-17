# Holms

AI-driven home automation coordinator powered by Claude. Instead of rigid if-then rules, Holms uses an LLM agent that observes your home, learns your preferences over time, and acts autonomously — while deferring to you on anything it's unsure about.

## How it works

A daemon process connects to your smart home devices and feeds events to a Claude agent via the [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk). The agent has access to tools for querying device state, executing commands, storing memories, and creating fast local automation rules (reflexes). A React frontend gives you a dashboard to monitor everything, chat with the agent, and approve or reject proposed actions.

### The agent loop

```
Device events arrive → batched and sent to Claude agent
                           ↓
                    Agent reasons about events
                           ↓
              ┌────────────┼────────────────┐
              ↓            ↓                ↓
          Routine       Novel           Critical
        (just do it)  (do it, note    (propose action,
                       it's new)      wait for approval)
              ↓            ↓                ↓
         Execute      Execute +        ApprovalQueue
         command      remember          → Frontend
              ↓            ↓                ↓
           OutcomeObserver watches for user reversals
              ↓
         If reversed → feed back to agent for learning
```

### Memory & learning

The agent maintains persistent memory in six categories:

| Type | Purpose |
|------|---------|
| **observation** | Facts about the home and patterns noticed |
| **preference** | Learned user preferences (e.g. "likes bedroom at 19°C") |
| **pattern** | Recurring behaviors (e.g. "leaves for work at 8:30") |
| **goal** | Active objectives the agent is working toward |
| **reflection** | Self-assessment of past decisions |
| **plan** | Multi-step strategies for achieving goals |

When a user reverses an agent action (e.g. turns off a light the agent turned on), the outcome observer detects the reversal and sends feedback to the agent, which stores lessons learned.

### Reflexes

For time-critical automations where LLM latency is unacceptable (e.g. turning on a light when motion is detected), the agent can create **reflexes** — local rules that execute in sub-second time without AI reasoning. The agent creates and manages these rules through its tools; they run in the reflex engine independently.

### Proactive behavior

The agent doesn't just react to events. A scheduler periodically wakes it up for:

- **Situational checks** (every 5 min) — assess current home state, act if needed
- **Reflection** (every 30 min) — review recent actions and outcomes
- **Goal review** (every 2 hours) — check progress on active goals
- **Daily summary** — end-of-day recap and planning

## Project structure

```
packages/
├── shared/     Types shared between daemon and frontend
├── daemon/     Node.js server: tRPC API + Claude agent coordinator
└── frontend/   React dashboard: device control, chat, monitoring
```

**Daemon** runs on port 3100 and exposes a tRPC API over HTTP and WebSocket. Subsystems:

- **Coordinator** — wraps Claude Agent SDK, manages the agent session, exposes 5 MCP tool servers (device-query, device-command, memory, reflex, approval)
- **DeviceManager** — provider-based device abstraction (ships with a dummy provider for 6 simulated devices)
- **MemoryStore** / **ReflexStore** — SQLite-backed persistence via better-sqlite3
- **ReflexEngine** — evaluates local automation rules on device events
- **ApprovalQueue** — routes agent actions by confidence/category, auto-executes safe ones
- **OutcomeObserver** — detects user reversals within a 5-minute observation window
- **ProactiveScheduler** — periodic wakeups for reflection, goal review, etc.
- **EventBus** — typed pub/sub connecting all subsystems

**Frontend** runs on port 5173 (Vite dev server, proxied to daemon). Five panels: Dashboard (overview grid), Chat, Devices, Memory, Reflexes.

## Getting started

### Prerequisites

- Node.js 20+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`claude` CLI)

The daemon uses the Claude Agent SDK, which runs Claude Code under the hood — no separate API key needed.

### Install & run

```bash
npm install

# Configure (optional — defaults work out of the box)
cp packages/daemon/.env.example packages/daemon/.env

# Start both daemon and frontend
npm run dev
```

The dashboard will be at [http://localhost:5173](http://localhost:5173).

### Configuration

All config is via environment variables in `packages/daemon/.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `HOLMS_PORT` | `3100` | Daemon API port |
| `HOLMS_DB_PATH` | `./holms.db` | SQLite database path |
| `HOLMS_CLAUDE_CONFIG_DIR` | `~/.claude` | Claude config directory |

Agent behavior (batch delay, max turns, budget, proactive intervals) is configured in `packages/daemon/src/config.ts`.

### Simulated devices

The dummy provider creates 6 devices for development:

- 3 lights (living room, bedroom, kitchen) — brightness control
- 1 thermostat — target temperature, mode, gradual temperature drift
- 1 motion sensor — triggers randomly every 30–60s
- 1 door lock — lock/unlock

## Scripts

```bash
npm run dev              # Run daemon + frontend concurrently
npm run dev:daemon       # Daemon only
npm run dev:frontend     # Frontend only
npm run build            # Build all packages (shared → daemon → frontend)
```

Per-package type checking:

```bash
npm run typecheck -w @holms/daemon
npm run typecheck -w @holms/frontend
npm run typecheck -w @holms/shared
```

## Adding a device provider

Implement the `DeviceProvider` interface and register it with `DeviceManager` in `packages/daemon/src/index.ts`. See `packages/daemon/src/devices/providers/dummy.ts` for a reference implementation. The provider needs to:

1. Return device metadata and current state
2. Execute commands (turn on/off, set brightness, etc.)
3. Emit events when device state changes

## Tech stack

- **Agent**: [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk) with in-process MCP tool servers
- **API**: [tRPC v11](https://trpc.io/) over HTTP + WebSocket
- **Database**: SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **Frontend**: React 19, Vite 6, Tailwind CSS v4
- **Validation**: Zod v4
- **Language**: TypeScript (strict mode, ESM throughout)
