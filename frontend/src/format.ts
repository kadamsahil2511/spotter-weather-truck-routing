import type { RiskLevel } from "./types";

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours <= 0) return `${minutes} min`;
  return `${hours} h ${minutes} min`;
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

export function loadNote(code: string | null): string | null {
  if (code === "45mph_over_30000") return "45–54 mph and load over 30,000 lb";
  if (code === "35mph_over_40000") return "35–44 mph and load over 40,000 lb";
  return null;
}
