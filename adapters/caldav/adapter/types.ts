export interface CalDavAdapterConfig {
  server_url: string;
  username: string;
  password: string;
  calendars?: string[];
  poll_interval_ms?: number;
  auth_method?: "basic" | "digest";
}

export interface CalendarInfo {
  url: string;
  displayName: string;
  ctag?: string;
  color?: string;
}

export interface CalendarEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  start: number;
  end: number;
  all_day: boolean;
  recurring: boolean;
  raw_url?: string;
  etag?: string;
}
