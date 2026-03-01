---
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
description: Scaffold a new Habitat adapter plugin with guided property mapping
---

# New Habitat Adapter Plugin: $ARGUMENTS

You are creating a new Habitat adapter plugin called **$ARGUMENTS**. This generates a standalone plugin that the daemon discovers at runtime via its `adapter.json` manifest. Adapters run as isolated child processes communicating via NDJSON over stdio using the `@holms/adapter-sdk` harness.

## Step 1 — Gather Requirements

Use `AskUserQuestion` to ask the user:

1. **What system does this adapter connect to?** (e.g., Philips Hue bridge, MQTT broker, Zigbee2MQTT, custom HTTP API, etc.)
2. **Which property domains will entities from this adapter use?** Present the available domains with brief descriptions:
   - `illumination` — Lights (on/off, brightness, color_temp, color). Features: dimmable, color_temp, color, effect. Roles: primary, ambient, accent, task, night_light
   - `climate` — HVAC & thermostats (current_temp, target_temp, humidity, mode). Features: heating, cooling, fan, humidity_sensing, thermostat. Roles: primary, supplementary, sensor
   - `occupancy` — Motion & presence sensors (occupied, count, last_motion). Features: motion, presence, count, face_recognition. Roles: detector, camera, pressure_mat. **Read-only: no command fields.**
   - `access` — Locks, doors, covers (locked, open, position). Features: lock, contact, cover, tilt. Roles: door, window, gate, blind, curtain
   - `media` — Speakers & TVs (playing, volume, muted, source, title). Features: playback, volume, source_select, grouping. Roles: speaker, tv, receiver, soundbar
   - `power` — Plugs & switches (on, watts, kwh, voltage, current). Features: switch, power_monitoring, energy_tracking. Roles: outlet, switch, meter, circuit
   - `water` — Flow, leak & valve (flow_rate, leak_detected, valve_open). Features: flow_sensing, leak_detection, valve_control, temp_sensing. Roles: main_valve, irrigation, sensor, heater
   - `safety` — Smoke, CO, alarms (triggered, smoke_detected, co_detected, battery_level). Features: smoke, co, heat, siren, battery_monitoring. Roles: smoke_detector, co_detector, siren, combined
   - `air_quality` — Air sensors & purifiers (co2, pm25, voc, aqi, fan_on). Features: co2_sensing, pm_sensing, voc_sensing, purification. Roles: sensor, purifier, ventilation
   - `schedule` — Calendars & events (current_event, next_event, event_count). Features: events, recurring, reminders, create, update, delete. Roles: calendar, booking, availability. **Queryable: supports time-range queries for event items.**
3. **Does this adapter need configuration?** (e.g., host/IP, API key, port, polling interval)
4. **Does this adapter need a setup flow?** Adapters can optionally declare `discover` and/or `pair` capabilities for guided onboarding:
   - **`discover`** — The adapter can scan the network for gateways/hubs/bridges (e.g., mDNS, SSDP, HTTP scan). Returns a list of `{ id, name, address }` gateways.
   - **`pair`** — The adapter can pair with a discovered gateway to obtain credentials (e.g., press-button auth, OAuth flow, API key generation). Returns `{ success, credentials }`.
   - **Neither** — The user provides all config manually (host, API key, etc.)
5. **Does this adapter serve queryable collection data?** (e.g., calendar events, forecast items). If so, which property domains are queryable? The `schedule` domain is queryable by default. Queryable properties support the optional `query()` method that returns paginated item lists for a given parameter range.
6. **Should this be a builtin adapter (`adapters/<name>/`) or a user adapter (`~/.holms/adapters/<name>/`)?** Default: builtin.

## Step 2 — Read Reference Files

Read these files to ensure you have current interface definitions:

- `packages/adapter-sdk/src/types.ts` — Canonical `Adapter`, `AdapterFactory`, `EntityRegistration`, `RegistrationResult`, `DiscoverResult`, `PairResult`, `QueryResult`, `EntityGroup`, and `PropertyName` types
- `packages/adapter-sdk/src/harness.ts` — The `runAdapter()` harness that adapters call as their entry point
- `packages/adapter-sdk/src/protocol.ts` — NDJSON protocol messages between daemon and adapter process
- `adapters/hue/adapter/index.ts` — Reference implementation to model yours after
- `packages/daemon/src/habitat/types.ts` — Habitat types for context

