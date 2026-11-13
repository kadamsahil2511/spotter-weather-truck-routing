import type { AnalyzeResponse } from "../types";

export const sampleResult: AnalyzeResponse = {
  assumptions: { wind_field: "sustained", tare_lb: 35000, height_m: 4, width_m: 2.6 },
  routes: [
    {
      id: "direct",
      label: "Direct",
      recommended: true,
      provider: "fixture",
      truck_profile: false,
      distance_mi: 100,
      duration_s: 7200,
      geometry: [
        [-87.6, 41.8],
        [-90.2, 38.6],
      ],
      summary: {
        no_travel_mi: 12,
        severe_mi: 0,
        high_mi: 10,
        moderate_mi: 0,
        low_mi: 78,
        unknown_mi: 0,
        avg_risk: 1.4,
        incomplete: false,
      },
      checkpoints: [
        {
          index: 0,
          lon: -87.6,
          lat: 41.8,
          mile: 0,
          eta: "2026-11-16T18:00:00Z",
          eta_source: "step",
          weather: {
            wind_mph: 60,
            gust_mph: 70,
            wind_used_mph: 60,
            rain_in_hr: 0,
            snow_in_hr: 0,
            matched: "exact",
          },
          risk: {
            level: "no_travel",
            wind: "no_travel",
            rain: "low",
            snow: "low",
            load_adjustment: null,
            partial: false,
          },
        },
      ],
      warnings: ["no_travel", "routing_fixture"],
    },
  ],
  recommendation: {
    route_id: "direct",
    decided_by: "severe_mi",
    confidence: "full",
    explanation: "direct has 0 severe miles versus 18 on via-east.",
  },
  heatmap: {
    anchor: "2026-11-16T18:00:00Z",
    hour_count: 49,
    points: [[-87.6, 41.8]],
    levels: Array.from({ length: 49 }, () => [4]),
  },
  warnings: ["routing_fixture"],
};
