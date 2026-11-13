"""Route providers. The rest of the app sees RouteOption and nothing vendor-specific."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import httpx

from app.geo import (
    bearing_deg,
    cumulative_miles,
    destination,
    haversine,
    min_distance_to_line,
    point_at,
    polyline_every,
)

logger = logging.getLogger(__name__)

ORS_URL = "https://api.heigit.org/v2/directions/driving-hgv"
OSRM_URL = "https://router.project-osrm.org/route/v1/driving"
USER_AGENT = "truck-weather-routes/0.1"
TARE_LB = 35_000
KM_PER_MILE = 1.609344
SHORT_HAUL_KM = 90.0


class RoutingUnavailable(Exception):
    pass


@dataclass
class Step:
    distance_m: float
    duration_s: float
    start_index: int
    end_index: int


@dataclass
class RouteOption:
    id: str
    label: str
    provider: str
    truck_profile: bool
    distance_m: float
    duration_s: float
    coordinates: list[tuple[float, float]]
    steps: list[Step]
    warnings: list[str] = field(default_factory=list)
    kind: str = "direct"
    via: tuple[float, float] | None = None


def decode_polyline(encoded: str, precision: int = 5) -> list[tuple[float, float]]:
    """ORS polyline precision 5. The encoded order is lat, lon. We store lon, lat."""
    factor = float(10**precision)
    lat = 0
    lon = 0
    index = 0
    coords: list[tuple[float, float]] = []
    length = len(encoded)

    def read() -> tuple[int, int]:
        nonlocal index
        result = 0
        shift = 0
        while True:
            if index >= length:
                raise ValueError("truncated polyline")
            chunk = ord(encoded[index]) - 63
            index += 1
            result |= (chunk & 0x1F) << shift
            shift += 5
            if chunk < 0x20:
                break
        delta = ~(result >> 1) if result & 1 else result >> 1
        return delta, index

    while index < length:
        dlat, index = read()
        dlon, index = read()
        lat += dlat
        lon += dlon
        coords.append((lon / factor, lat / factor))
    return coords


def ors_body(
    coordinates: list[tuple[float, float]],
    load_lb: float,
    *,
    alternatives: bool,
    restrictions: bool,
    preference: str,
) -> dict:
    body: dict = {
        "coordinates": [[lon, lat] for lon, lat in coordinates],
        "units": "m",
        "geometry": True,
        "instructions": True,
        "preference": preference,
        "options": {"vehicle_type": "hgv"},
    }
    if restrictions:
        tons = round((load_lb + TARE_LB) / 2204.62, 2)
        body["options"]["profile_params"] = {
            "restrictions": {"weight": tons, "height": 4.0, "width": 2.6}
        }
    if alternatives:
        body["alternative_routes"] = {
            "target_count": 3,
            "share_factor": 0.6,
            "weight_factor": 1.4,
        }
    return body


def parse_ors(payload: dict, *, truck_profile: bool) -> list[RouteOption]:
    routes: list[RouteOption] = []
    for raw in payload.get("routes") or []:
        geometry = decode_polyline(raw["geometry"])
        steps: list[Step] = []
        for segment in raw.get("segments") or []:
            for step in segment.get("steps") or []:
                waypoints = step.get("way_points") or [0, 0]
                steps.append(
                    Step(
                        distance_m=float(step.get("distance") or 0),
                        duration_s=float(step.get("duration") or 0),
                        start_index=int(waypoints[0]),
                        end_index=int(waypoints[-1]),
                    )
                )
        summary = raw.get("summary") or {}
        routes.append(
            RouteOption(
                id="",
                label="",
                provider="ors-hgv",
                truck_profile=truck_profile,
                distance_m=float(summary.get("distance") or 0),
                duration_s=float(summary.get("duration") or 0),
                coordinates=geometry,
                steps=steps,
                kind="alternative",
            )
        )
    return routes


def parse_osrm(payload: dict) -> list[RouteOption]:
    routes: list[RouteOption] = []
    for raw in payload.get("routes") or []:
        coordinates: list[tuple[float, float]] = []
        steps: list[Step] = []
        for leg in raw.get("legs") or []:
            for step in leg.get("steps") or []:
                geometry = step.get("geometry", {}).get("coordinates") or []
                points = [(float(point[0]), float(point[1])) for point in geometry]
                if coordinates and points and coordinates[-1] == points[0]:
                    start = len(coordinates) - 1
                    points = points[1:]
                else:
                    start = len(coordinates)
                coordinates.extend(points)
                end = max(len(coordinates) - 1, start)
                steps.append(
                    Step(
                        distance_m=float(step.get("distance") or 0),
                        duration_s=float(step.get("duration") or 0),
                        start_index=start,
                        end_index=end,
                    )
                )
        if len(coordinates) < 2:
            continue
        routes.append(
            RouteOption(
                id="",
                label="",
                provider="osrm",
                truck_profile=False,
                distance_m=float(raw.get("distance") or 0),
                duration_s=float(raw.get("duration") or 0),
                coordinates=coordinates,
                steps=steps,
                warnings=["truck_profile_unavailable"],
                kind="alternative",
            )
        )
    return routes


def share_fraction(coords: list[tuple[float, float]], other: list[tuple[float, float]]) -> float:
    cumulative = cumulative_miles(coords)
    total = cumulative[-1]
    if total <= 1e-6 or len(other) < 2:
        return 1.0
    miles = []
    cursor = 0.0
    while cursor <= total + 1e-9:
        miles.append(min(cursor, total))
        cursor += 5.0
        if miles[-1] >= total:
            break
    near = 0
    for mile in miles:
        (lon, lat), _ = point_at(coords, cumulative, mile)
        if min_distance_to_line(lon, lat, other) <= 1.0:
            near += 1
    return near / len(miles)


def dedupe(routes: list[RouteOption]) -> list[RouteOption]:
    kept: list[RouteOption] = []
    for route in routes:
        if len(route.coordinates) < 2:
            continue
        if any(share_fraction(route.coordinates, existing.coordinates) > 0.85 for existing in kept):
            continue
        kept.append(route)
    return kept


def lateral_vias(
    coords: list[tuple[float, float]], fraction: float
) -> tuple[tuple[float, float], tuple[float, float], tuple[float, float]]:
    cumulative = cumulative_miles(coords)
    total = cumulative[-1]
    (lon, lat), index = point_at(coords, cumulative, total * fraction)
    prev = coords[max(0, index - 1)]
    nxt = coords[min(len(coords) - 1, index if index > 0 else 1)]
    heading = 0.0 if prev == nxt else bearing_deg(prev[0], prev[1], nxt[0], nxt[1])
    offset = max(10.0, min(40.0, 0.12 * total))
    left = destination(lon, lat, (heading - 90) % 360, offset)
    right = destination(lon, lat, (heading + 90) % 360, offset)
    return left, right, (lon, lat)


def side_name(via: tuple[float, float], midpoint: tuple[float, float]) -> str:
    dlon = via[0] - midpoint[0]
    dlat = via[1] - midpoint[1]
    if abs(dlon) >= abs(dlat):
        return "east" if dlon >= 0 else "west"
    return "north" if dlat >= 0 else "south"


def _slug(label: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in label)
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned.strip("-") or "route"


def assign_labels(routes: list[RouteOption]) -> list[RouteOption]:
    if routes and all(route.kind == "alternative" for route in routes):
        routes = sorted(routes, key=lambda route: (route.duration_s, route.distance_m))
        names = ["Fastest", "Alternate", "Alternate 2"]
        for index, route in enumerate(routes):
            route.label = names[index] if index < len(names) else f"Alternate {index}"
            route.id = _slug(route.label)
        return routes

    base = next((route for route in routes if route.kind == "direct"), routes[0])
    cumulative = cumulative_miles(base.coordinates)
    midpoint, _ = point_at(base.coordinates, cumulative, cumulative[-1] / 2)
    used: set[str] = set()
    for route in routes:
        if route.kind == "via" and route.via is not None:
            label = f"Via {side_name(route.via, midpoint)}"
        elif route.kind == "shortest":
            label = "Shortest"
        elif route.kind == "direct":
            label = "Direct"
        else:
            label = "Alternate"
        unique = label
        suffix = 2
        while unique in used:
            unique = f"{label} {suffix}"
            suffix += 1
        used.add(unique)
        route.label = unique
        route.id = _slug(unique)
    return routes


def line_route(
    coordinates: list[tuple[float, float]],
    *,
    mph: float,
    provider: str,
    truck_profile: bool,
    warnings: list[str],
    kind: str,
    via: tuple[float, float] | None = None,
) -> RouteOption:
    cumulative = cumulative_miles(coordinates)
    steps: list[Step] = []
    for index in range(len(coordinates) - 1):
        miles = cumulative[index + 1] - cumulative[index]
        steps.append(
            Step(
                distance_m=miles * 1609.344,
                duration_s=(miles / mph) * 3600.0 if mph else 0.0,
                start_index=index,
                end_index=index + 1,
            )
        )
    return RouteOption(
        id="",
        label="",
        provider=provider,
        truck_profile=truck_profile,
        distance_m=cumulative[-1] * 1609.344,
        duration_s=sum(step.duration_s for step in steps),
        coordinates=coordinates,
        steps=steps,
        warnings=list(warnings),
        kind=kind,
        via=via,
    )


class FixtureProvider:
    """Straight-line stand-in used when ORS_API_KEY is unset. Not a truck route."""

    calls = 0

    def routes(
        self, origin: tuple[float, float], destination: tuple[float, float], load_lb: float
    ) -> list[RouteOption]:
        del load_lb
        direct_coords = polyline_every(origin, destination, 5.0)
        direct = line_route(
            direct_coords,
            mph=55,
            provider="fixture",
            truck_profile=False,
            warnings=["routing_fixture"],
            kind="direct",
        )
        left, right, _ = lateral_vias(direct_coords, 0.5)
        routes = [direct]
        for via, mph in ((left, 50.0), (right, 52.0)):
            coords = polyline_every(origin, via, 5.0)[:-1] + polyline_every(via, destination, 5.0)
            routes.append(
                line_route(
                    coords,
                    mph=mph,
                    provider="fixture",
                    truck_profile=False,
                    warnings=["routing_fixture"],
                    kind="via",
                    via=via,
                )
            )
        return assign_labels(dedupe(routes))


class _HttpRoutes:
    def __init__(self, client: httpx.Client | None = None) -> None:
        self.client = client or httpx.Client(timeout=10.0)
        self.calls = 0

    def _send(self, request: httpx.Request) -> httpx.Response:
        response = None
        last_error: Exception | None = None
        for attempt in (1, 2):
            self.calls += 1
            try:
                response = self.client.send(request)
            except httpx.HTTPError as exc:
                last_error = exc
                logger.warning("routing request failed", exc_info=True)
                if attempt == 2:
                    raise RoutingUnavailable("The routing provider did not respond.") from exc
                continue
            if response.status_code in (429, 502, 503, 504) and attempt == 1:
                continue
            return response
        if response is not None:
            return response
        raise RoutingUnavailable("The routing provider did not respond.") from last_error


class OrsProvider(_HttpRoutes):
    def __init__(self, api_key: str, client: httpx.Client | None = None) -> None:
        super().__init__(client)
        self.api_key = api_key

    def routes(
        self, origin: tuple[float, float], destination: tuple[float, float], load_lb: float
    ) -> list[RouteOption]:
        routes, failed = self._collect(origin, destination, load_lb, restrictions=True)
        relaxed = False
        if not routes:
            routes, failed = self._collect(origin, destination, load_lb, restrictions=False)
            relaxed = True
        if not routes:
            if failed:
                raise RoutingUnavailable("OpenRouteService did not return a route.")
            return []
        if relaxed:
            for route in routes:
                route.truck_profile = False
                if "weight_restriction_relaxed" not in route.warnings:
                    route.warnings.append("weight_restriction_relaxed")
        return assign_labels(routes)

    def _collect(self, origin, destination, load_lb, restrictions: bool):
        miles = haversine(origin[0], origin[1], destination[0], destination[1])
        failed = False
        found: list[RouteOption] = []
        if miles * KM_PER_MILE <= SHORT_HAUL_KM:
            batch, ok = self._fetch(
                [origin, destination],
                load_lb,
                alternatives=True,
                restrictions=restrictions,
                preference="recommended",
                kind="alternative",
            )
            failed = failed or not ok
            found.extend(batch)
            found = dedupe(found)
            if len(found) >= 3:
                return found[:3], failed
        direct, ok = self._fetch(
            [origin, destination],
            load_lb,
            alternatives=False,
            restrictions=restrictions,
            preference="recommended",
            kind="direct",
        )
        failed = failed or not ok
        found = dedupe(found + direct)
        if not found:
            return [], failed
        base = next((route for route in found if route.kind == "direct"), found[0])
        for fraction in (0.5, 0.35):
            if len(found) >= 3:
                break
            left, right, _ = lateral_vias(base.coordinates, fraction)
            for via in (left, right):
                extra, ok = self._fetch(
                    [origin, via, destination],
                    load_lb,
                    alternatives=False,
                    restrictions=restrictions,
                    preference="recommended",
                    kind="via",
                    via=via,
                )
                failed = failed or not ok
                found = dedupe(found + extra)
                if len(found) >= 3:
                    break
        if len(found) < 3:
            extra, ok = self._fetch(
                [origin, destination],
                load_lb,
                alternatives=False,
                restrictions=restrictions,
                preference="shortest",
                kind="shortest",
            )
            failed = failed or not ok
            found = dedupe(found + extra)
        return found[:3], failed

    def _fetch(
        self,
        coordinates,
        load_lb,
        *,
        alternatives: bool,
        restrictions: bool,
        preference: str,
        kind: str,
        via: tuple[float, float] | None = None,
    ) -> tuple[list[RouteOption], bool]:
        body = ors_body(
            coordinates,
            load_lb,
            alternatives=alternatives,
            restrictions=restrictions,
            preference=preference,
        )
        request = httpx.Request(
            "POST",
            ORS_URL,
            json=body,
            headers={
                "Authorization": self.api_key,
                "Content-Type": "application/json",
                "User-Agent": USER_AGENT,
            },
        )
        try:
            response = self._send(request)
        except RoutingUnavailable:
            return [], False
        if response.status_code >= 500 or response.status_code == 429:
            return [], False
        if response.status_code >= 400:
            logger.info("ors returned %s", response.status_code)
            return [], True
        routes = parse_ors(response.json(), truck_profile=restrictions)
        for route in routes:
            route.kind = kind
            route.via = via
        return routes, True


class OsrmProvider(_HttpRoutes):
    def routes(
        self, origin: tuple[float, float], destination: tuple[float, float], load_lb: float
    ) -> list[RouteOption]:
        del load_lb
        found, ok = self._fetch([origin, destination], alternatives=True, kind="alternative")
        if not ok and not found:
            raise RoutingUnavailable("OSRM did not respond.")
        found = dedupe(found)
        if len(found) >= 3:
            return assign_labels(found[:3])
        direct, ok = self._fetch([origin, destination], alternatives=False, kind="direct")
        if not ok and not found and not direct:
            raise RoutingUnavailable("OSRM did not respond.")
        found = dedupe(found + direct)
        if not found:
            return []
        base = found[0]
        left, right, _ = lateral_vias(base.coordinates, 0.5)
        for via in (left, right):
            extra, _ = self._fetch([origin, via, destination], alternatives=False, kind="via", via=via)
            found = dedupe(found + extra)
            if len(found) >= 3:
                break
        return assign_labels(found[:3])

    def _fetch(self, coordinates, *, alternatives: bool, kind: str, via=None):
        path = ";".join(f"{lon},{lat}" for lon, lat in coordinates)
        request = httpx.Request(
            "GET",
            f"{OSRM_URL}/{path}",
            params={
                "alternatives": "true" if alternatives else "false",
                "steps": "true",
                "geometries": "geojson",
                "overview": "full",
            },
            headers={"User-Agent": USER_AGENT},
        )
        try:
            response = self._send(request)
        except RoutingUnavailable:
            return [], False
        if response.status_code >= 400:
            return [], response.status_code < 500
        routes = parse_osrm(response.json())
        for route in routes:
            route.kind = kind
            route.via = via
        return routes, True


def get_provider() -> FixtureProvider | OrsProvider | OsrmProvider:
    import os

    choice = os.environ.get("ROUTING_PROVIDER", "").strip().lower()
    key = os.environ.get("ORS_API_KEY", "").strip()
    if choice == "osrm":
        return OsrmProvider()
    if choice == "fixture" or not key:
        return FixtureProvider()
    return OrsProvider(key)
