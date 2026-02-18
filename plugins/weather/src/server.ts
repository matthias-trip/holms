import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// WMO Weather interpretation codes (WMO 4677)
const WMO_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snowfall",
  73: "Moderate snowfall",
  75: "Heavy snowfall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

function describeWeatherCode(code: number): string {
  return WMO_CODES[code] ?? `Unknown (${code})`;
}

interface CurrentWeather {
  temperature_2m: number;
  apparent_temperature: number;
  relative_humidity_2m: number;
  precipitation: number;
  weather_code: number;
  wind_speed_10m: number;
  cloud_cover: number;
}

interface HourlyWeather {
  time: string[];
  temperature_2m: number[];
  apparent_temperature: number[];
  precipitation_probability: number[];
  precipitation: number[];
  weather_code: number[];
  cloud_cover: number[];
  wind_speed_10m: number[];
  relative_humidity_2m: number[];
  uv_index: number[];
}

interface DailyWeather {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
  precipitation_probability_max: number[];
  weather_code: number[];
  sunrise: string[];
  sunset: string[];
  uv_index_max: number[];
  wind_speed_10m_max: number[];
}

interface ForecastResponse {
  current: CurrentWeather;
  current_units: Record<string, string>;
  hourly: HourlyWeather;
  hourly_units: Record<string, string>;
  daily: DailyWeather;
  daily_units: Record<string, string>;
  timezone: string;
}

function formatCurrent(current: CurrentWeather, units: Record<string, string>): string {
  const lines = [
    "## Current Conditions",
    "",
    `- Weather: ${describeWeatherCode(current.weather_code)}`,
    `- Temperature: ${current.temperature_2m}${units.temperature_2m} (feels like ${current.apparent_temperature}${units.apparent_temperature})`,
    `- Humidity: ${current.relative_humidity_2m}${units.relative_humidity_2m}`,
    `- Precipitation: ${current.precipitation}${units.precipitation}`,
    `- Wind: ${current.wind_speed_10m}${units.wind_speed_10m}`,
    `- Cloud cover: ${current.cloud_cover}${units.cloud_cover}`,
  ];
  return lines.join("\n");
}

function formatHourly(hourly: HourlyWeather, units: Record<string, string>): string {
  const lines = ["## Hourly Forecast (next 24h)", ""];

  // Only show next 24 hours
  const count = Math.min(24, hourly.time.length);
  for (let i = 0; i < count; i++) {
    const time = hourly.time[i].split("T")[1] ?? hourly.time[i];
    lines.push(
      `**${time}** — ${describeWeatherCode(hourly.weather_code[i])}, ` +
        `${hourly.temperature_2m[i]}${units.temperature_2m} (feels ${hourly.apparent_temperature[i]}${units.apparent_temperature}), ` +
        `rain ${hourly.precipitation_probability[i]}${units.precipitation_probability}/${hourly.precipitation[i]}${units.precipitation}, ` +
        `humidity ${hourly.relative_humidity_2m[i]}${units.relative_humidity_2m}, ` +
        `wind ${hourly.wind_speed_10m[i]}${units.wind_speed_10m}, ` +
        `clouds ${hourly.cloud_cover[i]}${units.cloud_cover}, ` +
        `UV ${hourly.uv_index[i]}`,
    );
  }
  return lines.join("\n");
}

function formatDaily(daily: DailyWeather, units: Record<string, string>): string {
  const lines = ["## Daily Outlook (7 days)", ""];

  for (let i = 0; i < daily.time.length; i++) {
    lines.push(
      `**${daily.time[i]}** — ${describeWeatherCode(daily.weather_code[i])}`,
      `  Temp: ${daily.temperature_2m_min[i]}–${daily.temperature_2m_max[i]}${units.temperature_2m_max}` +
        ` | Rain: ${daily.precipitation_sum[i]}${units.precipitation_sum} (${daily.precipitation_probability_max[i]}${units.precipitation_probability_max} chance)` +
        ` | Wind: up to ${daily.wind_speed_10m_max[i]}${units.wind_speed_10m_max}` +
        ` | UV max: ${daily.uv_index_max[i]}`,
      `  Sunrise: ${daily.sunrise[i].split("T")[1]} | Sunset: ${daily.sunset[i].split("T")[1]}`,
      "",
    );
  }
  return lines.join("\n");
}

const CURRENT_VARS = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "precipitation",
  "weather_code",
  "wind_speed_10m",
  "cloud_cover",
].join(",");

const HOURLY_VARS = [
  "temperature_2m",
  "apparent_temperature",
  "precipitation_probability",
  "precipitation",
  "weather_code",
  "cloud_cover",
  "wind_speed_10m",
  "relative_humidity_2m",
  "uv_index",
].join(",");

const DAILY_VARS = [
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "precipitation_probability_max",
  "weather_code",
  "sunrise",
  "sunset",
  "uv_index_max",
  "wind_speed_10m_max",
].join(",");

const server = new McpServer({
  name: "weather",
  version: "1.0.0",
});

server.tool(
  "get_weather_forecast",
  "Get current weather conditions, 24-hour hourly forecast, and 7-day daily outlook for a location. Useful for home automation decisions like heating/cooling, blinds, lighting schedules, and rain alerts.",
  {
    latitude: z.number().describe("WGS84 latitude"),
    longitude: z.number().describe("WGS84 longitude"),
    timezone: z.string().optional().default("auto").describe("IANA timezone (default: auto-detect)"),
  },
  async ({ latitude, longitude, timezone }) => {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set("timezone", timezone);
    url.searchParams.set("current", CURRENT_VARS);
    url.searchParams.set("hourly", HOURLY_VARS);
    url.searchParams.set("daily", DAILY_VARS);
    url.searchParams.set("forecast_hours", "24");
    url.searchParams.set("forecast_days", "7");

    const res = await fetch(url.toString());

    if (!res.ok) {
      const body = await res.text();
      return {
        content: [
          {
            type: "text" as const,
            text: `Open-Meteo API error (${res.status}): ${body}`,
          },
        ],
        isError: true,
      };
    }

    const data = (await res.json()) as ForecastResponse;

    const sections = [
      `# Weather Forecast (${data.timezone})`,
      `Location: ${latitude}, ${longitude}`,
      "",
      formatCurrent(data.current, data.current_units),
      "",
      formatHourly(data.hourly, data.hourly_units),
      "",
      formatDaily(data.daily, data.daily_units),
    ];

    return {
      content: [
        {
          type: "text" as const,
          text: sections.join("\n"),
        },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
