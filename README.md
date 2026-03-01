# Holms

<p align="center">
  <img src="assets/appicon.png" width="128" alt="Holms" />
</p>

AI-driven home automation coordinator powered by Claude. Instead of rigid if-then rules, Holms uses an LLM agent that observes your home, learns your preferences over time, and acts autonomously — while deferring to you on anything it's unsure about.

## Why "Holms"?

The name plays on *holm* — a small, self-contained island — reflecting a system that runs locally, independently, within its own borders. The echo of *Holmes* nods to its core behavior: observe the world, reason about what it sees, and act with purpose. Holms doesn't follow rules — it thinks. And like any good butler, it does so quietly, running your household without needing to be told.

## How it works

A daemon process connects to your smart home through **adapters** — isolated processes that bridge external platforms (Hue, Home Assistant, calendars, weather services) into a unified **Habitat** model of spaces, sources, and properties. Events flow to a Claude agent via the [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk). The agent has tools for observing and influencing the home, storing memories, creating automations and fast local rules (reflexes), and spawning deep reasoning sub-agents for complex multi-source decisions. Multiple channel providers (web, Slack, Telegram, WhatsApp) let you chat with the agent from anywhere. A React frontend gives you a dashboard to monitor everything, chat with the agent, and approve or reject proposed actions.

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
                                 (shared pub/sub)
```

User messages route to a **ChatCoordinator** (one per channel, stateful with SDK session resume). Habitat events, proactive wakeups, and outcome feedback route to the **EphemeralRunner** (fresh session per turn, fully concurrent). Both tracks share the same MCP tool servers and event bus.

```
Adapter state change arrives
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

### Habitat — spaces, sources, and properties

Holms models your home as a **Habitat** — a hierarchy of **spaces** (rooms, floors, zones) containing **sources** (individual devices or data feeds from adapters). Each source exposes one or more **properties** from a fixed domain vocabulary:

| Property domain | Examples |
|-----------------|----------|
| **illumination** | Lights, dimmers, color bulbs |
| **climate** | Thermostats, radiators, AC |
| **occupancy** | Motion sensors, presence detectors |
| **access** | Door locks, gates, garage doors |
| **media** | Speakers, TVs, media players |
| **power** | Smart plugs, energy monitors |
| **water** | Flow sensors, leak detectors |
| **safety** | Smoke/CO detectors, alarms |
| **air_quality** | CO₂, humidity, VOC sensors |
| **schedule** | Calendar events, waste collection |
| **weather** | Temperature, forecast, wind |

The agent interacts with the Habitat through two core tools — `observe` (read state across spaces) and `influence` (send commands to sources) — plus tools for managing spaces and adapter configuration. Property domains define normalized command fields and queryable schemas so the agent uses a consistent vocabulary regardless of the underlying platform.

### Adapters

Adapters are standalone processes that bridge external platforms into the Habitat. Each adapter runs in its own Node.js process and communicates with the daemon over NDJSON stdio — a crash in one adapter never takes down the system. The daemon supervises adapters with health monitoring (30s ping), automatic restart with exponential backoff, and per-instance log capture.

The `@holms/adapter-sdk` package provides the `Adapter` interface and `runAdapter()` harness that handles the IPC protocol. Adapters register entities with property mappings, push state changes, and respond to observe/execute/query requests.

Built-in adapters:

| Adapter | Description |
|---------|-------------|
| **hue** | Philips Hue bridge (multi-instance, mDNS discovery, link-button pairing) |
| **caldav** | Calendar feeds via CalDAV |
| **pirate-weather** | Weather forecasts |
| **afvalinfo** | Waste collection schedules |
| **brink** | Brink HVAC / heat recovery |
| **ismartgate** | Gate controller |

Drop custom adapters into `~/.holms/adapters/`. Each adapter needs an `adapter.json` manifest pointing to a built `.js` entry file.

#### Agent-guided setup

