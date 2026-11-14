"""Time overlap checks the old way and the indexed way.

Geometry is synthetic: no ORS key. Point counts match the live profiles
(Chicago ~2k, Dallas–Atlanta ~6k, SLC–NY ~20k). The old column is one pair
scanned vertex by vertex. The new column is dedupe() of three corridors,
which is the work the request actually repeats.
"""

from __future__ import annotations

import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.geo import cumulative_miles, min_distance_to_line, point_at
from app.routing import dedupe, line_route, share_fraction


def corridor(count: int, lon0: float, lon1: float, lat: float, shift: float) -> list[tuple[float, float]]:
    # Latitude shift: these lines run east-west, so lon shift would slide along the road.
    return [
        (lon0 + (lon1 - lon0) * index / (count - 1), lat + shift + 0.01 * math.sin(index / 25.0))
        for index in range(count)
    ]


def slow_share(coords, other) -> float:
    cumulative = cumulative_miles(coords)
    total = cumulative[-1]
    miles = []
    cursor = 0.0
    while cursor <= total + 1e-9:
        miles.append(min(cursor, total))
        cursor += 5.0
        if miles[-1] >= total:
            break
    near = 0
    for mile in miles:
        lon, lat = point_at(coords, cumulative, mile)[0]
        if min_distance_to_line(lon, lat, other) <= 1.0:
            near += 1
    return near / len(miles)


def bench(name: str, count: int, lon0: float, lon1: float, lat: float) -> None:
    direct = corridor(count, lon0, lon1, lat, 0.0)
    east = corridor(count, lon0, lon1, lat, 0.08)
    west = corridor(count, lon0, lon1, lat, -0.08)
    started = time.perf_counter()
    slow_share(direct, east)
    old = time.perf_counter() - started
    routes = [
        line_route(direct, mph=55, provider="bench", truck_profile=True, warnings=[], kind="direct"),
        line_route(east, mph=50, provider="bench", truck_profile=True, warnings=[], kind="via", via=east[count // 2]),
        line_route(west, mph=50, provider="bench", truck_profile=True, warnings=[], kind="via", via=west[count // 2]),
    ]
    for route, label in zip(routes, ("direct", "east", "west")):
        route.id = label
    started = time.perf_counter()
    kept = [route.id for route in dedupe(routes)]
    new = time.perf_counter() - started
    print(f"{name:22} points={count:<6} old_pair={old:8.3f}s  new_dedupe={new:8.3f}s  kept={kept}")


if __name__ == "__main__":
    bench("Chicago → St. Louis", 2_000, -87.63, -90.20, 40.2)
    bench("Dallas → Atlanta", 6_000, -96.80, -84.39, 33.2)
    bench("Salt Lake City → NY", 20_000, -111.89, -74.01, 40.7)
