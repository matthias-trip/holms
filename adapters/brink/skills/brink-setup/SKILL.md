# Brink Ventilation Setup Skill

Guide the user through connecting their Brink whole-house ventilation system to Holms via the Brink Home cloud portal. Follow these steps in order.

## Step 1 — Collect credentials

Ask the user for their Brink Home portal credentials in a **normal message** (not `ask_user` — the answer is open-ended):

> "To connect your Brink ventilation, I need your Brink Home portal credentials (the email and password you use at brink-home.com). Please share them and I'll authenticate with the portal."

If the user doesn't have an account, direct them to register at `www.brink-home.com` first and link their ventilation unit via the Brink Home app.

## Step 2 — Pair

Call `adapters_pair({ type: "brink", username: "<email>", password: "<password>" })`.

- **Success (single system)**: Store the returned credentials (username, password, systemId, gatewayId) and the system name. Proceed to step 3.
- **Success (multiple systems)**: The response message lists all systems. Use `ask_user` to let the user pick which system to connect (one option per system, showing system name and IDs).
- **Login failure**: Tell the user the credentials were rejected. Suggest they verify by logging into brink-home.com directly. Ask them to try again.
- **No systems found**: The account has no linked ventilation units. Direct them to the Brink Home app to register their unit.

## Step 3 — Configure adapter

Call `adapters_configure` to register the Brink adapter:

```
adapters_configure({
  id: "brink-1",
  type: "brink",
  displayName: "<system name from pairing>",
  config: {
    username: "<email>",
    password: "<password>",
    systemId: <id>,
    gatewayId: <id>
  }
})
```

Use the system name returned during pairing as the `displayName` (e.g. "Brink Flair 300"). Don't ask the user — pick it automatically.

## Step 4 — Discover entities

Call `adapters_discover({ adapterId: "brink-1" })` to list registered ventilation entities. You should see one entity with an `air_quality` property and `purification` feature.

## Step 5 — Create space

Use `ask_user` to ask the user which room or area the ventilation serves (e.g. "Whole house", "Utility room", "Attic"). Create the space and assign the ventilation entity as a source:

- `role`: `"primary"`
- `mounting`: `"wall"`
- `features`: `["purification"]`

## Step 6 — Verify

Call `observe` on the new space to confirm state is flowing. Show the user:
- Current fan speed and whether the fan is on
- Operating mode (auto/manual/holiday/party/night)
- Filter alarm status
- Bypass valve state

Suggest the user try changing the fan speed via `influence` to verify control works. For example:

> "Want me to set the fan to medium speed (50%) to verify control? I'll change it back right after."

## Troubleshooting

- **Session expired**: The Brink portal session may expire. The adapter auto-re-authenticates on 401, but if persistent failures occur, re-run `adapters_pair` to verify credentials still work.
- **Parameters not found**: The adapter matches Brink parameters by German description text (Lüftungsstufe, Betriebsart, etc.). If the user's unit uses different firmware with different labels, the adapter may not find all parameters. Report which ones are missing so we can add the alternate keywords.
- **Slow updates**: The adapter polls every 60 seconds by default. Changes made via the Brink Home app may take up to a minute to appear.
- **Rate limiting**: The Brink portal may rate-limit requests. The minimum poll interval is 30 seconds. If errors occur, increase `pollInterval` in the adapter config.
