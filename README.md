# Holms

<p align="center">
  <img src="assets/appicon.png" width="128" alt="Holms" />
</p>

AI-driven home automation coordinator powered by Claude. Instead of rigid if-then rules, Holms uses an LLM agent that observes your home, learns your preferences over time, and acts autonomously — while deferring to you on anything it's unsure about.

## Why "Holms"?

The name plays on *holm* — a small, self-contained island — reflecting a system that runs locally, independently, within its own borders. The echo of *Holmes* nods to its core behavior: observe the world, reason about what it sees, and act with purpose. Holms doesn't follow rules — it thinks. And like any good butler, it does so quietly, running your household without needing to be told.

## How it works

A daemon process connects to your smart home devices and feeds events to a Claude agent via the [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk). The agent has access to tools for querying device state, executing commands, storing memories, creating automations and fast local rules (reflexes), and spawning deep reasoning sub-agents for complex multi-device decisions. Multiple channel providers (web, Slack, Telegram, WhatsApp) let you chat with the agent from anywhere. A plugin system lets you extend the agent with local Claude Code extensions. A React frontend gives you a dashboard to monitor everything, chat with the agent, and approve or reject proposed actions.

### The agent loop

```
                       CoordinatorHub
                      /       |       \
         ChatCoordinator  ChatCoordinator  EphemeralRunner
         (web:default)    (slack:#gen)     (stateless, parallel)
              |               |                |
              +-------+-------+--------+-------+
                      |                |
                McpServerPool       EventBus
                (7 servers)      (shared pub/sub)
```

User messages route to a **ChatCoordinator** (one per channel, stateful with SDK session resume). Device events, proactive wakeups, and outcome feedback route to the **EphemeralRunner** (fresh session per turn, fully concurrent). Both tracks share the same MCP tool servers and event bus.

```
Device event arrives
       ↓
  ┌────┴──────────┐
  ↓               ↓
Reflex     AutomationMatcher
Engine     (device_event + state_threshold triggers)
(instant)         ↓
          ┌───────┴───────┐
          ↓               ↓
   Match found?      No match
   → Wake agent      → Triage engine classifies
     with context      (immediate / batch / silent)
          ↓               ↓
          EphemeralRunner receives event(s)
                 ↓
          Agent recalls memories & reasons
                 ↓
          ┌──────┼──────────────┐
          ↓      ↓              ↓
      Routine  Novel        Uncertain
      (act)    (act +       (propose action,
               remember)    wait for approval)
          ↓      ↓              ↓
          ↓  Deep reason   ApprovalQueue
          ↓  if complex     → Channels
          ↓      ↓              ↓
       OutcomeObserver watches for reversals
                 ↓
       If reversed → feedback → agent learns
```

Time-triggered automations follow a separate path: `ProactiveScheduler.tick()` (every 30s) → check for due automations → check for linked reflexes → if no reflex, wake coordinator.

### Memory & learning

The agent has a free-form, embedding-based memory system. Each memory consists of:

- **content** — the actual information to remember
- **retrieval cues** — search-optimized descriptions of when this memory should surface
- **tags** — agent-chosen labels for organization (no fixed categories)

Memories are embedded using [all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) vectors (384-dim, runs locally via `@huggingface/transformers`). The agent searches memories with **semantic similarity** rather than keyword matching, so a query like "bedtime routine" surfaces relevant preferences even if they don't contain those exact words.

Five memory tools give the agent full control over its own knowledge:

| Tool | Purpose |
|------|---------|
| **memory_write** | Store a new memory with content, retrieval cues, and tags |
| **memory_query** | Semantic search with optional tag/time filters; returns ranked results and metadata |
| **memory_rewrite** | Update content, cues, or tags of an existing memory (re-embeds if cues change) |
| **memory_forget** | Delete a memory that's no longer relevant |
| **memory_reflect** | Get store statistics: tag distribution, age buckets, similarity clusters, growth rate |
| **annotate_entity** | Set or update a short factual note on a device (max 300 chars); empty string clears it |
| **query_entity_notes** | Semantic search across all device annotations |

The `memory_reflect` tool supports self-maintenance — the agent can spot redundant memories (similarity clusters), track growth rate, and consolidate during reflection cycles.

When a user reverses an agent action (e.g. turns off a light the agent turned on), the outcome observer detects the reversal and sends feedback to the agent, which stores lessons learned.

### Entity annotations

The agent can attach short factual notes (max 300 chars) to individual devices using `annotate_entity`. These notes capture stable device knowledge — what it controls, known quirks, physical location details — and are automatically included in device state queries. This gives the agent baseline context about every device at the start of each cycle without needing explicit memory lookups.

Entity notes answer *"what is this thing?"* while regular memories answer *"what do I know about situations involving this thing?"*. Notes are searchable via semantic similarity, so the agent (or user) can query across all annotations — e.g. "heating devices" or "entrance area" — to find relevant devices.

### Automations

