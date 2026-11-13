"""One search: routes, checkpoints, risk, recommendation, heatmap frames."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.geo import METERS_PER_MILE, douglas_peucker, haversine
from app.heatmap import corridor_points
from app.risk import (
    LEVEL_INDEX,
    Ranked,
    Summary,
    align_display,
    apply_load,
    classify_rain,
    classify_snow,
    combine,
    recommend,
)
from app.routing import PointNotRoutable, RouteOption, RoutingUnavailable
from app.sampling import Placed, place_checkpoints
from app.weather import Series, match_series, overall_match, round_latlon

DISPLAY_EPSILON_MI = 0.05
logger = logging.getLogger(__name__)


class AnalyzeError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        status: int,
        *,
        upstream_status: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.upstream_status = upstream_status


def run(payload: dict, provider, weather, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    origin, destination, departure, load_lb, sample_miles = _validate(payload, now)
    try:
        routes = provider.routes(
            (origin["lon"], origin["lat"]),
            (destination["lon"], destination["lat"]),
            load_lb,
        )
    except PointNotRoutable as exc:
        raise AnalyzeError("point_not_routable", str(exc), 422) from exc
    except RoutingUnavailable as exc:
        raise AnalyzeError(
            "routing_unavailable",
            str(exc),
            503,
            upstream_status=exc.status,
        ) from exc
    if not routes:
        raise AnalyzeError("no_route", "No drivable route was found between those points.", 422)

    warnings: list[str] = []
    if any("routing_fixture" in route.warnings for route in routes):
        warnings.append("routing_fixture")
    if any("weight_restriction_relaxed" in route.warnings for route in routes):
        warnings.append("weight_restriction_relaxed")
    if any("truck_profile_unavailable" in route.warnings for route in routes):
        warnings.append("truck_profile_unavailable")
    if len(routes) < 3:
        warnings.append("partial_routes")
    for place in (origin, destination):
        code = place.get("country_code")
        if code and code != "US" and "non_us" not in warnings:
            warnings.append("non_us")

    anchor = _floor_hour(departure)
    if departure < now - timedelta(hours=1):
        anchor = _floor_hour(now)
        warnings.append("heatmap_anchored_now")
    hours = [anchor + timedelta(hours=offset) for offset in range(49)]

    prepared: list[tuple[RouteOption, list[Placed], float]] = []
    latest = departure
    for route in routes:
        placed, total_mi = place_checkpoints(
            route.coordinates, route.steps, route.duration_s, departure, sample_miles
        )
        if any(point.eta_source == "uniform" for point in placed):
            route.warnings.append("eta_uniform")
        provider_mi = route.distance_m / METERS_PER_MILE
        if total_mi > 1 and abs(provider_mi - total_mi) / total_mi > 0.05:
            route.warnings.append("distance_mismatch")
        if placed:
            latest = max(latest, placed[-1].eta)
        prepared.append((route, placed, total_mi))

    window_start = min(_floor_hour(departure), hours[0])
    window_end = max(hours[-1], _floor_hour(latest) + timedelta(hours=1))
    grid = corridor_points([route for route, _, _ in prepared])
    fetch_points = list(grid)
    for _, placed, _ in prepared:
        for point in placed:
            fetch_points.append(round_latlon(point.lat, point.lon))

    series: dict[tuple[float, float], Series] = {}
    try:
        series = weather.fetch(fetch_points, window_start, window_end)
    except Exception as exc:
        logger.warning("weather fetch failed: %s", exc)
        warnings.append("weather_unavailable")
    failed_points = getattr(weather, "failed_points", None) or []
    if failed_points and not series:
        if "weather_unavailable" not in warnings:
            warnings.append("weather_unavailable")
    elif failed_points:
        warnings.append("weather_partial")

    built = []
    ranked: list[Ranked] = []
    for route, placed, _total in prepared:
        checkpoints = [_checkpoint(point, series, load_lb) for point in placed]
        target_mi = round(route.distance_m / METERS_PER_MILE, 1)
        aligned, summary = align_display(
            [item["risk"]["level"] for item in checkpoints],
            [point.mile for point in placed],
            target_mi,
        )
        for item, mile in zip(checkpoints, aligned):
            item["mile"] = mile
        if summary.no_travel_mi > 0.05 and "no_travel" not in route.warnings:
            route.warnings.append("no_travel")
        built.append((route, checkpoints, summary))
        ranked.append(Ranked(route.id, route.duration_s, summary, route.label))

    choice = recommend(ranked)
    if choice is None and "weather_unavailable" not in warnings:
        warnings.append("weather_unavailable")

    levels = _frames(grid, series, hours, load_lb) if series else [[None] * len(grid) for _ in hours]
    payloads = []
    for route, checkpoints, summary in built:
        payloads.append(
            {
                "id": route.id,
                "label": route.label,
                "recommended": bool(choice and choice.route_id == route.id),
                "provider": route.provider,
                "truck_profile": route.truck_profile,
                "distance_mi": round(route.distance_m / METERS_PER_MILE, 1),
                "duration_s": int(round(route.duration_s)),
                "geometry": [
                    [round(lon, 5), round(lat, 5)]
                    for lon, lat in douglas_peucker(route.coordinates, DISPLAY_EPSILON_MI)
                ],
                "summary": _summary_json(summary),
                "checkpoints": checkpoints,
                "warnings": route.warnings,
            }
        )
    payloads.sort(key=lambda item: (not item["recommended"], item["duration_s"], item["id"]))

    return {
        "units": {
            "distance": "mi",
            "duration": "s",
            "wind": "mph",
            "rain": "in/hr",
            "snow": "in/hr",
            "load": "lb",
            "coordinates": "[lon, lat]",
            "time": "utc iso8601",
            "avg_risk": "1 low, 2 moderate, 3 high, 4 severe, 5 no_travel",
        },
        "assumptions": {
            "tare_lb": 35000,
            "height_m": 4.0,
            "width_m": 2.6,
            "wind_field": "sustained",
        },
        "routes": payloads,
        "recommendation": None
        if choice is None
        else {
            "route_id": choice.route_id,
            "decided_by": choice.decided_by,
            "confidence": choice.confidence,
            "explanation": choice.explanation,
        },
        "heatmap": {
            "anchor": hours[0].astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "hour_count": 49,
            "points": [[lon, lat] for lat, lon in grid],
            "levels": levels,
        },
        "warnings": warnings,
        "meta": {
            "routing_calls": int(getattr(provider, "calls", 0)),
            "weather_calls": int(getattr(weather, "calls", 0)),
            "cache_hits": int(getattr(weather, "cache_hits", 0)),
        },
    }


def _checkpoint(point: Placed, series_map: dict[tuple[float, float], Series], load_lb: float) -> dict:
    series = series_map.get(round_latlon(point.lat, point.lon))
    moment = int(point.eta.timestamp())
    if series is None:
        wind = gust = rain = snow = None
        matches = ["clamped", "clamped", "clamped"]
    else:
        wind, wind_match = match_series(series.times, series.wind, moment)
        gust, _ = match_series(series.times, series.gust, moment)
        rain, rain_match = match_series(series.times, series.rain, moment)
        snow, snow_match = match_series(series.times, series.snow, moment)
        matches = [wind_match, rain_match, snow_match]
    wind_level = None
    adjustment = None
    if wind is not None:
        wind_level, adjustment = apply_load(wind, load_lb)
    rain_level = None if rain is None else classify_rain(rain)
    snow_level = None if snow is None else classify_snow(snow)
    level, partial = combine(wind_level, rain_level, snow_level)
    if any(item == "nearest" for item in matches):
        partial = True
    return {
        "index": point.index,
        "lon": round(point.lon, 5),
        "lat": round(point.lat, 5),
        "mile": round(point.mile, 1),
        "eta": point.eta.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "eta_source": point.eta_source,
        "weather": {
            "wind_mph": _num(wind),
            "gust_mph": _num(gust),
            "wind_used_mph": _num(wind),
            "rain_in_hr": _num(rain),
            "snow_in_hr": _num(snow),
            "matched": overall_match(matches),
        },
        "risk": {
            "level": level,
            "wind": wind_level,
            "rain": rain_level,
            "snow": snow_level,
            "load_adjustment": adjustment,
            "partial": partial,
        },
    }


def _frames(points, series_map, hours, load_lb: float) -> list[list[int | None]]:
    rows: list[list[int | None]] = []
    for hour in hours:
        moment = int(hour.timestamp())
        row: list[int | None] = []
        for lat, lon in points:
            series = series_map.get((lat, lon))
            if series is None:
                row.append(None)
                continue
            wind, _ = match_series(series.times, series.wind, moment)
            rain, _ = match_series(series.times, series.rain, moment)
            snow, _ = match_series(series.times, series.snow, moment)
            wind_level = None if wind is None else apply_load(wind, load_lb)[0]
            rain_level = None if rain is None else classify_rain(rain)
            snow_level = None if snow is None else classify_snow(snow)
            level, _partial = combine(wind_level, rain_level, snow_level)
            row.append(None if level == "unknown" else LEVEL_INDEX[level])
        rows.append(row)
    return rows


def _summary_json(summary: Summary) -> dict:
    return {
        "no_travel_mi": round(summary.no_travel_mi, 1),
        "severe_mi": round(summary.severe_mi, 1),
        "high_mi": round(summary.high_mi, 1),
        "moderate_mi": round(summary.moderate_mi, 1),
        "low_mi": round(summary.low_mi, 1),
        "unknown_mi": round(summary.unknown_mi, 1),
        "avg_risk": None if summary.avg_risk is None else round(summary.avg_risk, 2),
        "incomplete": summary.incomplete,
    }


def _num(value: float | None) -> float | None:
    if value is None:
        return None
    return round(float(value), 2)


def _floor_hour(moment: datetime) -> datetime:
    utc = moment.astimezone(timezone.utc)
    return utc.replace(minute=0, second=0, microsecond=0)


def _validate(payload: dict, now: datetime):
    if not isinstance(payload, dict):
        raise AnalyzeError("validation_error", "Expected a JSON object.", 400)
    origin = _place(payload.get("origin"), "origin")
    destination = _place(payload.get("destination"), "destination")
    if haversine(origin["lon"], origin["lat"], destination["lon"], destination["lat"]) < 1:
        raise AnalyzeError(
            "validation_error",
            "Origin and destination must be at least 1 mile apart.",
            400,
        )
    sample = payload.get("sample_miles")
    if sample not in (10, 25, 50):
        raise AnalyzeError("validation_error", "sample_miles must be 10, 25, or 50.", 400)
    load = payload.get("load_lb")
    if isinstance(load, bool) or not isinstance(load, (int, float)) or load <= 0 or load > 200_000:
        raise AnalyzeError("validation_error", "load_lb must be greater than 0 and at most 200000.", 400)
    timezone_name = origin.get("timezone")
    if not isinstance(timezone_name, str) or not timezone_name:
        raise AnalyzeError("validation_error", "Origin timezone is required.", 400)
    try:
        zone = ZoneInfo(timezone_name)
    except Exception as exc:
        raise AnalyzeError("validation_error", "Origin timezone is not recognized.", 400) from exc
    raw = payload.get("departure")
    if not isinstance(raw, str):
        raise AnalyzeError("validation_error", "Departure is required.", 400)
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise AnalyzeError("validation_error", "Departure is not a valid date and time.", 400) from exc
    departure = parsed.replace(tzinfo=zone) if parsed.tzinfo is None else parsed
    if departure < now - timedelta(hours=6) or departure > now + timedelta(days=14):
        raise AnalyzeError(
            "departure_out_of_range",
            "Departure must be within the last 6 hours and the next 14 days.",
            422,
        )
    return origin, destination, departure, float(load), int(sample)


def _place(value, name: str) -> dict:
    if not isinstance(value, dict):
        raise AnalyzeError("validation_error", f"{name} is required.", 400)
    try:
        lat = float(value["lat"])
        lon = float(value["lon"])
    except (KeyError, TypeError, ValueError) as exc:
        raise AnalyzeError("validation_error", f"{name} needs a latitude and longitude.", 400) from exc
    if not -90 <= lat <= 90 or not -180 <= lon <= 180:
        raise AnalyzeError("validation_error", f"{name} is outside the valid coordinate range.", 400)
    label = value.get("label")
    if not isinstance(label, str) or not label.strip():
        raise AnalyzeError("validation_error", f"{name} needs a label.", 400)
    place = {"label": label.strip(), "lat": lat, "lon": lon}
    if value.get("timezone"):
        place["timezone"] = value["timezone"]
    if value.get("country_code"):
        place["country_code"] = value["country_code"]
    return place
