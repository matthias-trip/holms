export interface AfvalinfoConfig {
  zipcode: string;
  house_number: string;
  house_number_suffix?: string;
}

export interface TrashApiEntry {
  name: string;
  date: string; // ISO with T, e.g. "2026-03-15T00:00:00"
  totalThisYear?: number;
}