Also read the property domain files for each domain the user selected:
- `packages/daemon/src/habitat/properties/<domain>.ts` (e.g., `illumination.ts`, `climate.ts`)

## Step 3 — Generate Plugin Structure

Determine the target directory based on the user's choice (default: `adapters/<name>/`).

Create these files:

### `<plugin-dir>/.claude-plugin/plugin.json`

```json
{
  "name": "<name>",
  "version": "0.1.0",
  "description": "Habitat adapter for <system description>"
}
```

### `<plugin-dir>/adapter.json`

The manifest tells the daemon how to load and onboard this adapter.

```json
{
  "type": "<name>",
  "entry": "dist/index.js",
  "multiInstance": false
}
```

If the adapter supports setup (discover/pair), add the `setup` field:

```json
{
  "type": "<name>",
  "entry": "dist/index.js",
  "multiInstance": true,
  "setup": {
    "discover": { "description": "Discover <system> gateways on the local network" },
    "pair": { "description": "Pair with a <system> gateway to obtain API credentials" }
  }
}
```

Only include `discover` and/or `pair` keys that the adapter actually implements. Set `multiInstance: true` if multiple gateways/hubs can coexist.

### `<plugin-dir>/package.json`

```json
{
  "name": "holms-adapter-<name>",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@holms/adapter-sdk": "file:../../packages/adapter-sdk"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.5.0"
  }
}
```

Add any external dependencies needed to communicate with the target system (HTTP clients, mDNS, etc.).

### `<plugin-dir>/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "adapter",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["adapter"]
}
```

Note: source files go in the `adapter/` directory (not `src/`).

### `<plugin-dir>/adapter/types.ts`

Define adapter-specific config and API types here. At minimum:

```typescript
export interface <PascalName>AdapterConfig {
  // Fields from the user's configuration answers
  // e.g., host: string; api_key: string;
}
```

### `<plugin-dir>/adapter/index.ts`

Generate an adapter class named `<PascalName>Adapter` that implements the `Adapter` interface from `@holms/adapter-sdk`.

**Imports — use the SDK package, not local copies:**

```typescript
import {
  runAdapter,
  type Adapter,
  type AdapterFactory,
  type EntityRegistration,
  type RegistrationResult,
  type PropertyName,
  // Include if the adapter has queryable domains:
  type QueryResult,
  // Include these only if the adapter supports setup:
  type DiscoverResult,
  type PairResult,
  // Include if the adapter registers groups:
  type EntityGroup,
} from "@holms/adapter-sdk";
```

**Constructor pattern — support onboarding mode:**

If the adapter declares `discover` or `pair` in `adapter.json`, the daemon may start the adapter process with empty/partial config for onboarding. The constructor must handle this gracefully:

```typescript
constructor(config: Record<string, unknown>) {
  const cfg = config as unknown as MyAdapterConfig;
  if (!cfg.host || !cfg.api_key) {
    // Onboarding mode — only discover/pair available
    this.configured = false;
    return;
  }
  this.configured = true;
  // Initialize client connections
}
```

**Required methods:**

1. **`register(): Promise<RegistrationResult>`** — Connect to the external system, discover entities, return `{ entities, groups? }`. Each entity has an `entityId`, optional `displayName`, and array of `{ property, features }`. Return `{ entities: [] }` if not configured.
2. **`execute(entityId, property, command): Promise<void>`** — Translate Habitat commands to the external system's API.
3. **`observe(entityId, property): Promise<Record<string, unknown>>`** — Read current state from the external system.
4. **`subscribe(cb): Promise<void>`** — Set up real-time (SSE, WebSocket, polling) state change notifications. Call `cb(entityId, property, state)` on changes. No-op if not configured.
5. **`ping(): Promise<boolean>`** — Check if the external connection is alive. Return `true` in onboarding mode.
6. **`destroy(): Promise<void>`** — Close connections, clear intervals/listeners.

**Optional setup methods (only if declared in adapter.json):**

7. **`discover(params): Promise<DiscoverResult>`** — Scan the network for gateways. Return `{ gateways: [{ id, name, address }], message? }`.
8. **`pair(params): Promise<PairResult>`** — Pair with a gateway at `params.address`. Return `{ success: true, credentials: { ... } }` or `{ success: false, error: "..." }`. The credentials object is saved by the daemon and passed back as config on future launches.

**Optional query method (for queryable domains like `schedule`):**

9. **`query(entityId, property, params): Promise<QueryResult>`** — Query collection data for the given entity/property. Params are domain-specific (e.g., `{ from, to }` for schedule). Return `{ items: [...], total?, truncated? }`. Only implement if the adapter has queryable property domains.

**Entity registration — include `displayName` for human-readable labels:**

```typescript
const entities: EntityRegistration[] = [
  {
    entityId: "living-room-light",
    displayName: "Living Room Light",
    properties: [
      { property: "illumination", features: ["dimmable", "color_temp"] },
    ],
  },
];
```

**Entry point — the file must end with:**

```typescript
const create<PascalName>Adapter: AdapterFactory = (config) => new <PascalName>Adapter(config);
export default create<PascalName>Adapter;

