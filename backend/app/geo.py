"""Miles, bearings, and polyline helpers. Coordinates are (lon, lat)."""

from __future__ import annotations

import math

EARTH_MI = 3958.8
METERS_PER_MILE = 1609.344


def haversine(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_MI * math.asin(min(1.0, math.sqrt(a)))


def cumulative_miles(coords: list[tuple[float, float]]) -> list[float]:
    miles = [0.0]
    for (lon1, lat1), (lon2, lat2) in zip(coords, coords[1:]):
        miles.append(miles[-1] + haversine(lon1, lat1, lon2, lat2))
    return miles


def bearing_deg(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dlambda = math.radians(lon2 - lon1)
    y = math.sin(dlambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlambda)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def destination(lon: float, lat: float, bearing: float, distance_mi: float) -> tuple[float, float]:
    angular = distance_mi / EARTH_MI
    theta = math.radians(bearing % 360.0)
    phi1 = math.radians(lat)
    lambda1 = math.radians(lon)
    phi2 = math.asin(
        math.sin(phi1) * math.cos(angular) + math.cos(phi1) * math.sin(angular) * math.cos(theta)
    )
    lambda2 = lambda1 + math.atan2(
        math.sin(theta) * math.sin(angular) * math.cos(phi1),
        math.cos(angular) - math.sin(phi1) * math.sin(phi2),
    )
    lon2 = (math.degrees(lambda2) + 540.0) % 360.0 - 180.0
    return lon2, math.degrees(phi2)


def point_at(
    coords: list[tuple[float, float]], cum: list[float], target: float
) -> tuple[tuple[float, float], int]:
    if not coords:
        raise ValueError("empty polyline")
    if target <= 0 or len(coords) == 1:
        return coords[0], 0
    if target >= cum[-1]:
        return coords[-1], len(coords) - 1
    for index in range(1, len(cum)):
        if cum[index] + 1e-9 >= target:
            span = cum[index] - cum[index - 1]
            frac = 0.0 if span <= 1e-12 else (target - cum[index - 1]) / span
            lon = coords[index - 1][0] + frac * (coords[index][0] - coords[index - 1][0])
            lat = coords[index - 1][1] + frac * (coords[index][1] - coords[index - 1][1])
            return (lon, lat), index
    return coords[-1], len(coords) - 1


def sample_targets(total: float, interval: float) -> list[float]:
    if total <= 1e-6:
        return [0.0]
    targets: list[float] = []
    mile = 0.0
    while mile < total - 1e-6:
        targets.append(mile)
        mile += interval
    if not targets or abs(targets[-1] - total) > 1e-6:
        targets.append(total)
    return targets


def distance_to_segment(
    lon: float,
    lat: float,
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    """Miles from a point to a segment, in a local equirectangular plane."""
    cos_lat = math.cos(math.radians(lat))

    def xy(coord: tuple[float, float]) -> tuple[float, float]:
        x = math.radians(coord[0] - lon) * cos_lat * EARTH_MI
        y = math.radians(coord[1] - lat) * EARTH_MI
        return x, y

    ax, ay = xy(start)
    bx, by = xy(end)
    dx, dy = bx - ax, by - ay
    denom = dx * dx + dy * dy
    if denom <= 1e-12:
        return math.hypot(ax, ay)
    t = max(0.0, min(1.0, (-ax * dx - ay * dy) / denom))
    return math.hypot(ax + t * dx, ay + t * dy)


def min_distance_to_line(lon: float, lat: float, coords: list[tuple[float, float]]) -> float:
    if not coords:
        return float("inf")
    if len(coords) == 1:
        return haversine(lon, lat, coords[0][0], coords[0][1])
    best = float("inf")
    for start, end in zip(coords, coords[1:]):
        best = min(best, distance_to_segment(lon, lat, start, end))
        if best <= 1.0:
            return best
    return best


# About 1.4 miles of latitude. Overlap checks only need a yes/no inside 1 mile.
_CELL_DEG = 0.02


def _cell(lon: float, lat: float) -> tuple[int, int]:
    return (math.floor(lon / _CELL_DEG), math.floor(lat / _CELL_DEG))


def _search_pad(lat: float, limit_mi: float) -> int:
    """How many cells to search so a segment within `limit_mi` cannot be missed."""
    lat_mi = _CELL_DEG * 69.0
    lon_mi = lat_mi * max(0.2, math.cos(math.radians(lat)))
    return int(math.ceil(limit_mi / min(lat_mi, lon_mi))) + 1


class LineIndex:
    """Segment grid for 'is this point within 1 mile of the line?'.

    The answer matches a full scan. Long segments are walked into every cell
    they cross, and the query pad covers the 1-mile neighborhood.
    """

    def __init__(self, coords: list[tuple[float, float]]) -> None:
        self.coords = coords
        self.buckets: dict[tuple[int, int], list[int]] = {}
        for index, (start, end) in enumerate(zip(coords, coords[1:])):
            for cell in _cells_along(start, end):
                self.buckets.setdefault(cell, []).append(index)

    def within(self, lon: float, lat: float, limit_mi: float = 1.0) -> bool:
        if len(self.coords) < 2:
            return False
        center = _cell(lon, lat)
        pad = _search_pad(lat, limit_mi)
        seen: set[int] = set()
        for dx in range(-pad, pad + 1):
            for dy in range(-pad, pad + 1):
                for index in self.buckets.get((center[0] + dx, center[1] + dy), ()):
                    if index in seen:
                        continue
                    seen.add(index)
                    if distance_to_segment(lon, lat, self.coords[index], self.coords[index + 1]) <= limit_mi:
                        return True
        return False


def _cells_along(start: tuple[float, float], end: tuple[float, float]) -> set[tuple[int, int]]:
    cells = {_cell(start[0], start[1]), _cell(end[0], end[1])}
    span = max(abs(end[0] - start[0]), abs(end[1] - start[1]))
    steps = max(1, int(span / (_CELL_DEG * 0.5)))
    for step in range(1, steps):
        frac = step / steps
        cells.add(_cell(start[0] + frac * (end[0] - start[0]), start[1] + frac * (end[1] - start[1])))
    return cells


def resample_miles(coords: list[tuple[float, float]], step_mi: float = 1.0) -> list[tuple[float, float]]:
    """Keep a point about every `step_mi`, plus the ends. Used before overlap checks."""
    if len(coords) < 3:
        return list(coords)
    cumulative = cumulative_miles(coords)
    total = cumulative[-1]
    if total <= step_mi:
        return [coords[0], coords[-1]]
    kept: list[tuple[float, float]] = []
    for target in sample_targets(total, step_mi):
        point, _index = point_at(coords, cumulative, target)
        if not kept or abs(point[0] - kept[-1][0]) > 1e-9 or abs(point[1] - kept[-1][1]) > 1e-9:
            kept.append(point)
    return kept


def douglas_peucker(
    coords: list[tuple[float, float]], epsilon_mi: float
) -> list[tuple[float, float]]:
    if len(coords) < 3:
        return list(coords)
    keep = {0, len(coords) - 1}

    def split(start: int, end: int) -> None:
        best_index = -1
        best_distance = -1.0
        for index in range(start + 1, end):
            distance = distance_to_segment(coords[index][0], coords[index][1], coords[start], coords[end])
            if distance > best_distance:
                best_distance = distance
                best_index = index
        if best_index >= 0 and best_distance > epsilon_mi:
            keep.add(best_index)
            split(start, best_index)
            split(best_index, end)

    split(0, len(coords) - 1)
    return [coords[index] for index in sorted(keep)]


def polyline_every(start: tuple[float, float], end: tuple[float, float], step_mi: float) -> list[tuple[float, float]]:
    total = haversine(start[0], start[1], end[0], end[1])
    if total < 1e-6:
        return [start]
    heading = bearing_deg(start[0], start[1], end[0], end[1])
    coords = [start]
    mile = step_mi
    while mile < total - 1e-6:
        coords.append(destination(start[0], start[1], heading, mile))
        mile += step_mi
    coords.append(end)
    return coords
