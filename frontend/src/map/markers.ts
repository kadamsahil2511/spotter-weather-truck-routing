import type { RiskLevel } from "../types";

const SCORE: Record<string, number> = {
  low: 1,
  moderate: 2,
  high: 3,
  severe: 4,
  no_travel: 5,
};

export type MarkerIcon = "wind" | "rain" | "snow";

export interface WeatherMarker {
  icon: MarkerIcon;
  /** Sustained mph, or rain/snow in/h. Never the gust. */
  label: string;
  level: RiskLevel;
}

export interface MarkerInput {
  risk: {
    level: RiskLevel;
    wind: RiskLevel | null;
    rain: RiskLevel | null;
    snow: RiskLevel | null;
  };
  weather: {
    wind_used_mph: number | null;
    gust_mph?: number | null;
    rain_in_hr: number | null;
    snow_in_hr: number | null;
  };
}

const GLYPH: Record<MarkerIcon, string> = {
  wind: "≋",
  rain: "☂",
  snow: "❄",
};

function score(level: string | null): number {
  if (!level || level === "unknown") return -1;
  return SCORE[level] ?? -1;
}

function measure(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

/**
 * Moderate or worse only. The number is the deciding hazard.
 * Wind uses sustained `wind_used_mph`. Gust is ignored, including when it is larger.
 * A tie goes to wind, then rain, then snow.
 */
export function weatherMarker(point: MarkerInput): WeatherMarker | null {
  if (point.risk.level === "low" || point.risk.level === "unknown") return null;
  const wind = score(point.risk.wind);
  const rain = score(point.risk.rain);
  const snow = score(point.risk.snow);
  if (wind >= rain && wind >= snow) {
    return { icon: "wind", label: `${measure(point.weather.wind_used_mph)} mph`, level: point.risk.level };
  }
  if (rain >= snow) {
    return { icon: "rain", label: `${measure(point.weather.rain_in_hr)} in/h`, level: point.risk.level };
  }
  return { icon: "snow", label: `${measure(point.weather.snow_in_hr)} in/h`, level: point.risk.level };
}

export function markerGlyph(icon: MarkerIcon): string {
  return GLYPH[icon];
}