// Standalone process entry point — when run by the daemon, start the SDK harness
runAdapter(create<PascalName>Adapter);
```

The `runAdapter()` call is what makes the adapter work as a child process. It reads NDJSON from stdin, dispatches to the adapter methods, and writes results to stdout. This is the entire process lifecycle — no HTTP server needed.

### State/Command Field Reference

When implementing `observe()` and `execute()`, use these field schemas for each selected domain:

**illumination** — State: `{ on: boolean, brightness: number(0-100), color_temp: number(153-500), color: {h,s} }`. Commands: same + `transition: number(seconds)`
**climate** — State: `{ current_temp: number, target_temp: number, humidity: number(0-100), mode: string, fan_mode: string }`. Commands: `{ target_temp, mode, fan_mode }`
**occupancy** — State: `{ occupied: boolean, count: number, last_motion: number(timestamp) }`. Commands: none (read-only)
**access** — State: `{ locked: boolean, open: boolean, position: number(0-100) }`. Commands: `{ locked, open, position }`
**media** — State: `{ playing: boolean, volume: number(0-100), muted: boolean, source: string, title: string, artist: string }`. Commands: `{ playing, volume, muted, source }`
**power** — State: `{ on: boolean, watts: number, kwh: number, voltage: number, current: number }`. Commands: `{ on }`
**water** — State: `{ flow_rate: number, total_consumption: number, leak_detected: boolean, valve_open: boolean, temperature: number }`. Commands: `{ valve_open }`
**safety** — State: `{ triggered: boolean, smoke_detected: boolean, co_detected: boolean, battery_level: number(0-100) }`. Commands: `{ silence, test }`
**air_quality** — State: `{ co2: number, pm25: number, pm10: number, voc: number, aqi: number, fan_on: boolean, fan_speed: number(0-100) }`. Commands: `{ fan_on, fan_speed, mode: string }`
**schedule** — State: `{ active: boolean, current_event: object, next_event: object, event_count: number }`. Commands: `{ create_event: object, update_event: object, delete_event: object }`. **Queryable**: params `{ from: number, to: number }` (epoch ms), returns items `{ uid, summary, description, location, start, end, all_day, recurring }`.

## Step 4 — Generate Setup Skill

**Skip this step if the adapter does NOT declare `discover` or `pair`.**

If the adapter supports guided onboarding (discover and/or pair), generate a setup skill at `<plugin-dir>/skills/<name>-setup/SKILL.md`. This skill is what the agent uses to walk users through connecting the adapter to their system.

Read `adapters/hue/skills/hue-setup/SKILL.md` as a reference for structure and tone.

The generated skill should follow this structure:

```markdown
# <PascalName> Setup Skill

Guide the user through connecting a <system description> to Holms. Follow these steps in order, confirming with the user at each stage.

## Step 1 — Discover <gateways/hubs/bridges>

Call `adapters_discover_gateways({ type: "<name>" })` to scan the local network for <system> <gateways>.

