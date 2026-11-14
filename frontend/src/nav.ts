import { pointAlong } from "./segments";

const MAX_WAYPOINTS = 3;

export const NAV_CAVEAT = "Car directions in Google Maps. Check truck restrictions.";

type LineRoute = {
  label: string;
  geometry: [number, number][];
};

type Pin = { lat: number; lon: number };

/**
 * Via routes hand off their corridor with one midpoint.
 * Direct and every other label use 33% and 66%, still at most three waypoints.
 */
export function navigationWaypoints(route: LineRoute): [number, number][] {
  if (route.geometry.length < 2) return [];
  const fractions = /^via\b/i.test(route.label) ? [0.5] : [0.33, 0.66];
  return fractions.slice(0, MAX_WAYPOINTS).map((fraction) => pointAlong(route.geometry, fraction));
}

function pair(lat: number, lon: number): string {
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

export function googleMapsDirectionsUrl(route: LineRoute, origin?: Pin | null, destination?: Pin | null): string {
  const geometry = route.geometry;
  const start = origin ?? (geometry[0] ? { lon: geometry[0][0], lat: geometry[0][1] } : null);
  const last = geometry[geometry.length - 1];
  const end = destination ?? (last ? { lon: last[0], lat: last[1] } : null);
  const params = new URLSearchParams({ api: "1", travelmode: "driving" });
  if (start) params.set("origin", pair(start.lat, start.lon));
  if (end) params.set("destination", pair(end.lat, end.lon));
  const waypoints = navigationWaypoints(route)
    .slice(0, MAX_WAYPOINTS)
    .map(([lon, lat]) => pair(lat, lon));
  if (waypoints.length > 0) params.set("waypoints", waypoints.join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
