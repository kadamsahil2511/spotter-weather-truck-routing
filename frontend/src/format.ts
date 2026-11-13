import type { RiskLevel, RouteSummary } from "./types";

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours <= 0) return `${minutes} min`;
  return `${hours} h ${minutes} min`;
}

/** Bubble copy: "5 h 12", or "40 min" under an hour. */
export function formatDurationCompact(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours <= 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes}`;
}

/** Drop a trailing .0. 50.0 is "50", 296.3 stays "296.3". */
export function formatMiles(miles: number): string {
  const rounded = Math.round(miles * 10) / 10;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(1);
}

export function formatMeasure(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

const WORST_FIRST = ["no_travel_mi", "severe_mi", "high_mi", "moderate_mi", "low_mi"] as const;

const KEY_LEVEL: Record<(typeof WORST_FIRST)[number], RiskLevel> = {
  no_travel_mi: "no_travel",
  severe_mi: "severe",
  high_mi: "high",
  moderate_mi: "moderate",
  low_mi: "low",
};

/** Display only. The worst level present in the summary. Not a score. */
export function worstSummaryLevel(summary: RouteSummary): RiskLevel {
  for (const key of WORST_FIRST) {
    if (summary[key] > 0.05) return KEY_LEVEL[key];
  }
  return "low";
}

export function formatLevel(level: RiskLevel | null): string {
  if (!level || level === "unknown") return "Unknown";
  if (level === "no_travel") return "No Travel";
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function hourLabel(anchor: string, hour: number): string {
  const date = new Date(anchor);
  if (Number.isNaN(date.getTime())) return `T+${hour}h`;
  date.setUTCHours(date.getUTCHours() + hour);
  return `T+${hour}h · ${formatWhen(date.toISOString())}`;
}

function zoneParts(iso: string, timeZone: string, options: Intl.DateTimeFormatOptions) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, ...options }).formatToParts(date);
  } catch {
    return null;
  }
}

function part(parts: Intl.DateTimeFormatPart[] | null, type: Intl.DateTimeFormatPartTypes): string {
  return parts?.find((item) => item.type === type)?.value ?? "";
}

export function formatClock(iso: string, timeZone: string): string {
  const parts = zoneParts(iso, timeZone, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  if (!parts) return formatWhen(iso);
  return `${part(parts, "hour")}:${part(parts, "minute")} ${part(parts, "dayPeriod")} ${part(parts, "timeZoneName")}`
    .replace(/\s+/g, " ")
    .trim();
}

/** Scrubber copy, in the origin timezone. Hour 0 is the departure hour. */
export function forecastLabel(anchorIso: string, hour: number, timeZone: string): string {
  const date = new Date(anchorIso);
  if (Number.isNaN(date.getTime())) return `Weather at T+${hour}h`;
  date.setUTCHours(date.getUTCHours() + hour);
  const parts = zoneParts(date.toISOString(), timeZone, {
    weekday: "short",
    hour: "numeric",
    timeZoneName: "short",
  });
  const when = parts
    ? `${part(parts, "weekday")} ${part(parts, "hour")} ${part(parts, "dayPeriod")} ${part(parts, "timeZoneName")}`
        .replace(/\s+/g, " ")
        .trim()
    : formatWhen(date.toISOString());
  const relative = hour === 0 ? "departure" : `departure +${hour} h`;
  return `Weather at ${when} · ${relative}`;
}

export const HEATMAP_CAPTION = "Heatmap is display-only. Checkpoint risk stays matched to each arrival.";

export function formatTripSummary(
  origin: string,
  destination: string,
  hour: number,
  minute: number,
  loadLb: number,
): string {
  const from = origin.split(",")[0]?.trim() || origin;
  const to = destination.split(",")[0]?.trim() || destination;
  const period = hour >= 12 ? "PM" : "AM";
  const clockHour = hour % 12 || 12;
  const time = minute === 0 ? `${clockHour} ${period}` : `${clockHour}:${String(minute).padStart(2, "0")} ${period}`;
  const load = loadLb >= 1000 && loadLb % 1000 === 0 ? `${loadLb / 1000}k lb` : `${loadLb.toLocaleString()} lb`;
  return `${from} → ${to} · ${time} · ${load}`;
}

export function loadNote(code: string | null): string | null {
  if (code === "45mph_over_30000") return "45–54 mph and load over 30,000 lb";
  if (code === "35mph_over_40000") return "35–44 mph and load over 40,000 lb";
  return null;
}