- If <gateways> are found, use `ask_user` to let the user pick which one to pair with (one option per discovered <gateway>, showing IP and name).
- If none found, ask in a **normal message** (not `ask_user` — the answer is open-ended) whether they know the <gateway> IP/address. Mention common causes:
  - <System-specific networking issues, e.g., VLAN isolation, firewall ports>
  - <Gateway> is powered off or disconnected
  - <Any system-specific discovery prerequisites>

### IP/address validation
If the user provides an address manually, sanity-check it before proceeding. If it looks malformed, use `ask_user` to confirm the corrected version. Don't silently pass a bad address to `adapters_pair`.

## Step 2 — Pair with <gateway>

**Do NOT call `adapters_pair` until the user confirms they are ready.** Use `ask_user` to gate this:

1. Tell the user what they need to do to authorize pairing (e.g., press a button, approve in an app, etc.).
2. Use `ask_user` with options like "I'm ready" and "Cancel setup". Wait for their response.
3. Only after they confirm, call `adapters_pair({ type: "<name>", address: "<address>" })`.

- If successful: store the returned credentials for the next step.
- If pairing fails: use `ask_user` to offer retry or cancel. Include the error message.
- If connection refused: verify the address and suggest the user check connectivity.

## Step 3 — Configure adapter

Call `adapters_configure` to register the adapter:

adapters_configure({
  id: "<name>-1",
  type: "<name>",
  displayName: "<descriptive name>",
  config: { <config fields from pairing credentials> }
})

The setup skill should instruct the agent to choose a descriptive `displayName` automatically from context (bridge name, device name, server type, address, etc.) — not ask the user.

The adapter will start, connect to the system, and register all discovered entities.

## Step 4 — Discover entities

Call `adapters_discover({ adapterId: "<name>-1" })` to see all entities reported. Present the entities grouped by <natural grouping> (rooms, zones, etc.). For each group, show:
- Group name
- Devices and their types
- Properties and features

## Step 5 — Create spaces

Use `ask_user` to let the user pick which groups to import (multi-select). Don't assume all groups should be imported.

For each selected group, create a space and assign sources:

1. Create the space if it doesn't exist (the user may already have spaces from other adapters)
2. Use `spaces_assign` for each entity, choosing appropriate:
   - `sourceId`: descriptive slug like `"living-room-<device-type>"`
   - `role`: based on the device type and purpose
   - `mounting`: based on the physical installation type
   - `features`: copy from the discovered entity properties

## Step 6 — Verify

Call `observe` on one or two of the new spaces to confirm state is flowing correctly. Show the user the live state.

Suggest the user try:
- Controlling a device via `influence` to verify commands work
- Physically changing a device to verify real-time events arrive

## Troubleshooting

- **<Common failure mode 1>**: <Diagnosis and fix>
- **<Common failure mode 2>**: <Diagnosis and fix>
- **Multiple <gateways>**: Run the full flow again with a different adapter ID (e.g. `"<name>-2"`).
- **<System-specific issue>**: <Resolution>
```

Fill in all `<placeholders>` with the adapter's specific details:
- System name and description
- Gateway/hub/bridge terminology for this system
- Config fields returned by pairing
- Property domains and entity types
- Pairing mechanism (button press, app approval, API key entry, OAuth, etc.)
- Common failure modes and troubleshooting specific to the target system
- Natural entity grouping (rooms, zones, areas, etc.)

## Step 5 — Build the Plugin

Run:

```bash
cd <plugin-dir> && npm install && npm run build
```

Fix any type errors before continuing.

## Step 6 — Verify Factory Resolves

Run a quick check that the compiled output exists and exports a default function:

```bash
node -e "import('<absolute-path-to-plugin-dir>/dist/index.js').then(m => { if (typeof m.default !== 'function') throw new Error('No default factory export'); console.log('Factory OK'); })"
```

## Step 7 — Summary

Report what was created:
- The plugin directory path
- Which property domains it supports (and which are queryable)
- What configuration it expects
- Whether it has a setup flow (discover/pair) and what each step does
- Whether a setup skill was generated (and its path)
- That it will be auto-discovered by the daemon on next restart (via `adapter.json`)
- Any TODO items the user needs to implement (e.g., actual API client code if scaffolded with placeholder logic)
