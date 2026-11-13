import { describe, expect, it } from "vitest";

import { isOffRoute, nextRiskAhead, progressAlong, saferRouteSuggestion } from "../follow";
import type { AnalyzeResponse, Checkpoint } from "../types";
import { sampleResult } from "./sampleResult";

function point(mile: number, level: Checkpoint["risk"]["level"], wind: Checkpoint["risk"]["level"]): Checkpoint {
  return {
    index: mile,
    lon: -90,
    lat: 40,
    mile,
    eta: "2026-11-14T02:00:00Z",
    eta_source: "step",
    weather: {
      wind_mph: 40,
      gust_mph: 70,
      wind_used_mph: 40,
      rain_in_hr: 0,
      snow_in_hr: 0,
      matched: "exact",
    },
    risk: { level, wind, rain: "low", snow: "low", load_adjustment: null, partial: false },
  };
}

describe("progress along a route", () => {
  const line: [number, number][] = [
    [-90, 40],
    [-90, 41],
    [-90, 42],
  ];

  it("snaps a point on the line and reports miles from the start", () => {
    const progress = progressAlong(line, -90, 40.5);
    expect(progress).not.toBeNull();
    expect(progress!.distanceMi).toBeLessThan(0.2);
    expect(progress!.mile).toBeGreaterThan(30);
    expect(progress!.mile).toBeLessThan(40);
    expect(progress!.fraction).toBeGreaterThan(0.2);
    expect(progress!.fraction).toBeLessThan(0.3);
  });

  it("flags a fix more than 2 miles off the line", () => {
    const progress = progressAlong(line, -89.9, 40.5);
    expect(progress!.distanceMi).toBeGreaterThan(2);
    expect(isOffRoute(progress!.distanceMi)).toBe(true);
    expect(isOffRoute(0.4)).toBe(false);
  });
});

describe("next risk ahead", () => {
  it("names the next severe wind and ignores the gust", () => {
    const ahead = nextRiskAhead(
      [point(0, "low", "low"), point(34, "severe", "severe"), point(80, "no_travel", "no_travel")],
      0,
    );
    expect(ahead?.text).toBe("Severe wind in 34 mi");
    expect(ahead?.text).not.toContain("70");
    expect(nextRiskAhead([point(10, "severe", "severe")], 10)?.text ?? null).toBeNull();
  });
});

describe("safer route suggestion", () => {
  it("offers a switch only when a different route is now recommended", () => {
    const result: AnalyzeResponse = {
      ...sampleResult,
      routes: [
        {
          ...sampleResult.routes[0],
          id: "direct",
          label: "Direct",
          summary: { ...sampleResult.routes[0].summary, severe_mi: 50, no_travel_mi: 0 },
        },
        {
          ...sampleResult.routes[0],
          id: "via-west",
          label: "Via west",
          summary: { ...sampleResult.routes[0].summary, severe_mi: 10, no_travel_mi: 0 },
        },
      ],
      recommendation: {
        route_id: "via-west",
        decided_by: "severe_mi",
        confidence: "full",
        explanation: "Via west has 10 severe miles versus 50 on Direct.",
      },
    };
    expect(saferRouteSuggestion("via-west", result)).toBeNull();
    expect(saferRouteSuggestion("direct", result)?.message).toBe(
      "Safer route available: Via west avoids 40 mi Severe. Switch?",
    );
  });
});