Adapters that declare `setup` or `pair` capabilities get an agent-guided setup flow. When you click "Setup" in the Adapters panel, a chat modal opens where the agent walks you through configuration step by step — discovering bridges on your network, prompting for credentials (stored encrypted via AES-256-GCM), and assigning discovered entities to spaces. Adapters can include `skills/` directories with SKILL.md files that teach the agent their specific setup sequence.

### Memory & learning

The agent has a free-form, embedding-based memory system. Each memory consists of:

- **content** — the actual information to remember
- **retrieval cues** — search-optimized descriptions of when this memory should surface
- **tags** — agent-chosen labels for organization (no fixed categories)

Memories are embedded using [all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) vectors (384-dim, runs locally via `@huggingface/transformers`). The agent searches memories with **semantic similarity** rather than keyword matching, so a query like "bedtime routine" surfaces relevant preferences even if they don't contain those exact words.

Memory tools give the agent full control over its own knowledge:

| Tool | Purpose |
|------|---------|
| **memory_write** | Store a new memory with content, retrieval cues, and tags |
| **memory_query** | Semantic search with optional tag/time filters; returns ranked results and metadata |
| **memory_rewrite** | Update content, cues, or tags of an existing memory (re-embeds if cues change) |
| **memory_forget** | Delete a memory that's no longer relevant |
| **memory_reflect** | Get store statistics: tag distribution, age buckets, similarity clusters, growth rate |
| **annotate_entity** | Set or update a short factual note on a source (max 300 chars); empty string clears it |
| **query_entity_notes** | Semantic search across all source annotations |

The `memory_reflect` tool supports self-maintenance — the agent can spot redundant memories (similarity clusters), track growth rate, and consolidate during reflection cycles.

When a user reverses an agent action (e.g. turns off a light the agent turned on), the outcome observer detects the reversal and sends feedback to the agent, which stores lessons learned.

### Entity annotations

The agent can attach short factual notes (max 300 chars) to individual sources using `annotate_entity`. These notes capture stable knowledge — what it controls, known quirks, physical location details — and are automatically included in observe queries. This gives the agent baseline context about every source at the start of each cycle without needing explicit memory lookups.

Entity notes answer *"what is this thing?"* while regular memories answer *"what do I know about situations involving this thing?"*. Notes are searchable via semantic similarity, so the agent (or user) can query across all annotations — e.g. "heating devices" or "entrance area" — to find relevant sources.

### Automations

The agent can create **automations** — trigger-based tasks that wake the AI coordinator when they fire. Unlike reflexes (instant, no reasoning), automations invoke the full agent loop so the coordinator can apply context-aware judgment each time.

Three trigger types are supported:

| Trigger | Example | Fires when |
|---------|---------|------------|
| **Time** | "Turn off porch lights at 23:00" | Cron-like schedule (once, daily, weekdays, weekends, weekly) |
| **Device event** | "When front door unlocks, check who's home" | A specific source emits a matching event |
| **State threshold** | "When living room temp drops below 18°C, adjust heating" | A numeric source state crosses a threshold (gt/lt/eq/gte/lte) |

When an automation fires, the coordinator receives the trigger context alongside source state and memories, reasons about what to do, and executes. Event-triggered automations are matched *before* triage — if an automation claims an event, triage is skipped entirely. Time-triggered automations fire via the proactive scheduler on a 30-second tick.

**Automation → reflex promotion**: After an automation fires predictably enough times, the agent can promote it to a reflex for instant execution. Reflexes can reference their parent automation via `automationId`, so the reflex engine checks for linked reflexes before waking the coordinator.

### Reflexes

For time-critical automations where LLM latency is unacceptable (e.g. turning on a light when motion is detected), the agent can create **reflexes** — local rules that execute in sub-second time without AI reasoning. The agent creates and manages these rules through its tools; they run in the reflex engine independently. Reflexes can also be linked to automations — when a linked reflex exists, it executes instantly instead of waking the coordinator.

