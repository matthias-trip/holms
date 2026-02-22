import type { CapabilityDescriptor } from "@holms/shared";

/**
 * Standard DAL capability catalog — provider-agnostic command vocabulary.
 * Every command name and param is explicitly chosen; providers map their
 * native concepts to/from this vocabulary via translateCommand() / normalizeState().
 */

const capabilities: Record<string, CapabilityDescriptor[]> = {
  light: [
    { name: "turn_on", description: "Turn the light on", params: [] },
    { name: "turn_off", description: "Turn the light off", params: [] },
    {
      name: "set_brightness",
      description: "Set brightness level",
      params: [
        { name: "brightness", type: "number", required: true, min: 0, max: 100, unit: "%", description: "Brightness percentage (0-100)" },
      ],
    },
    {
      name: "set_color_temp",
      description: "Set color temperature",
      params: [
        { name: "colorTemp", type: "number", required: true, min: 2000, max: 6500, unit: "K", description: "Color temperature in Kelvin (2000-6500)" },
      ],
    },
    {
      name: "set_color",
      description: "Set light color",
      params: [
        { name: "hue", type: "number", required: true, min: 0, max: 360, description: "Hue (0-360 degrees)" },
        { name: "saturation", type: "number", required: true, min: 0, max: 100, unit: "%", description: "Saturation percentage (0-100)" },
      ],
    },
  ],

  switch: [
    { name: "turn_on", description: "Turn on", params: [] },
    { name: "turn_off", description: "Turn off", params: [] },
  ],

  climate: [
    { name: "turn_on", description: "Turn on climate", params: [] },
    { name: "turn_off", description: "Turn off climate", params: [] },
    {
      name: "set_temperature",
      description: "Set target temperature",
      params: [
        { name: "temperature", type: "number", required: true, min: 5, max: 40, step: 0.5, unit: "°C", description: "Target temperature in Celsius" },
      ],
    },
    {
      name: "set_mode",
      description: "Set climate mode",
      params: [
        { name: "mode", type: "enum", required: true, options: ["auto", "heat", "cool", "off", "heat_cool", "dry", "fan_only"], description: "Climate mode" },
      ],
    },
    {
      name: "set_fan_mode",
      description: "Set fan mode",
      params: [
        { name: "fanMode", type: "enum", required: true, options: ["auto", "low", "medium", "high", "off"], description: "Fan mode" },
      ],
    },
    {
      name: "set_preset",
      description: "Set preset mode",
      params: [
        { name: "preset", type: "enum", required: true, options: ["away", "eco", "boost", "comfort", "home", "sleep", "activity"], description: "Preset mode" },
      ],
    },
  ],

  cover: [
    { name: "open", description: "Open the cover", params: [] },
    { name: "close", description: "Close the cover", params: [] },
    { name: "stop", description: "Stop the cover", params: [] },
    {
      name: "set_position",
      description: "Set cover position",
      params: [
        { name: "position", type: "number", required: true, min: 0, max: 100, unit: "%", description: "Position percentage (0=closed, 100=open)" },
      ],
    },
    {
      name: "set_tilt",
      description: "Set cover tilt position",
      params: [
        { name: "tilt", type: "number", required: true, min: 0, max: 100, unit: "%", description: "Tilt percentage (0-100)" },
      ],
    },
  ],

  lock: [
    { name: "lock", description: "Lock", params: [] },
    {
      name: "unlock",
      description: "Unlock",
      params: [
        { name: "code", type: "string", required: false, description: "Unlock code" },
      ],
    },
  ],

  fan: [
    { name: "turn_on", description: "Turn on the fan", params: [] },
    { name: "turn_off", description: "Turn off the fan", params: [] },
    {
      name: "set_speed",
      description: "Set fan speed",
      params: [
        { name: "speed", type: "number", required: true, min: 0, max: 100, unit: "%", description: "Speed percentage (0-100)" },
      ],
    },
    {
      name: "set_preset",
      description: "Set preset mode",
      params: [
        { name: "preset", type: "string", required: true, description: "Preset mode" },
      ],
    },
    {
      name: "set_direction",
      description: "Set fan direction",
      params: [
        { name: "direction", type: "enum", required: true, options: ["forward", "reverse"], description: "Fan direction" },
      ],
    },
    {
      name: "oscillate",
      description: "Toggle oscillation",
      params: [
        { name: "enabled", type: "boolean", required: true, description: "Enable or disable oscillation" },
      ],
    },
  ],

  media_player: [
    { name: "turn_on", description: "Turn on media player", params: [] },
    { name: "turn_off", description: "Turn off media player", params: [] },
    { name: "play", description: "Play", params: [] },
    { name: "pause", description: "Pause", params: [] },
    { name: "stop", description: "Stop", params: [] },
    { name: "next_track", description: "Next track", params: [] },
    { name: "previous_track", description: "Previous track", params: [] },
    {
      name: "set_volume",
      description: "Set volume",
      params: [
        { name: "volume", type: "number", required: true, min: 0, max: 100, unit: "%", description: "Volume percentage (0-100)" },
      ],
    },
    {
      name: "mute",
      description: "Mute or unmute",
      params: [
        { name: "muted", type: "boolean", required: true, description: "Mute state" },
      ],
    },
    {
      name: "set_source",
      description: "Select input source",
      params: [
        { name: "source", type: "string", required: true, description: "Source name" },
      ],
    },
    {
      name: "play_media",
      description: "Play specific media",
      params: [
        { name: "mediaType", type: "string", required: true, description: "Media content type" },
        { name: "mediaId", type: "string", required: true, description: "Media content ID" },
      ],
    },
  ],

  alarm_control_panel: [
    {
      name: "disarm",
      description: "Disarm the alarm",
      params: [
        { name: "code", type: "string", required: false, description: "Alarm code" },
      ],
    },
    {
      name: "arm_home",
      description: "Arm in home mode",
      params: [
        { name: "code", type: "string", required: false, description: "Alarm code" },
      ],
    },
    {
      name: "arm_away",
      description: "Arm in away mode",
      params: [
        { name: "code", type: "string", required: false, description: "Alarm code" },
      ],
    },
    {
      name: "arm_night",
      description: "Arm in night mode",
      params: [
        { name: "code", type: "string", required: false, description: "Alarm code" },
      ],
    },
    {
      name: "arm_vacation",
      description: "Arm in vacation mode",
      params: [
        { name: "code", type: "string", required: false, description: "Alarm code" },
      ],
    },
    { name: "trigger", description: "Trigger the alarm", params: [] },
  ],

  humidifier: [
    { name: "turn_on", description: "Turn on humidifier", params: [] },
    { name: "turn_off", description: "Turn off humidifier", params: [] },
    {
      name: "set_humidity",
      description: "Set target humidity",
      params: [
        { name: "humidity", type: "number", required: true, min: 0, max: 100, unit: "%", description: "Target humidity percentage (0-100)" },
      ],
    },
    {
      name: "set_mode",
      description: "Set humidifier mode",
      params: [
        { name: "mode", type: "string", required: true, description: "Humidifier mode" },
      ],
    },
  ],

  water_heater: [
    { name: "turn_on", description: "Turn on water heater", params: [] },
    { name: "turn_off", description: "Turn off water heater", params: [] },
    {
      name: "set_temperature",
      description: "Set target temperature",
      params: [
        { name: "temperature", type: "number", required: true, unit: "°C", description: "Target temperature in Celsius" },
      ],
    },
    {
      name: "set_mode",
      description: "Set operation mode",
      params: [
        { name: "mode", type: "string", required: true, description: "Operation mode" },
      ],
    },
    {
      name: "set_away",
      description: "Set away mode",
      params: [
        { name: "away", type: "boolean", required: true, description: "Enable or disable away mode" },
      ],
    },
  ],

  vacuum: [
    { name: "start", description: "Start vacuuming", params: [] },
    { name: "stop", description: "Stop vacuuming", params: [] },
    { name: "pause", description: "Pause vacuuming", params: [] },
    { name: "dock", description: "Return to dock", params: [] },
  ],

  lawn_mower: [
    { name: "start", description: "Start mowing", params: [] },
    { name: "pause", description: "Pause mowing", params: [] },
    { name: "dock", description: "Return to dock", params: [] },
  ],

  scene: [
    { name: "activate", description: "Activate scene", params: [] },
  ],

  button: [
    { name: "press", description: "Press the button", params: [] },
  ],

  siren: [
    {
      name: "turn_on",
      description: "Turn on siren",
      params: [
        { name: "tone", type: "string", required: false, description: "Siren tone" },
        { name: "duration", type: "number", required: false, description: "Duration in seconds" },
      ],
    },
    { name: "turn_off", description: "Turn off siren", params: [] },
  ],

  valve: [
    { name: "open", description: "Open valve", params: [] },
    { name: "close", description: "Close valve", params: [] },
    {
      name: "set_position",
      description: "Set valve position",
      params: [
        { name: "position", type: "number", required: true, min: 0, max: 100, unit: "%", description: "Position percentage (0-100)" },
      ],
    },
  ],

  remote: [
    { name: "turn_on", description: "Turn on remote", params: [] },
    { name: "turn_off", description: "Turn off remote", params: [] },
    {
      name: "send_command",
      description: "Send a command",
      params: [
        { name: "command", type: "string", required: true, description: "Command to send" },
      ],
    },
  ],

  number: [
    {
      name: "set_value",
      description: "Set number value",
      params: [
        { name: "value", type: "number", required: true, description: "Value to set" },
      ],
    },
  ],

  select: [
    {
      name: "select_option",
      description: "Select an option",
      params: [
        { name: "option", type: "string", required: true, description: "Option to select" },
      ],
    },
  ],

  update: [
    {
      name: "install",
      description: "Install update",
      params: [
        { name: "version", type: "string", required: false, description: "Target version" },
      ],
    },
  ],

  calendar: [
    {
      name: "create_event",
      description: "Create a calendar event",
      params: [
        { name: "summary", type: "string", required: true, description: "Event title" },
        { name: "startTime", type: "string", required: true, description: "Start time (ISO 8601)" },
        { name: "endTime", type: "string", required: true, description: "End time (ISO 8601)" },
        { name: "description", type: "string", required: false, description: "Event description" },
        { name: "location", type: "string", required: false, description: "Event location" },
      ],
    },
  ],

  // Read-only domains — no commands
  sensor: [],
  binary_sensor: [],
  weather: [],
  device_tracker: [],
  person: [],
  sun: [],
  zone: [],
  image: [],
  camera: [],
  event: [],
  date: [],
  datetime: [],
  time: [],
  text: [],
  tag: [],
  tts: [],
  stt: [],
};

/** Get standard DAL capabilities for a domain. Returns empty array for unknown/read-only domains. */
export function getStandardCapabilities(domain: string): CapabilityDescriptor[] {
  return capabilities[domain] ?? [];
}
