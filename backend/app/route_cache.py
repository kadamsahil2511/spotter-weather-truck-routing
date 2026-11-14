"""Cache a finished ORS route set. Redis when it is up, otherwise skip.

The key is the rounded pins, the load, and the truck profile. A dead Redis
must not fail the trip: reads and writes log and return nothing.
"""

from __future__ import annotations

import logging
from dataclasses import asdict

from app.routing import RouteOption, Step

logger = logging.getLogger(__name__)

TTL_SECONDS = 30 * 60
PROFILE = "driving-hgv"


def cache_key(
    origin: tuple[float, float],
    destination: tuple[float, float],
    load_lb: float,
    profile: str = PROFILE,
) -> str:
    def pin(point: tuple[float, float]) -> str:
        return f"{round(float(point[0]), 3):.3f},{round(float(point[1]), 3):.3f}"

    return f"ors-routes:v1:{pin(origin)}:{pin(destination)}:{int(round(float(load_lb)))}:{profile}"


def load_routes(cache, key: str) -> list[RouteOption] | None:
    if cache is None:
        return None
    try:
        payload = cache.get(key)
    except Exception:
        logger.exception("route cache read failed")
        return None
    if not payload:
        return None
    try:
        return [_route(item) for item in payload]
    except (KeyError, TypeError, ValueError):
        logger.exception("route cache payload was unreadable")
        return None


def store_routes(cache, key: str, routes: list[RouteOption]) -> None:
    if cache is None or not routes:
        return
    try:
        cache.set(key, [_dump(route) for route in routes], TTL_SECONDS)
    except Exception:
        logger.exception("route cache write failed")


def _dump(route: RouteOption) -> dict:
    payload = asdict(route)
    payload["steps"] = [asdict(step) for step in route.steps]
    return payload


def _route(payload: dict) -> RouteOption:
    steps = [Step(**step) for step in payload["steps"]]
    coordinates = [tuple(point) for point in payload["coordinates"]]
    via = payload.get("via")
    return RouteOption(
        id=payload["id"],
        label=payload["label"],
        provider=payload["provider"],
        truck_profile=bool(payload["truck_profile"]),
        distance_m=float(payload["distance_m"]),
        duration_s=float(payload["duration_s"]),
        coordinates=[(float(lon), float(lat)) for lon, lat in coordinates],
        steps=steps,
        warnings=list(payload.get("warnings") or []),
        kind=payload.get("kind") or "direct",
        via=None if via is None else (float(via[0]), float(via[1])),
    )