### Deep reasoning

For complex situations — multi-source trade-offs, competing constraints (comfort vs. energy), or novel scenarios — the coordinator can spawn a **deep reason** sub-agent. This sub-agent has read-only access to source state, memories, schedules, reflexes, and triage rules, but cannot execute commands. It analyzes the problem and returns recommendations; the coordinator decides what to act on.

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

- **Situational checks** (every 2 hours) — assess current home state, act if needed
- **Reflection** (every 4 hours) — review recent actions, outcomes, and triage rules
- **Goal review** (daily) — check progress on active goals
- **Daily summary** (at 22:00) — end-of-day recap and planning

Each proactive cycle produces a one-sentence summary shown on the Overview dashboard, with full details available on expand.

### Channels

Holms supports multiple messaging channels so you can talk to the agent from wherever you are. Each channel provider handles its own transport and message format while routing conversations to the same coordinator.

| Channel | Status | Capabilities |
|---------|--------|--------------|
| **Web** | Built-in | Single conversation, approval buttons, interactive questions, rich formatting |
| **Slack** | Provider | Multi-conversation (channels/DMs), approval buttons, threads, reactions |
| **Telegram** | Provider | Multi-conversation, approval buttons |
| **WhatsApp** | Provider | Multi-conversation, QR pairing |

Conversations follow the format `providerId:conversationId` (e.g. `slack:#general`, `telegram:12345`, `web:default`). Each conversation gets its own ChatCoordinator with full session history. Channel routes let you direct specific event types (approvals, device events, broadcasts) to specific channels.

## Project structure

```
packages/
├── shared/        Types shared between daemon and frontend
├── adapter-sdk/   Adapter IPC protocol, types, and runAdapter() harness
├── daemon/        Node.js server: tRPC API + Claude agent coordinator
└── frontend/      React dashboard: spaces, chat, monitoring
adapters/
├── hue/           Philips Hue bridge adapter
├── caldav/        Calendar adapter
├── pirate-weather/ Weather forecast adapter
├── afvalinfo/     Waste collection adapter
├── brink/         HVAC adapter
└── ismartgate/    Gate controller adapter
```

**Daemon** runs on port 3100 and exposes a tRPC API over HTTP and WebSocket. Subsystems:

- **CoordinatorHub** — multi-track architecture that routes work to the right executor:
  - **ChatCoordinator** (per-channel, stateful) — one instance per conversation channel (e.g. `web:default`, `slack:#general`). Maintains SDK session continuity via `resume` so the agent has full conversation history. Serializes turns within a channel via an async queue. Different channels run independently.
  - **EphemeralRunner** (stateless, parallel) — handles habitat events, proactive wakeups, outcome feedback, and automations. Fresh SDK session per turn, no `resume`. Multiple runs execute concurrently — a proactive cycle never blocks user chat.
  - **McpServerPool** — shared pool of in-process MCP tool servers (habitat, memory, reflex, approval, automation, triage, channels, ask-user) used by both tracks.
- **Deep Reason** — spawns a focused sub-agent for complex multi-source trade-offs, competing constraints, and novel situations; has read-only tool access (no influence commands)
- **Habitat** — the core home model. Wires together:
  - **SpaceRegistry** — in-memory registry of spaces and their sources
  - **PropertyEngine** — routes observe/influence/query commands to the correct adapter
  - **ConfigStore** — SQLite persistence for spaces, sources, property mappings, adapter configs, and cached state
  - **SecretStore** — AES-256-GCM encrypted storage for adapter credentials
  - **AdapterSupervisor** — manages adapter process lifecycle: spawn, health ping, crash detection, exponential backoff restart
