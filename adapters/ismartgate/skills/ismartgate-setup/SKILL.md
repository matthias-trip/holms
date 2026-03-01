# iSmartGate Setup Skill

Guide the user through connecting an iSmartGate garage door/gate controller to Holms. Follow these steps in order, confirming with the user at each stage.

## Step 1 — Connection details

Use `ask_user` to request the iSmartGate device's connection details:

1. **IP address or hostname** — Found on the device's LCD screen or in the iSmartGate app under Settings > Network.
2. **Username** — The admin username configured on the device (default: `admin`).
3. **Password** — The password for that user.

There is no automatic discovery — iSmartGate devices don't broadcast via mDNS. The user must provide the IP manually.

### IP validation
If the IP looks malformed (leading zeros, too many octets, non-numeric), use `ask_user` to confirm: _"Did you mean 192.168.1.10?"_ with options for the corrected IP and "Enter different details".

## Step 2 — Configure adapter

Call `adapters_configure` to register the adapter:

```
adapters_configure({
  id: "ismartgate-1",
  type: "ismartgate",
  displayName: "<descriptive name>",
  config: { host: "<ip>", username: "<user>", password: "<pass>" }
})
```

Choose a descriptive `displayName` based on the device or door names (e.g. "iSmartGate - Garage", "iSmartGate - Front Gate"). Do not ask the user — pick a sensible name automatically.

- If it connects successfully, proceed to Step 3.
- If connection fails (wrong IP, bad credentials, device unreachable), tell the user what went wrong and use `ask_user` to let them re-enter details or cancel.

## Step 3 — Discover entities

Call `adapters_discover({ adapterId: "ismartgate-1" })` to see discovered doors.

Present the doors to the user, showing for each:
- Door name (as configured in the iSmartGate app)
- Whether it has a sensor installed
- Current status (open/closed)
- Temperature reading (if sensor supports it)

Doors without sensors will show status "undefined" — explain this is normal and means no sensor is installed or configured for that door slot in the iSmartGate app.

## Step 4 — Create spaces

Use `ask_user` to let the user pick which doors to import and where to assign them (multi-select). For each selected door:

1. Create a space if needed (e.g., "Garage", "Driveway Gate")
2. Use `spaces_assign` with:
   - `property: "access"`, `features: ["cover"]`
   - `role: "gate"` if the door is configured as a gate in iSmartGate, otherwise `role: "door"`
3. If the door has temperature data, also assign with `property: "climate"`

## Step 5 — Verify

Call `observe` on one of the new spaces to confirm door state is flowing correctly. Show the user the live state.

Suggest they try:
- Toggling a door via `influence` to verify control works (warn them: this will physically open/close the door!)
- Physically opening/closing a door to verify status updates arrive

## Troubleshooting

- **Wrong credentials**: The iSmartGate device returns encrypted garbage if credentials are wrong. Re-enter username and password.
- **Device unreachable**: Check the IP address is correct and the device is on the same network/VLAN as the Holms server.
- **Doors showing "undefined"**: No sensor installed or configured for that door slot. The user needs to install a sensor and configure it in the iSmartGate app.
- **Multiple devices**: Run the full setup again with a different adapter ID (e.g., `"ismartgate-2"`).
- **Slow response**: iSmartGate devices can be slow to respond (~2-5s). The adapter uses a 20s timeout.
