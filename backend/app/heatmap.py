"""Corridor grid. Points are (lat, lon) rounded to 2 decimals, the weather cache key."""

from __future__ import annotations

import math

from app.geo import bearing_deg, cumulative_miles, destination, point_at, sample_targets
from app.routing import RouteOption
from app.weather import round_latlon


def corridor_points(routes: list[RouteOption], cap: int = 160) -> list[tuple[float, float]]:
    points = _grid(routes, step_mi=20, offset_mi=20)
    if len(points) > cap:
        points = _grid(routes, step_mi=30, offset_mi=15)
    if len(points) > cap:
        stride = math.ceil(len(points) / cap)
        points = points[::stride][:cap]
    return points


def _grid(routes: list[RouteOption], step_mi: float, offset_mi: float) -> list[tuple[float, float]]:
    found: list[tuple[float, float]] = []
    seen: set[tuple[float, float]] = set()

    def add(lat: float, lon: float) -> None:
        key = round_latlon(lat, lon)
        if key not in seen:
            seen.add(key)
            found.append(key)

    for route in routes:
        coords = route.coordinates
        if len(coords) < 2:
            continue
        cumulative = cumulative_miles(coords)
        for mile in sample_targets(cumulative[-1], step_mi):
            (lon, lat), index = point_at(coords, cumulative, mile)
            prev = coords[max(0, index - 1)]
            nxt = coords[min(len(coords) - 1, index if index else 1)]
            heading = 0.0 if prev == nxt else bearing_deg(prev[0], prev[1], nxt[0], nxt[1])
            add(lat, lon)
            east = destination(lon, lat, (heading + 90) % 360, offset_mi)
            west = destination(lon, lat, (heading - 90) % 360, offset_mi)
            add(east[1], east[0])
            add(west[1], west[0])
    return found
