// ── Adapter Config ──────────────────────────────────────────────────────────

export interface PirateWeatherConfig {
  api_key: string;
  latitude: number;
  longitude: number;
  units?: "si" | "us" | "ca" | "uk";
  location_name?: string;
  poll_interval_ms?: number;
}

// ── API Response Types ──────────────────────────────────────────────────────

export interface PirateWeatherResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  currently: PirateWeatherDataPoint;
  hourly: { summary: string; icon: string; data: PirateWeatherDataPoint[] };
  daily: { summary: string; icon: string; data: PirateWeatherDailyPoint[] };
  alerts?: PirateWeatherAlert[];
}

export interface PirateWeatherDataPoint {
  time: number;
  summary?: string;
  icon: string;
  precipIntensity: number;
  precipProbability: number;
  precipType?: string;
  temperature: number;
  apparentTemperature: number;
  dewPoint: number;
  humidity: number;
  pressure: number;
  windSpeed: number;
  windGust?: number;
  windBearing?: number;
  cloudCover: number;
  uvIndex: number;
  visibility?: number;
}

export interface PirateWeatherDailyPoint extends PirateWeatherDataPoint {
  temperatureHigh: number;
  temperatureLow: number;
  apparentTemperatureHigh: number;
  apparentTemperatureLow: number;
  sunriseTime: number;
  sunsetTime: number;
}

export interface PirateWeatherAlert {
  title: string;
  regions: string[];
  severity: string;
  time: number;
  expires: number;
  description: string;
  uri: string;
}
