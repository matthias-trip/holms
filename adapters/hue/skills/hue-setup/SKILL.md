# Hue Setup Skill

Guide the user through connecting a Philips Hue bridge to Holms. Follow these steps in order, confirming with the user at each stage.

## Step 1 — Discover bridges

Call `adapters_discover_gateways({ type: "hue" })` to scan the local network for Hue bridges.

- If bridges are found, use `ask_user` to let the user pick which bridge to pair with (one option per discovered bridge, showing IP and name).
- If no bridges found, ask in a **normal message** (not `ask_user` — the answer is open-ended) whether they know the bridge IP. Mention common causes:
  - Bridge and daemon on different VLANs (mDNS doesn't cross VLANs by default)
  - Bridge is powered off or disconnected
  - Firewall blocking mDNS (port 5353 UDP)

### IP validation
If the user provides an IP address manually, sanity-check it before proceeding. If it looks malformed (e.g., leading zeros like `10.40.0.01`, too many octets, non-numeric characters), use `ask_user` to confirm: _"Did you mean 10.40.0.1?"_ with options for the corrected IP and "Enter a different IP". Don't silently pass a bad IP to `adapters_pair`.

## Step 2 — Pair with bridge

**Do NOT call `adapters_pair` until the user confirms they've pressed the button.** Use `ask_user` to gate this:

1. Tell the user to press the link button on top of their Hue bridge.
2. Use `ask_user` with options like "I've pressed the button" and "Cancel setup". Wait for their response.
3. Only after they confirm, call `adapters_pair({ type: "hue", address: "<bridge_ip>" })`.

- If successful: you'll receive credentials (api_key and bridge_ip). Store them — you'll need them in the next step.
- If "link button not pressed" error: use `ask_user` again — "The bridge didn't register a button press. Try pressing the button and let me know when you're ready." with "I've pressed it again" and "Cancel".
- If connection refused: verify the IP is correct and the bridge is reachable. Use `ask_user` to confirm the IP or let them re-enter it.

## Step 3 — Configure adapter

Call `adapters_configure` to register the Hue adapter:

```
adapters_configure({
  id: "hue-1",
  type: "hue",
  displayName: "<descriptive name>",
  config: { bridge_ip: "<ip>", api_key: "<key>" }
})
```

Choose a descriptive `displayName` based on the bridge name or location discovered during pairing (e.g. "Hue Bridge - Living Room", "Hue Bridge - Outdoor"). Do not ask the user — pick a sensible name automatically.

The adapter will start, connect to the bridge, and register all discovered entities.

## Step 4 — Discover entities

Call `adapters_discover({ adapterId: "hue-1" })` to see all entities the bridge reported. The response includes entity IDs and their properties (illumination, occupancy, climate, access, power).

Present the entities to the user grouped by Hue room (entities include room hints from the bridge). For each room, show:
- Room name
- Devices and their types (lights, sensors, plugs)
- Properties and features

## Step 5 — Create spaces

Use `ask_user` to let the user pick which rooms to import (multi-select with one option per room). Don't assume all rooms should be imported.

For each selected room, create a space and assign sources:

1. Create the space if it doesn't exist (the user may already have spaces from other adapters)
2. Use `spaces_assign` for each entity, choosing appropriate:
   - `sourceId`: descriptive slug like `"living-room-ceiling-light"`
   - `role`: `"primary"`, `"ambient"`, `"accent"`, `"sensor"` based on the light/sensor type
   - `mounting`: `"ceiling"`, `"wall"`, `"floor"`, `"desk"`, `"strip"` based on the product archetype
   - `features`: copy from the discovered entity properties

## Step 6 — Verify

Call `observe` on one or two of the new spaces to confirm state is flowing correctly. Show the user the live state of their lights/sensors.

Suggest the user try:
- Toggling a light via `influence` to verify control works
- Physically changing a light to verify SSE events arrive

## Troubleshooting

- **Stale API key**: If commands fail with auth errors after initial setup works, the API key may have been revoked. Re-pair with `adapters_pair({ type: "hue", address: "<bridge_ip>" })`.
- **Entities missing**: Some Hue accessories (like the Tap Dial) only have button services which aren't mapped. This is expected.
- **Multiple bridges**: Run the full flow again with a different adapter ID (e.g. `"hue-2"`).
- **Bridge firmware**: Hue V2 API requires bridge firmware ≥ 1948086000. If API calls fail, suggest updating the bridge via the Hue app.
