import type { PirateWeatherDataPoint, PirateWeatherDailyPoint } from "./types.js";

// ── Icon → Condition Mapping ────────────────────────────────────────────────

const ICON_TO_CONDITION: Record<string, string> = {
  "clear-day": "clear",
  "clear-night": "clear",
  "rain": "rain",
  "snow": "snow",
  "sleet": "sleet",
  "wind": "wind",
  "fog": "fog",
  "cloudy": "cloudy",
  "partly-cloudy-day": "partly-cloudy",
  "partly-cloudy-night": "partly-cloudy",
};

// ── Current State Translation ───────────────────────────────────────────────

export function translateCurrentState(point: PirateWeatherDataPoint): Record<string, unknown> {
  return {
    temperature: point.temperature,
    apparent_temperature: point.apparentTemperature,
    humidity: point.humidity,
    condition: ICON_TO_CONDITION[point.icon] ?? point.icon,
    wind_speed: point.windSpeed,
    wind_bearing: point.windBearing ?? null,
    wind_gust: point.windGust ?? null,
    pressure: point.pressure,
    dew_point: point.dewPoint,
    cloud_cover: point.cloudCover,
    visibility: point.visibility ?? null,
    uv_index: point.uvIndex,
    precip_intensity: point.precipIntensity,
    precip_probability: point.precipProbability,
    precip_type: point.precipType ?? null,
  };
}

// ── Forecast Item Translation ───────────────────────────────────────────────

interface QueryParams {
  from?: number;
  to?: number;
  granularity?: "hourly" | "daily";
}

interface ForecastItem {
  id: string;
  start: number;
  end: number;
  granularity: "hourly" | "daily";
  [key: string]: unknown;
}

function translateHourlyPoint(point: PirateWeatherDataPoint): ForecastItem {
  const startMs = point.time * 1000;
  return {
    id: `hourly-${point.time}`,
    start: startMs,
    end: startMs + 3600_000, // +1 hour
    granularity: "hourly",
    temperature: point.temperature,
    temperature_low: null,
    apparent_temperature: point.apparentTemperature,
    humidity: point.humidity,
    condition: ICON_TO_CONDITION[point.icon] ?? point.icon,
    wind_speed: point.windSpeed,
    wind_bearing: point.windBearing ?? null,
    wind_gust: point.windGust ?? null,
    pressure: point.pressure,
    dew_point: point.dewPoint,
    cloud_cover: point.cloudCover,
    visibility: point.visibility ?? null,
    uv_index: point.uvIndex,
    precip_intensity: point.precipIntensity,
    precip_probability: point.precipProbability,
    precip_type: point.precipType ?? null,
  };
}

function translateDailyPoint(point: PirateWeatherDailyPoint): ForecastItem {
  const startMs = point.time * 1000;
  return {
    id: `daily-${point.time}`,
    start: startMs,
    end: startMs + 86_400_000, // +24 hours
    granularity: "daily",
    temperature: point.temperatureHigh,
    temperature_low: point.temperatureLow,
    apparent_temperature: point.apparentTemperatureHigh,
    humidity: point.humidity,
    condition: ICON_TO_CONDITION[point.icon] ?? point.icon,
    wind_speed: point.windSpeed,
    wind_bearing: point.windBearing ?? null,
    wind_gust: point.windGust ?? null,
    pressure: point.pressure,
    dew_point: point.dewPoint,
    cloud_cover: point.cloudCover,
    visibility: point.visibility ?? null,
    uv_index: point.uvIndex,
    precip_intensity: point.precipIntensity,
    precip_probability: point.precipProbability,
    precip_type: point.precipType ?? null,
    sunrise: point.sunriseTime * 1000,
    sunset: point.sunsetTime * 1000,
  };
}

export function translateForecastItems(
  hourly: PirateWeatherDataPoint[],
  daily: PirateWeatherDailyPoint[],
  params: QueryParams,
): ForecastItem[] {
  const items: ForecastItem[] = [];

  if (params.granularity !== "daily") {
    for (const point of hourly) {
      items.push(translateHourlyPoint(point));
    }
  }

  if (params.granularity !== "hourly") {
    for (const point of daily) {
      items.push(translateDailyPoint(point));
    }
  }

  // Filter by time range
  const from = params.from ?? 0;
  const to = params.to ?? Infinity;

  return items.filter((item) => item.end > from && item.start < to);
}
