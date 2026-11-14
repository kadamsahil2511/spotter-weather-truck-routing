export type RiskLevel = "low" | "moderate" | "high" | "severe" | "no_travel" | "unknown";

export interface Place {
  id: string;
  label: string;
  lat: number;
  lon: number;
  timezone: string;
  country_code?: string;
}

export interface Checkpoint {
  index: number;
  lon: number;
  lat: number;
  mile: number;
  eta: string;
  eta_source: string;
  weather: {
    wind_mph: number | null;
    gust_mph: number | null;
    wind_used_mph: number | null;
    rain_in_hr: number | null;
    snow_in_hr: number | null;
    matched: string;
  };
  risk: {
    level: RiskLevel;
    wind: RiskLevel | null;
    rain: RiskLevel | null;
    snow: RiskLevel | null;
    load_adjustment: string | null;
    partial: boolean;
  };
}

export interface RouteSummary {
  no_travel_mi: number;
  severe_mi: number;
  high_mi: number;
  moderate_mi: number;
  low_mi: number;
  unknown_mi: number;
  avg_risk: number | null;
  incomplete: boolean;
}

export interface RouteResult {
  id: string;
  label: string;
  recommended: boolean;
  provider: string;
  truck_profile: boolean;
  distance_mi: number;
  duration_s: number;
  geometry: [number, number][];
  summary: RouteSummary;
  checkpoints: Checkpoint[];
  warnings: string[];
}

export interface AnalyzeResponse {
  assumptions: { wind_field: string; tare_lb: number; height_m: number; width_m: number };
  routes: RouteResult[];
  recommendation: {
    route_id: string;
    decided_by: string;
    confidence: string;
    explanation: string;
  } | null;
  heatmap: {
    anchor: string;
    hour_count: number;
    points: [number, number][];
    levels: (number | null)[][];
  };
  warnings: string[];
}

export interface AnalyzeRequest {
  origin: Place;
  destination: Place;
  departure: string;
  load_lb: number;
  sample_miles: 10 | 25 | 50;
}
