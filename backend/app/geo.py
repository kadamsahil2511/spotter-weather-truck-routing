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
    return best


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