The agent can create **automations** — trigger-based tasks that wake the AI coordinator when they fire. Unlike reflexes (instant, no reasoning), automations invoke the full agent loop so the coordinator can apply context-aware judgment each time.

Three trigger types are supported:

| Trigger | Example | Fires when |
|---------|---------|------------|
| **Time** | "Turn off porch lights at 23:00" | Cron-like schedule (once, daily, weekdays, weekends, weekly) |
| **Device event** | "When front door unlocks, check who's home" | A specific device emits a matching event |
| **State threshold** | "When living room temp drops below 18°C, adjust heating" | A numeric device state crosses a threshold (gt/lt/eq/gte/lte) |

When an automation fires, the coordinator receives the trigger context alongside device state and memories, reasons about what to do, and executes. Event-triggered automations are matched *before* triage — if an automation claims an event, triage is skipped entirely. Time-triggered automations fire via the proactive scheduler on a 30-second tick.

**Automation → reflex promotion**: After an automation fires predictably enough times, the agent can promote it to a reflex for instant execution. Reflexes can reference their parent automation via `automationId`, so the reflex engine checks for linked reflexes before waking the coordinator.

### Reflexes

For time-critical automations where LLM latency is unacceptable (e.g. turning on a light when motion is detected), the agent can create **reflexes** — local rules that execute in sub-second time without AI reasoning. The agent creates and manages these rules through its tools; they run in the reflex engine independently. Reflexes can also be linked to automations — when a linked reflex exists, it executes instantly instead of waking the coordinator.

### Deep reasoning

For complex situations — multi-device trade-offs, competing constraints (comfort vs. energy), or novel scenarios — the coordinator can spawn a **deep reason** sub-agent. This sub-agent has read-only access to device state, memories, schedules, reflexes, and triage rules, but cannot execute commands. It analyzes the problem and returns recommendations; the coordinator decides what to act on.

### Event triage

The agent self-manages how it gets woken up. It assigns each event source a **triage lane**:

- **immediate** — wake the agent right away
- **batch** — collect and deliver on a timer (default 2 min)
- **silent** — drop the event entirely

During reflection cycles, the agent reviews its triage rules — silencing noisy sources it never acts on, and escalating ones it missed.

### Goals

The agent can track long-term objectives using the **goals** system. Goals have a title, description, status (active / completed / abandoned), and a timeline of events. The agent logs observations, progress updates, and milestones against goals, and reviews them during daily goal review cycles. Goals that need attention are flagged and surfaced prominently.

### People

Holms maintains a **people** registry for household members. Each person can be linked to one or more messaging channels (with sender IDs for identity resolution), have a primary notification channel, and carry arbitrary properties (schedule, presence, preferences). The agent considers person context when reasoning about events — e.g., checking who's home before adjusting heating.

### Proactive behavior

The agent doesn't just react to events. A scheduler periodically wakes it up for:

- **Situational checks** (every 30 min) — assess current home state, act if needed
- **Reflection** (every 4 hours) — review recent actions, outcomes, and triage rules
- **Goal review** (daily) — check progress on active goals
- **Daily summary** (at 22:00) — end-of-day recap and planning

Each proactive cycle produces a one-sentence summary shown on the Overview dashboard, with full details available on expand.

### Channels

Holms supports multiple messaging channels so you can talk to the agent from wherever you are. Each channel provider handles its own transport and message format while routing conversations to the same coordinator.

| Channel | Status | Capabilities |
|---------|--------|--------------|
| **Web** | Built-in | Single conversation, approval buttons, rich formatting |
| **Slack** | Provider | Multi-conversation (channels/DMs), approval buttons, threads, reactions |
| **Telegram** | Provider | Multi-conversation, approval buttons |
| **WhatsApp** | Provider | Multi-conversation, QR pairing |

Conversations follow the format `providerId:conversationId` (e.g. `slack:#general`, `telegram:12345`, `web:default`). Each conversation gets its own ChatCoordinator with full session history. Channel routes let you direct specific event types (approvals, device events, broadcasts) to specific channels.

### Plugins

