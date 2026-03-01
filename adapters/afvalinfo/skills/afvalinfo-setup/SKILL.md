# Afvalinfo Setup Skill

Guide the user through connecting their Dutch waste collection calendar to Holms. Follow these steps in order, confirming with the user at each stage.

## Step 1 — Ask address

Use `ask_user` to ask for the user's zip code (postcode) and house number. Mention this covers nearly all Dutch municipalities. If they have a house number suffix (toevoeging), ask for that too.

Example prompt: "What is your Dutch zip code and house number? (e.g., 1234AB, 10). If you have a suffix (toevoeging), include that too."

## Step 2 — Discover

Call `adapters_discover_gateways({ type: "afvalinfo", params: { zipcode: "<zipcode>", house_number: "<number>", house_number_suffix: "<suffix>" } })` to verify the address works with TrashAPI.

- If gateways are found: confirm the address and waste types with the user.
- If no results: ask the user to double-check the zip code and house number. Common issues:
  - Zip code format should be "1234AB" (no space)
  - Some new-build addresses take time to appear in municipal systems
  - A few municipalities use different collection systems not covered by TrashAPI

## Step 3 — Configure adapter

Call `adapters_configure` to register the adapter:

```
adapters_configure({
  id: "afvalinfo-1",
  type: "afvalinfo",
  displayName: "<descriptive name>",
  config: { zipcode: "<zipcode>", house_number: "<number>", house_number_suffix: "<suffix if any>" }
})
```

Choose a descriptive `displayName` based on the address (e.g. "Afvalinfo - 1234AB"). Do not ask the user — pick a sensible name automatically.

## Step 4 — Discover entities

Call `adapters_discover({ adapterId: "afvalinfo-1" })` to see all waste types found.

Present them to the user, for example:
- GFT (Organic) — green bin / food & garden waste
- Papier (Paper) — paper and cardboard
- PMD (Plastic/Metal/Drink cartons) — plastic packaging
- Restafval (Residual) — general waste

## Step 5 — Create space

Create a "Waste Collection" space and assign each waste type as a source:

1. Create the space: `spaces_create({ name: "Waste Collection" })`
2. For each entity, assign it: `spaces_assign({ spaceId: "<space-id>", entityId: "<slug>", adapterId: "afvalinfo-1", sourceId: "<slug>", property: "schedule", role: "calendar", features: ["events", "recurring"] })`

## Step 6 — Verify

Query upcoming collections to confirm everything works. Call `observe` on the waste collection space or query a specific entity for events in the next 30 days.

Show the user their upcoming collection dates in a readable format, for example:
- "Tomorrow: Restafval (Residual)"
- "March 15: GFT (Organic)"
- "March 18: Papier (Paper)"

Suggest they check if the dates match their physical collection calendar or the app from their municipality.
