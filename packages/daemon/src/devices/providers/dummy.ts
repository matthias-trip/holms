import type { Device, DeviceEvent } from "@holms/shared";
import type { DeviceProvider } from "../types.js";

const DUMMY_DEVICES: Device[] = [
  {
    id: "dummy:living_room_light",
    name: "Living Room Light",
    type: "light",
    room: "Living Room",
    state: { on: false, brightness: 100 },
    capabilities: ["turn_on", "turn_off", "set_brightness"],
  },
  {
    id: "dummy:bedroom_light",
    name: "Bedroom Light",
    type: "light",
    room: "Bedroom",
    state: { on: false, brightness: 100 },
    capabilities: ["turn_on", "turn_off", "set_brightness"],
  },
  {
    id: "dummy:kitchen_light",
    name: "Kitchen Light",
    type: "light",
    room: "Kitchen",
    state: { on: false, brightness: 100 },
    capabilities: ["turn_on", "turn_off", "set_brightness"],
  },
  {
    id: "dummy:thermostat",
    name: "Main Thermostat",
    type: "thermostat",
    room: "Hallway",
    state: { temperature: 21, target: 21, mode: "auto" },
    capabilities: ["set_temperature", "set_mode"],
  },
  {
    id: "dummy:front_door_motion",
    name: "Front Door Motion Sensor",
    type: "motion_sensor",
    room: "Entrance",
    state: { motion: false, lastMotion: 0 },
    capabilities: ["simulate_motion", "simulate_motion_clear"],
  },
  {
    id: "dummy:front_door_lock",
    name: "Front Door Lock",
    type: "door_lock",
    room: "Entrance",
    state: { locked: true },
    capabilities: ["lock", "unlock"],
  },
];

export class DummyProvider implements DeviceProvider {
  readonly name = "dummy";

  private devices = new Map<string, Device>();
  private listeners: Array<(event: DeviceEvent) => void> = [];

  async connect(): Promise<void> {
    for (const device of DUMMY_DEVICES) {
      this.devices.set(device.id, { ...device, state: { ...device.state } });
    }
    console.log(`[DummyProvider] Connected with ${this.devices.size} devices`);
  }

  async disconnect(): Promise<void> {
    console.log("[DummyProvider] Disconnected");
  }

  async getDevices(): Promise<Device[]> {
    return Array.from(this.devices.values());
  }

  onEvent(callback: (event: DeviceEvent) => void): void {
    this.listeners.push(callback);
  }

  async executeCommand(
    deviceId: string,
    command: string,
    params: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string }> {
    const device = this.devices.get(deviceId);
    if (!device) {
      return { success: false, error: `Device ${deviceId} not found` };
    }

    if (!device.capabilities.includes(command)) {
      return {
        success: false,
        error: `Device ${deviceId} does not support command: ${command}`,
      };
    }

    switch (command) {
      case "turn_on":
        device.state.on = true;
        break;
      case "turn_off":
        device.state.on = false;
        break;
      case "set_brightness":
        device.state.brightness = params.brightness ?? 100;
        device.state.on = true;
        break;
      case "set_temperature":
        device.state.target = params.temperature ?? 21;
        break;
      case "set_mode":
        device.state.mode = params.mode ?? "auto";
        break;
      case "lock":
        device.state.locked = true;
        break;
      case "unlock":
        device.state.locked = false;
        break;
      case "simulate_motion":
        device.state.motion = true;
        device.state.lastMotion = Date.now();
        this.emitEvent({
          deviceId,
          type: "motion_detected",
          data: { motion: true },
          timestamp: Date.now(),
        });
        return { success: true };
      case "simulate_motion_clear":
        device.state.motion = false;
        this.emitEvent({
          deviceId,
          type: "motion_cleared",
          data: { motion: false },
          timestamp: Date.now(),
        });
        return { success: true };
      default:
        return { success: false, error: `Unknown command: ${command}` };
    }

    this.emitEvent({
      deviceId,
      type: "state_changed",
      data: { command, params, newState: { ...device.state } },
      timestamp: Date.now(),
    });

    return { success: true };
  }

  private emitEvent(event: DeviceEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