Holms supports [Claude Code extensions](https://docs.anthropic.com/en/docs/claude-code) as plugins. Drop a Claude Code extension directory into `~/.holms/plugins/` and it will be discovered automatically. Plugins can provide MCP servers, commands, agents, skills, and hooks. Enable/disable plugins from the Plugins panel in the frontend.

## Project structure

```
packages/
├── shared/     Types shared between daemon and frontend
├── daemon/     Node.js server: tRPC API + Claude agent coordinator
└── frontend/   React dashboard: device control, chat, monitoring
```

**Daemon** runs on port 3100 and exposes a tRPC API over HTTP and WebSocket. Subsystems:

- **CoordinatorHub** — multi-track architecture that routes work to the right executor:
  - **ChatCoordinator** (per-channel, stateful) — one instance per conversation channel (e.g. `web:default`, `slack:#general`). Maintains SDK session continuity via `resume` so the agent has full conversation history. Serializes turns within a channel via an async queue. Different channels run independently.
  - **EphemeralRunner** (stateless, parallel) — handles device events, proactive wakeups, outcome feedback, and automations. Fresh SDK session per turn, no `resume`. Multiple runs execute concurrently — a proactive cycle never blocks user chat.
  - **McpServerPool** — shared pool of in-process MCP tool servers (device-query, device-command, memory, reflex, approval, automation, triage, channels) used by both tracks.
- **Deep Reason** — spawns a focused sub-agent for complex multi-device trade-offs, competing constraints, and novel situations; has read-only tool access (no device commands)
- **DeviceManager** — provider-based device abstraction with a standard capabilities catalog across domains (light, climate, cover, lock, fan, media_player, etc.)
- **ChannelManager** — routes inbound messages from channel providers (web, Slack, Telegram, WhatsApp) to the correct ChatCoordinator. Manages channel routes for directing events to specific destinations.
- **AutomationStore** / **AutomationMatcher** — persistence and event matching for automations. Matcher debounces at 60s per automation and claims events before triage.
- **GoalStore** — tracks long-term objectives with timelines, status, and attention flags
- **PeopleStore** — household member registry with channel links, sender ID resolution, and properties
- **MemoryStore** — SQLite-backed persistence with local embedding vectors (all-MiniLM-L6-v2 via `@huggingface/transformers`) for semantic search
- **ReflexEngine** — evaluates local automation rules on device events; supports automation-linked reflexes
- **ApprovalQueue** — routes agent actions by confidence/category, auto-executes safe ones
- **OutcomeObserver** — detects user reversals within a 5-minute observation window
- **ProactiveScheduler** — periodic wakeups for reflection, goal review, etc.; fires time-triggered automations on a 30s tick
- **PluginManager** — discovers and manages local Claude Code extensions in `~/.holms/plugins/`
- **EventBus** — typed pub/sub connecting all subsystems

**Frontend** runs on port 5173 (Vite dev server, proxied to daemon). Panels: Overview, Chat, Devices, Integrations, Memory (with Entity Notes tab), Automations, Reflexes, Goals, People, Triage, Channels, Activity, Plugins.

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
| `HOLMS_HF_CACHE_DIR` | `~/.holms/models` | HuggingFace model cache for embeddings |
| `HOLMS_CLAUDE_CONFIG_DIR` | `~/.claude` | Claude config directory |
| `HOLMS_PLUGINS_DIR` | `~/.holms/plugins` | Plugin discovery directory |
| `HOLMS_MODEL_COORDINATOR` | `claude-sonnet-4-6` | Model for the main coordinator agent |
| `HOLMS_MODEL_DEEP_REASON` | `claude-sonnet-4-6` | Model for deep reasoning sub-agent |
| `HOLMS_DEEP_REASON_MAX_TURNS` | `10` | Max tool-use turns for deep reasoning |

Agent behavior (batch delay, max turns, budget, proactive intervals) is configured in `packages/daemon/src/config.ts`.

### Device providers

#### Home Assistant

Connect to a Home Assistant instance via WebSocket. Configure the URL and long-lived access token from the Integrations panel, then use the entity picker to select which entities to expose to the agent. Only selected entities appear in device queries and generate events — unselected entities are ignored entirely.

The provider maps HA services to a standard capabilities catalog so the agent uses a consistent command vocabulary across providers (e.g. `turn_on`, `set_brightness`, `set_temperature` regardless of the underlying platform).

Entity state is split into two layers: **state** (normalized, well-known keys like `power`, `brightness`, `value`) and **attributes** (all remaining provider data not already in state). The `list_devices` tool returns only the compact state for efficiency; `get_device_state` includes the full attributes — useful for entities that carry rich extra data like hourly energy price arrays, forecast lists, or configuration metadata.

#### Simulated devices (development)

The built-in dummy provider creates 6 devices for development:

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

Implement the `DeviceProvider` interface using `DeviceDescriptorBase` and register it with `DeviceManager`. See `packages/daemon/src/devices/providers/home-assistant.ts` for a full implementation. The provider needs to:

1. Return device metadata, current state, and supported capabilities (from the standard catalog in `capabilities.ts`)
2. Execute commands using the standard capability vocabulary (turn_on, set_brightness, etc.)
3. Emit events when device state changes
4. Support lifecycle methods: `connect()`, `disconnect()`, `getDevices()`, `getAreas()`

## Tech stack

- **Agent**: [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk) with in-process MCP tool servers
- **API**: [tRPC v11](https://trpc.io/) over HTTP + WebSocket
- **Database**: SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **Home Assistant**: [home-assistant-js-websocket](https://github.com/home-assistant/home-assistant-js-websocket) for real-time HA integration
- **Frontend**: React 19, Vite 6, Tailwind CSS v4
- **Validation**: Zod v4
- **Language**: TypeScript (strict mode, ESM throughout)
