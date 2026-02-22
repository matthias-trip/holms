---
name: energy-optimization
description: >
  Energy optimization domain knowledge for smart home automation. Apply when
  making decisions about climate control, EV charging, water heating, solar
  self-consumption, battery storage, or any energy-related device scheduling.
  Also use when users ask about saving energy, reducing costs, or optimizing
  consumption patterns.
---

# Energy Optimization

## Core Concepts

- **Dynamic tariffs**: Electricity prices vary by hour. Flexible loads should
  run during cheap windows when possible.
- **Solar self-consumption**: Surplus solar production exported to grid earns
  less than retail price. Activate flexible loads during solar peaks instead.
- **Thermal inertia**: Buildings and water tanks store heat. Pre-heat during
  cheap/solar hours and coast through expensive ones — comfort impact is
  minimal over several hours.
- **Peak shaving**: Avoid running multiple high-power loads simultaneously.
  Stagger EV charging, heat pump, and boiler to stay under grid connection limits.

## Flexible Loads (by impact)

**EV charging** — largest deferrable load (7–22 kW). Can shift across hours as
long as the car is ready by departure time. Always check memory for the user's
departure preferences before scheduling.

**Heat pump / climate** — pre-heat during cheap or solar hours. Thermal mass of
the building provides a buffer of several hours. Respect temperature preferences
from memory. Consider outdoor temperature: colder weather = shorter coast time.

**Water heater / boiler** — heat water during cheap or solar hours. The tank
acts as thermal storage. Ensure hot water is ready by the user's morning routine
(check memory for patterns).

**Battery storage** — if present, charge from solar surplus or cheap grid;
discharge during peak pricing. Battery has limited cycles — don't micro-cycle
for tiny price differences.

**Covers / blinds** — passive solar gain: open south-facing covers on sunny
winter days; close on hot summer days to reduce cooling load.

## Decision Framework

When making energy-related device decisions:

1. Consider timing — time of day, day of week, season
2. Check user constraints and comfort preferences from memory
3. Identify which loads are flexible and which time windows are favorable
4. Weigh savings against comfort impact — prefer comfort over marginal gains
5. For complex multi-load optimization across a full day, use `deep_reason`
   with all relevant device states, tariff context, and constraints

## What NOT to Do

- Don't optimize small loads (phone chargers, individual lights) — negligible impact
- Don't assume a device is flexible unless its type or a memory confirms it
- Don't override user comfort preferences for energy savings
- Don't make changes during sleep hours unless the user requested it
- Don't micro-optimize — a 2-cent saving isn't worth waking the user or
  creating multiple approval requests
