import { describe, expect, it } from "vitest";

import { googleMapsDirectionsUrl, navigationWaypoints } from "../nav";

const line: [number, number][] = [
  [-87.63, 41.88],
  [-88.5, 40.8],
  [-89.4, 39.8],
  [-90.2, 38.63],
];

describe("navigation link", () => {
  it("opens Google Maps driving directions with at most three waypoints", () => {
    const direct = navigationWaypoints({ label: "Direct", geometry: line });
    const via = navigationWaypoints({ label: "Via east", geometry: line });
    expect(direct).toHaveLength(2);
    expect(via).toHaveLength(1);
    expect(direct.length).toBeLessThanOrEqual(3);
    expect(via.length).toBeLessThanOrEqual(3);

    const href = googleMapsDirectionsUrl(
      { label: "Direct", geometry: line },
      { lat: 41.8781, lon: -87.6298 },
      { lat: 38.627, lon: -90.1994 },
    );
    const url = new URL(href);
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("travelmode")).toBe("driving");
    expect(url.searchParams.get("origin")).toBe("41.87810,-87.62980");
    expect(url.searchParams.get("destination")).toBe("38.62700,-90.19940");
    const waypoints = url.searchParams.get("waypoints")?.split("|") ?? [];
    expect(waypoints.length).toBe(2);
    expect(waypoints.length).toBeLessThanOrEqual(3);
    expect(waypoints[0]).toMatch(/^-?\d+\.\d+,-?\d+\.\d+$/);
  });

  it("uses a single via waypoint for a via route", () => {
    const href = googleMapsDirectionsUrl({ label: "Via west", geometry: line });
    const waypoints = new URL(href).searchParams.get("waypoints")?.split("|") ?? [];
    expect(waypoints).toHaveLength(1);
  });
});
