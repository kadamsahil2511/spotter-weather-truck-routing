import { formatLevel, formatMiles } from "./format";
import type { AnalyzeResponse, Checkpoint, RiskLevel, RouteResult } from "./types";

const EARTH_MI = 3958.7613;
const RISKY = new Set<RiskLevel>(["moderate", "high", "severe", "no_travel"]);

export const OFF_ROUTE_MI = 2;
export const RECHECK_MS = 12 * 60 * 1000;

export interface RouteProgress {
  mile: number;
  fraction: number;
  distanceMi: number;
  snapped: [number, number];
  bearing: number;
}

function milesBetween(a: [number, number], b: [number, number]): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearingDeg(a: [number, number], b: [number, number]): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const phi1 = toRad(a[1]);
  const phi2 = toRad(b[1]);
  const dLon = toRad(b[0] - a[0]);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function project(lon: number, lat: number, start: [number, number], end: [number, number]) {
  const cos = Math.cos((lat * Math.PI) / 180);
  const ax = ((start[0] - lon) * Math.PI) / 180 * cos * EARTH_MI;
  const ay = ((start[1] - lat) * Math.PI) / 180 * EARTH_MI;
  const bx = ((end[0] - lon) * Math.PI) / 180 * cos * EARTH_MI;
  const by = ((end[1] - lat) * Math.PI) / 180 * EARTH_MI;
  const dx = bx - ax;
  const dy = by - ay;
  const denom = dx * dx + dy * dy;
  const t = denom <= 1e-12 ? 0 : Math.max(0, Math.min(1, (-ax * dx - ay * dy) / denom));
  const px = ax + t * dx;
  const py = ay + t * dy;
  const point: [number, number] = [lon + (px / (EARTH_MI * cos)) * (180 / Math.PI), lat + (py / EARTH_MI) * (180 / Math.PI)];
  return { t, distance: Math.hypot(px, py), point };
}

/** Snap a GPS fix onto the selected route and measure how far along it is. */
export function progressAlong(geometry: [number, number][], lon: number, lat: number): RouteProgress | null {
  if (geometry.length < 2) return null;
  let walked = 0;
  let best = Number.POSITIVE_INFINITY;
  let mile = 0;
  let snapped: [number, number] = geometry[0];
  let bearing = 0;
  for (let index = 0; index < geometry.length - 1; index += 1) {
    const start = geometry[index];
    const end = geometry[index + 1];
    const length = milesBetween(start, end);
    const hit = project(lon, lat, start, end);
    if (hit.distance < best) {
      best = hit.distance;
      mile = walked + hit.t * length;
      snapped = hit.point;
      bearing = bearingDeg(start, end);
    }
    walked += length;
  }
  return {
    mile,
    fraction: walked > 1e-6 ? mile / walked : 0,
    distanceMi: best,
    snapped,
    bearing,
  };
}

export function isOffRoute(distanceMi: number): boolean {
  return distanceMi > OFF_ROUTE_MI;
}

function hazardScore(level: RiskLevel | null): number {
  if (level === "no_travel") return 5;
  if (level === "severe") return 4;
  if (level === "high") return 3;
  if (level === "moderate") return 2;
  if (level === "low") return 1;
  return 0;
}

/** Next moderate-or-worse checkpoint still ahead. Gusts are not read. */
export function nextRiskAhead(checkpoints: Checkpoint[], mile: number): { milesAhead: number; text: string } | null {
  const ahead = checkpoints.find((point) => point.mile > mile + 0.05 && RISKY.has(point.risk.level));
  if (!ahead) return null;
  const milesAhead = Math.max(0, ahead.mile - mile);
  const miles = formatMiles(milesAhead);
  const wind = hazardScore(ahead.risk.wind);
  const rain = hazardScore(ahead.risk.rain);
  const snow = hazardScore(ahead.risk.snow);
  if (ahead.risk.level === "no_travel" && wind >= rain && wind >= snow) {
    return { milesAhead, text: `No Travel wind in ${miles} mi` };
  }
  if (wind >= rain && wind >= snow) {
    return { milesAhead, text: `${formatLevel(ahead.risk.level)} wind in ${miles} mi` };
  }
  if (rain >= snow) return { milesAhead, text: `${formatLevel(ahead.risk.level)} rain in ${miles} mi` };
  return { milesAhead, text: `${formatLevel(ahead.risk.level)} snow in ${miles} mi` };
}

export interface SwitchSuggestion {
  routeId: string;
  message: string;
}

/**
 * A different route is now first under the brief's order.
 * The caller decides whether to switch. This never picks for them.
 */
export function saferRouteSuggestion(currentId: string, result: AnalyzeResponse): SwitchSuggestion | null {
  const nextId = result.recommendation?.route_id;
  if (!nextId || nextId === currentId) return null;
  const next = result.routes.find((route) => route.id === nextId);
  if (!next) return null;
  const current = result.routes.find((route) => route.id === currentId);
  const avoided = current ? Math.max(0, current.summary.severe_mi - next.summary.severe_mi) : 0;
  const detail =
    avoided > 0.5
      ? `${next.label} avoids ${formatMiles(avoided)} mi Severe.`
      : (result.recommendation?.explanation ?? `${next.label} ranks ahead on the brief's order.`);
  return { routeId: nextId, message: `Safer route available: ${detail} Switch?` };
}

export function pointAtMile(geometry: [number, number][], mile: number): [number, number] | null {
  if (geometry.length === 0) return null;
  if (geometry.length === 1 || mile <= 0) return geometry[0];
  let walked = 0;
  for (let index = 0; index < geometry.length - 1; index += 1) {
    const length = milesBetween(geometry[index], geometry[index + 1]);
    if (walked + length >= mile) {
      const t = length <= 1e-9 ? 0 : (mile - walked) / length;
      const [lon1, lat1] = geometry[index];
      const [lon2, lat2] = geometry[index + 1];
      return [lon1 + (lon2 - lon1) * t, lat1 + (lat2 - lat1) * t];
    }
    walked += length;
  }
  return geometry[geometry.length - 1];
}

export function routeLengthMi(geometry: [number, number][]): number {
  let total = 0;
  for (let index = 0; index < geometry.length - 1; index += 1) total += milesBetween(geometry[index], geometry[index + 1]);
  return total;
}

export function remainingEta(route: RouteResult, mile: number): { miles: number; seconds: number } {
  const left = Math.max(0, route.distance_mi - mile);
  const fraction = route.distance_mi > 0 ? left / route.distance_mi : 0;
  return { miles: left, seconds: route.duration_s * fraction };
}
