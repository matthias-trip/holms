# PirateWeather Setup Skill

Guide the user through connecting PirateWeather to Holms for weather forecasts. Follow these steps in order, confirming with the user at each stage.

## Step 1 — Get API key

Ask the user for their PirateWeather API key.

If they don't have one, explain:
- Go to https://pirateweather.net and sign up for a free account
- Navigate to the API section and generate a key
- The free tier provides generous daily request limits

## Step 2 — Get location

Ask the user for their location. Accept either:
- **Coordinates** — latitude and longitude directly (e.g. "52.37, 4.89")
- **Place name** — use your reasoning to approximate coordinates (e.g. "Amsterdam" → 52.37, 4.89)

If the user gives a place name, tell them the coordinates you'll use and confirm before proceeding. Also ask for a display name (e.g. "Home", "Office") — default to the place name if not specified.

## Step 3 — Get units

Use `ask_user` to let the user pick their preferred unit system:

- **SI** (°C, m/s, hPa, km) — recommended for most of the world
- **US** (°F, mph, mb, mi)
- **CA** (°C, km/h, hPa, km)
- **UK** (°C, mph, hPa, km)

Default to SI if they don't have a preference.

## Step 4 — Configure adapter

Call `adapters_configure` to register the PirateWeather adapter:

```
adapters_configure({
  id: "pirate-weather-1",
  type: "pirate-weather",
  displayName: "Weather - <location_name>",
  config: {
    api_key: "<key>",
    latitude: <lat>,
    longitude: <lon>,
    units: "<units>",
    location_name: "<name>"
  }
})
```

For additional locations, increment the ID: `pirate-weather-2`, `pirate-weather-3`, etc.

## Step 5 — Discover entities

Call `adapters_discover({ adapterId: "pirate-weather-1" })` to see the weather entity that was registered.

## Step 6 — Assign to space

Use `ask_user` to determine where the weather source belongs:
- Add to an existing space (e.g. "Home") — most common
- Create a new space for it

Assign the entity with:
- Role: `"forecast_provider"`
- Features: `["current", "hourly_forecast", "daily_forecast"]`

## Step 7 — Verify

Call `observe` on the weather entity to show the user current conditions. Then call `query` with `{ granularity: "daily" }` to show the 7-day forecast. Present the results in a readable format.

## Troubleshooting

- **401 errors**: The API key is invalid or expired — double-check the key at pirateweather.net
- **No data returned**: The coordinates may be in the ocean or an unsupported region — verify the location
- **Multiple locations**: Run this flow again with a different adapter ID (e.g. `pirate-weather-2`) to add weather for another location