- **ChannelManager** — routes inbound messages from channel providers (web, Slack, Telegram, WhatsApp) to the correct ChatCoordinator. Manages channel routes for directing events to specific destinations.
- **AutomationStore** / **AutomationMatcher** — persistence and event matching for automations. Matcher debounces at 60s per automation and claims events before triage.
- **GoalStore** — tracks long-term objectives with timelines, status, and attention flags
- **PeopleStore** — household member registry with channel links, sender ID resolution, and properties
- **MemoryStore** — SQLite-backed persistence with local embedding vectors (all-MiniLM-L6-v2 via `@huggingface/transformers`) for semantic search
- **ReflexEngine** — evaluates local automation rules on habitat events; supports automation-linked reflexes
- **ApprovalQueue** — routes agent actions by confidence/category, auto-executes safe ones
- **OutcomeObserver** — detects user reversals within a 5-minute observation window
- **ProactiveScheduler** — periodic wakeups for reflection, goal review, etc.; fires time-triggered automations on a 30s tick
- **HistoryStore** — time-series storage for source state changes, supports charting and trend queries
- **PluginManager** — discovers and manages adapters in `adapters/` (built-in) and `~/.holms/adapters/` (user)
- **EventBus** — typed pub/sub connecting all subsystems

**Frontend** runs on port 5173 (Vite dev server, proxied to daemon). Panels: Overview, Activity, Chat, Goals, Automations, Spaces, Usage, Memory, Reflexes, Triage, Adapters, Channels, People.

## Getting started

### Quick install (Docker)

