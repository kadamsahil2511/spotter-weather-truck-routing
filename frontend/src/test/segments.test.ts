import { describe, expect, it } from "vitest";

import { milesByLevel, routeSegments, segmentLines } from "../segments";

describe("route segments", () => {
  it("uses the worse endpoint, matching summarize_segments", () => {
    const miles = milesByLevel(
      routeSegments([
        { mile: 0, risk: { level: "low" } },
        { mile: 10, risk: { level: "severe" } },
        { mile: 20, risk: { level: "low" } },
      ]),
    );
    expect(miles.severe).toBeCloseTo(20);
    expect(miles.low).toBeCloseTo(0);
    expect(miles.moderate).toBeCloseTo(0);
    expect(miles.high).toBeCloseTo(0);
    expect(miles.no_travel).toBeCloseTo(0);
  });

  it("miles per level equal the summary miles", () => {
    const checkpoints = [
      { mile: 0, risk: { level: "low" } },
      { mile: 50, risk: { level: "low" } },
      { mile: 75, risk: { level: "severe" } },
      { mile: 100, risk: { level: "low" } },
      { mile: 125, risk: { level: "no_travel" } },
      { mile: 150, risk: { level: "low" } },
      { mile: 271, risk: { level: "low" } },
    ];
    // Hand count of the worse-endpoint rule, which is what the API summary stores:
    // 0–50 low, 50–100 severe, 100–150 no travel, 150–271 low.
    const summary = {
      low_mi: 171,
      moderate_mi: 0,
      high_mi: 0,
      severe_mi: 50,
      no_travel_mi: 50,
      unknown_mi: 0,
    };
    const miles = milesByLevel(routeSegments(checkpoints));
    expect(miles.low).toBeCloseTo(summary.low_mi);
    expect(miles.moderate).toBeCloseTo(summary.moderate_mi);
    expect(miles.high).toBeCloseTo(summary.high_mi);
    expect(miles.severe).toBeCloseTo(summary.severe_mi);
    expect(miles.no_travel).toBeCloseTo(summary.no_travel_mi);
    expect(miles.unknown).toBeCloseTo(summary.unknown_mi);
  });

  it("marks a segment unknown when either endpoint is unknown", () => {
    const miles = milesByLevel(
      routeSegments([
        { mile: 0, risk: { level: "low" } },
        { mile: 10, risk: { level: "unknown" } },
        { mile: 30, risk: { level: "high" } },
      ]),
    );
    expect(miles.unknown).toBeCloseTo(30);
    expect(miles.high).toBeCloseTo(0);
    expect(miles.low).toBeCloseTo(0);
  });

  it("colors map slices with the same levels the strip uses", () => {
    const checkpoints = [
      { mile: 0, risk: { level: "low" } },
      { mile: 10, risk: { level: "high" } },
      { mile: 20, risk: { level: "low" } },
    ];
    const geometry: [number, number][] = [
      [0, 0],
      [1, 0],
      [2, 0],
    ];
    const lines = segmentLines(geometry, checkpoints);
    expect(lines.map((line) => line.level)).toEqual(routeSegments(checkpoints).map((segment) => segment.level));
    expect(lines.map((line) => line.level)).toEqual(["high", "high"]);
  });
});
