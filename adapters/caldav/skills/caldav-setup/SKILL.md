# CalDAV Setup Skill

Guide the user through connecting a CalDAV calendar server to Holms. Follow these steps in order, confirming with the user at each stage.

## Step 1 — Gather connection details

CalDAV doesn't support automatic discovery. Use `ask_user` to collect:

1. **Server URL** — the CalDAV endpoint. Use `ask_user` with common presets:
   - "Nextcloud" → `https://<host>/remote.php/dav`
   - "iCloud" → `https://caldav.icloud.com`
   - "Google" → `https://apidata.googleusercontent.com/caldav/v2`
   - "Other (I'll enter the URL)"

   If they pick a preset, use `ask_user` for the hostname/details. If "Other", ask for the full URL.

2. **Username** — use `ask_user` with a text prompt. For iCloud this is their Apple ID email. For Google, their Gmail address. Mention this in the description.

3. **Password** — use `ask_user` with a text prompt. **Important**: Warn the user that for iCloud and Google they need an **app-specific password**, not their regular password:
   - iCloud: Generate at appleid.apple.com → Security → App-Specific Passwords
   - Google: Generate at myaccount.google.com → Security → App Passwords (requires 2FA enabled)
   - Nextcloud: Regular password works, or they can use an app token from Settings → Security

4. **Calendar filter** (optional) — use `ask_user`: "Do you want to import all calendars, or only specific ones?" with options "All calendars" and "Only specific calendars". If specific, ask for calendar names (comma-separated).

## Step 2 — Configure and start adapter

Call `adapters_configure` to register the CalDAV adapter:

```
adapters_configure({
  id: "caldav-1",
  type: "caldav",
  displayName: "<descriptive name>",
  config: {
    server_url: "<url>",
    username: "<username>",
    password: "<password>",
    calendars: ["<name1>", "<name2>"],  // omit for all
    poll_interval_ms: 300000
  }
})
```

Choose a descriptive `displayName` based on the server type or account (e.g. "Nextcloud Calendar", "iCloud - Work", "Google Calendar"). Do not ask the user — pick a sensible name automatically.

If the adapter fails to start (check with `adapters_status({ adapterId: "caldav-1" })`):
- **401 Unauthorized**: Credentials are wrong. Use `ask_user` — "Authentication failed. Please check your username and password." with "Re-enter credentials" and "Cancel setup".
- **Connection refused / timeout**: URL is wrong or server is unreachable. Ask user to verify the URL and that the server is accessible from this network.
- **404 Not Found**: CalDAV endpoint path is wrong. Suggest common alternatives based on the server type.

## Step 3 — Discover calendars

Call `adapters_discover({ adapterId: "caldav-1" })` to see all calendars the server reported. Each calendar is registered as a `schedule` entity.

Present the calendars to the user:
- Calendar name
- Number of entities found

## Step 4 — Create spaces and assign

Use `ask_user` to ask where calendars should live. Calendars are typically space-independent (they're not tied to a physical room), so suggest options:

- "Create a dedicated 'Calendars' space" (Recommended)
- "Add to an existing space"
- "Create individual spaces per calendar"

For each calendar, assign it using `spaces_assign`:

```
spaces_assign({
  assignments: [{
    spaceId: "calendars",
    sourceId: "caldav-1-personal",
    adapterId: "caldav-1",
    entityId: "cal-personal",
    properties: [{
      property: "schedule",
      role: "calendar",
      features: ["events", "recurring", "create", "update", "delete"]
    }]
  }]
})
```

Use descriptive source IDs like `caldav-1-personal`, `caldav-1-work`, etc.

## Step 5 — Verify

Call `observe` on the new space to confirm the calendar state is flowing:
- `active`: whether an event is happening now
- `current_event`: the current event (if any)
- `next_event`: the next upcoming event
- `event_count`: total events today

Then call `query` to fetch this week's events:

```
query({
  space: "calendars",
  target: { property: "schedule" },
  params: {
    from: <now_epoch_ms>,
    to: <one_week_from_now_epoch_ms>
  }
})
```

Show the user a summary of upcoming events to confirm everything works.

Suggest the user try:
- Creating a test event via `influence` with `{ create_event: { summary: "Test from Holms", start: <epoch>, end: <epoch> } }`
- Checking their calendar app to verify the event appeared
- Deleting the test event afterward

## Step 6 — Explain capabilities

Let the user know what they can now do:
- **Ask about schedule**: "What's on my calendar today?" / "Am I free Friday afternoon?"
- **Create events**: "Schedule a dentist appointment next Tuesday at 2pm"
- **Automations**: "Turn on the office light 5 minutes before my next meeting"
- The calendar polls every 5 minutes by default — changes made in other apps will be picked up

## Troubleshooting

- **Missing calendars**: Some CalDAV servers use different paths for shared/delegated calendars. Check the server docs for the correct principal URL.
- **Recurring events not expanding**: The adapter expands recurrences within the queried time range. Very long recurrence rules (infinite repeat) are capped at the query window.
- **Slow polling**: Adjust `poll_interval_ms` in the adapter config. Lower values (60000 = 1 min) mean faster updates but more server load.
- **Multiple accounts**: Run the full flow again with a different adapter ID (e.g. `"caldav-2"`).
- **Self-signed certificates**: If the CalDAV server uses a self-signed cert, the adapter may reject the connection. The user needs to add the CA to the system trust store.
