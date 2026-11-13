import type { RiskLevel } from "./types";

/**
 * Worse of two checkpoint levels.
 * Matches backend `risk.worse` / `risk.summarize_segments`: unknown on either
 * end makes the segment unknown, and a tie keeps the first endpoint.
 */
const SCORE: Record<string, number> = {
  low: 1,
  moderate: 2,
  high: 3,
  severe: 4,
  no_travel: 5,
};

export interface RouteSegment {
  level: RiskLevel;
  miles: number;
  startMile: number;
  endMile: number;
}

export interface SegmentLine {
  level: RiskLevel;
  coordinates: [number, number][];
}

type CheckpointLike = {
  mile: number;
  risk: { level: string };
};

export function worseLevel(left: string, right: string): RiskLevel {
  if (left === "unknown" || right === "unknown") return "unknown";
  const leftScore = SCORE[left] ?? 0;
  const rightScore = SCORE[right] ?? 0;
  return (leftScore >= rightScore ? left : right) as RiskLevel;
}

/** One segment per pair of checkpoints. Shared by the map line and the risk strip. */
export function routeSegments(checkpoints: CheckpointLike[]): RouteSegment[] {
  const segments: RouteSegment[] = [];
  for (let index = 0; index < checkpoints.length - 1; index += 1) {
    const start = checkpoints[index];
    const end = checkpoints[index + 1];
    segments.push({
      level: worseLevel(start.risk.level, end.risk.level),
      miles: Math.max(0, end.mile - start.mile),
      startMile: start.mile,
      endMile: end.mile,
    });
  }
  return segments;
}

export function milesByLevel(segments: RouteSegment[]): Record<RiskLevel, number> {
  const miles: Record<RiskLevel, number> = {
    low: 0,
    moderate: 0,
    high: 0,
    severe: 0,
    no_travel: 0,
    unknown: 0,
  };
  for (const segment of segments) miles[segment.level] += segment.miles;
  return miles;
}

const EARTH_MI = 3958.7613;

export function milesBetween(a: [number, number], b: [number, number]): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

function cumulativeMiles(geometry: [number, number][]): number[] {
  const miles = [0];
  for (let index = 1; index < geometry.length; index += 1) {
    miles.push(miles[index - 1] + milesBetween(geometry[index - 1], geometry[index]));
  }
  return miles;
}

function interpolateAt(geometry: [number, number][], cumulative: number[], distance: number): [number, number] {
  if (geometry.length === 0) return [0, 0];
  if (distance <= 0) return geometry[0];
  const last = cumulative[cumulative.length - 1] ?? 0;
  if (distance >= last) return geometry[geometry.length - 1];
  for (let index = 1; index < geometry.length; index += 1) {
    if (cumulative[index] < distance) continue;
    const span = cumulative[index] - cumulative[index - 1];
    const t = span <= 1e-9 ? 0 : (distance - cumulative[index - 1]) / span;
    const [lon1, lat1] = geometry[index - 1];
    const [lon2, lat2] = geometry[index];
    return [lon1 + (lon2 - lon1) * t, lat1 + (lat2 - lat1) * t];
  }
  return geometry[geometry.length - 1];
}

/** Point at a fraction of the line's length. Fraction 0.45 is the bubble anchor. */
export function pointAlong(geometry: [number, number][], fraction: number): [number, number] {
  if (geometry.length === 0) return [0, 0];
  if (geometry.length === 1) return geometry[0];
  const cumulative = cumulativeMiles(geometry);
  const total = cumulative[cumulative.length - 1] ?? 0;
  const clamped = Math.min(1, Math.max(0, fraction));
  return interpolateAt(geometry, cumulative, total * clamped);
}

function sliceBetween(geometry: [number, number][], cumulative: number[], start: number, end: number): [number, number][] {
  const total = cumulative[cumulative.length - 1] ?? 0;
  if (total <= 1e-9) return geometry.slice(0, 2);
  const startDistance = Math.min(1, Math.max(0, start)) * total;
  const endDistance = Math.min(1, Math.max(0, end)) * total;
  const coordinates: [number, number][] = [interpolateAt(geometry, cumulative, startDistance)];
  for (let index = 1; index < geometry.length - 1; index += 1) {
    if (cumulative[index] > startDistance && cumulative[index] < endDistance) coordinates.push(geometry[index]);
  }
  const finish = interpolateAt(geometry, cumulative, endDistance);
  const previous = coordinates[coordinates.length - 1];
  if (!previous || previous[0] !== finish[0] || previous[1] !== finish[1]) coordinates.push(finish);
  return coordinates;
}

/**
 * Selected-route geometry, split at checkpoint miles.
 * Levels come from `routeSegments`, so the line and the strip agree.
 */
export function segmentLines(
  geometry: [number, number][],
  checkpoints: CheckpointLike[],
): SegmentLine[] {
  if (geometry.length < 2) return [];
  const segments = routeSegments(checkpoints);
  if (segments.length === 0) {
    const level = (checkpoints[0]?.risk.level ?? "low") as RiskLevel;
    return [{ level, coordinates: geometry }];
  }
  const lastMile = checkpoints[checkpoints.length - 1]?.mile ?? 0;
  if (lastMile <= 1e-9) return [{ level: segments[0]?.level ?? "low", coordinates: geometry }];
  const cumulative = cumulativeMiles(geometry);
  const lines: SegmentLine[] = [];
  for (const segment of segments) {
    if (segment.miles <= 1e-9) continue;
    const coordinates = sliceBetween(geometry, cumulative, segment.startMile / lastMile, segment.endMile / lastMile);
    if (coordinates.length >= 2) lines.push({ level: segment.level, coordinates });
  }
  return lines;
}
