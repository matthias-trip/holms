import type { PirateWeatherResponse } from "./types.js";

export class PirateWeatherClient {
  private apiKey: string;
  private latitude: number;
  private longitude: number;
  private units: string;
  private lastFetchTime = 0;

  constructor(apiKey: string, latitude: number, longitude: number, units = "si") {
    this.apiKey = apiKey;
    this.latitude = latitude;
    this.longitude = longitude;
    this.units = units;
  }

  async fetch(): Promise<PirateWeatherResponse> {
    const url = `https://api.pirateweather.net/forecast/${this.apiKey}/${this.latitude},${this.longitude}?units=${this.units}&extend=hourly`;
    const res = await globalThis.fetch(url);
    if (!res.ok) {
      throw new Error(`PirateWeather API error: ${res.status} ${res.statusText}`);
    }
    this.lastFetchTime = Date.now();
    return res.json() as Promise<PirateWeatherResponse>;
  }

  ping(): boolean {
    // Healthy if we've fetched within the last 30 minutes
    return this.lastFetchTime > 0 && Date.now() - this.lastFetchTime < 30 * 60 * 1000;
  }

  getLastFetchTime(): number {
    return this.lastFetchTime;
  }
}