The fastest way to run Holms. Requires [Docker](https://docs.docker.com/get-docker/) and a Claude authentication method (subscription or API key).

```bash
curl -fsSL https://raw.githubusercontent.com/matthias-trip/holms/main/install.sh | bash
```

This will pull the latest image, set up a `~/.holms` directory with data persistence, and start Holms with automatic updates via [Watchtower](https://containrrr.dev/watchtower/). The dashboard will be at [http://localhost:3100](http://localhost:3100).

**Authentication:** The install script will try to generate an OAuth token automatically if you have the [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed. Otherwise, you can provide credentials upfront or configure them after install:

```bash
# Option A — Claude subscription: generate a long-lived OAuth token (1 year)
claude setup-token
# Then pass it to the installer:
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-... curl -fsSL .../install.sh | bash

# Option B — API key (from console.anthropic.com)
ANTHROPIC_API_KEY=sk-ant-api03-... curl -fsSL .../install.sh | bash

# Option C — Configure after install
# Edit ~/.holms/.env and add CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY
```

**Options:**

| Option | Description |
|--------|-------------|
| `HOLMS_DIR=/opt/holms` | Custom install directory (default: `~/.holms`) |
| `HOLMS_PORT=8080` | Custom port (default: `3100`) |
| `--no-auto-update` | Skip Watchtower auto-update sidecar |

```bash
# Custom port, custom directory, no auto-updates
HOLMS_DIR=/opt/holms HOLMS_PORT=8080 bash <(curl -fsSL https://raw.githubusercontent.com/matthias-trip/holms/main/install.sh) --no-auto-update
```

**Managing your installation:**

```bash
# View logs
docker compose -f ~/.holms/docker-compose.yml logs -f

# Stop
docker compose -f ~/.holms/docker-compose.yml down

# Update manually (if auto-updates are disabled)
docker compose -f ~/.holms/docker-compose.yml pull && docker compose -f ~/.holms/docker-compose.yml up -d
```

### Docker Compose (manual)

If you prefer to manage the compose file yourself, clone the repo and use the included `docker-compose.yml`:

```bash
git clone https://github.com/matthias-trip/holms.git
cd holms

# Add your credentials
echo "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-..." > .env
# or: echo "ANTHROPIC_API_KEY=sk-ant-api03-..." > .env

docker compose up -d
```

This uses the pre-built image from GHCR and includes a Watchtower sidecar for auto-updates. Edit `docker-compose.yml` to customize ports, volumes, or remove Watchtower.

### Development setup

For local development with hot-reloading.

**Prerequisites:**

- Node.js 20+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`claude` CLI)

The daemon uses the Claude Agent SDK, which runs Claude Code under the hood — no separate API key needed.

```bash
npm install

# Build adapters (separate from workspace — they have their own node_modules)
npm run build:adapters

# Configure (optional — defaults work out of the box)
cp packages/daemon/.env.example packages/daemon/.env

# Start both daemon and frontend
npm run dev
```

The dashboard will be at [http://localhost:5173](http://localhost:5173). On first launch with no adapters configured, the agent starts an onboarding flow to help you set up your first adapter and create spaces.

### Configuration

All config is via environment variables in `packages/daemon/.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `HOLMS_PORT` | `3100` | Daemon API port |
| `HOLMS_DB_PATH` | `./holms.db` | SQLite database path |
| `HOLMS_HF_CACHE_DIR` | `~/.holms/models` | HuggingFace model cache for embeddings |
| `HOLMS_CLAUDE_CONFIG_DIR` | `~/.claude` | Claude config directory |
| `HOLMS_ADAPTERS_DIR` | `~/.holms/adapters` | User adapter discovery directory |
| `HOLMS_MODEL_COORDINATOR` | `claude-sonnet-4-6` | Model for the main coordinator agent |
| `HOLMS_MODEL_DEEP_REASON` | `claude-opus-4-6` | Model for deep reasoning sub-agent |
| `HOLMS_MODEL_LIGHTWEIGHT` | `claude-haiku-4-5-20251001` | Model for lightweight tasks (feedback, reflection, goal review, daily summary) |
| `HOLMS_DEEP_REASON_MAX_TURNS` | `10` | Max tool-use turns for deep reasoning |

Agent behavior (batch delay, max turns, budget, proactive intervals) is configured in `packages/daemon/src/config.ts`.

## Writing an adapter

Adapters bridge external platforms into the Habitat. An adapter is a standalone Node.js package that implements the `Adapter` interface from `@holms/adapter-sdk`.

```
my-adapter/
├── adapter.json          # Manifest: type, entry, capabilities
├── package.json
├── src/
│   └── index.ts          # Entry: import { runAdapter } from "@holms/adapter-sdk"
└── skills/               # Optional: agent setup instructions
    └── my-setup/
        └── SKILL.md
```

The adapter needs to:

1. Export a factory function that creates an `Adapter` instance
2. Call `runAdapter(factory)` as the entry point — this handles all IPC
3. Register entities with property domain mappings (illumination, climate, etc.)
4. Push `state_changed` events when entity state changes
5. Respond to `observe` (read state) and `execute` (send commands) requests

Adapters can optionally support `discover` (find devices on the network) and `pair` (interactive pairing like Hue link-button). Set `multiInstance: true` in `adapter.json` if multiple instances are needed (e.g. one per bridge).

See `adapters/hue/` for a full implementation with discovery, pairing, and setup skills.

## Scripts

```bash
npm run dev              # Run daemon + frontend concurrently
npm run dev:daemon       # Daemon only
npm run dev:frontend     # Frontend only
npm run build            # Build all packages (shared → adapter-sdk → daemon → frontend)
npm run build:adapters   # Build all adapters (separate from workspace)
```

Per-package type checking:

```bash
npm run typecheck -w @holms/daemon
npm run typecheck -w @holms/frontend
npm run typecheck -w @holms/shared
```

## Tech stack

- **Agent**: [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk) with in-process MCP tool servers
- **Adapter IPC**: NDJSON over stdio (versioned protocol, process isolation)
- **API**: [tRPC v11](https://trpc.io/) over HTTP + WebSocket
- **Database**: SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **Frontend**: React 19, Vite 6, Tailwind CSS v4
- **Embeddings**: [all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) via `@huggingface/transformers` (runs locally)
- **Validation**: Zod v4
- **Language**: TypeScript (strict mode, ESM throughout)
