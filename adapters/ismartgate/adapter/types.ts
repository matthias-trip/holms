export interface ISmartGateConfig {
  host: string;
  username: string;
  password: string;
  poll_interval?: number; // ms, default 5000
}

export type DoorStatus = "opened" | "closed" | "undefined";
export type EffectiveDoorStatus = DoorStatus | "opening" | "closing";

export interface DoorInfo {
  id: number;           // 1, 2, or 3
  name: string;
  status: DoorStatus;
  temperature: number | null;
  voltage: number | null;
  sensor: boolean;
  enabled: boolean;
  mode: string;         // "garage" | "pulse" | "onoff"
  isGate: boolean;
  apicode: string;
}
