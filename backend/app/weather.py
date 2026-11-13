"""Open-Meteo hourly forecasts, unit conversion, and hour matching."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
CHUNK = 100
TTL_SECONDS = 1800


@dataclass
class Series:
    times: list[int]
    wind: list[float | None]
    gust: list[float | None]
    rain: list[float | None]
    snow: list[float | None]


def snow_to_inches(value: float | None, unit: str) -> float | None:
    if value is None:
        return None
    normalized = unit.strip().lower()
    if normalized == "inch":
        return float(value)
    if normalized == "cm":
        return float(value) / 2.54
    raise ValueError(f"unsupported snowfall unit: {unit}")


def match_series(
    times: list[int], values: list[float | None], moment: int
) -> tuple[float | None, str]:
    """Linear interpolation in the series units. Ends clamp to the nearest hour."""
    if not times or not values:
        return None, "clamped"
    if moment <= times[0]:
        return values[0], "exact" if abs(moment - times[0]) <= 1 else "clamped"
    if moment >= times[-1]:
        return values[-1], "exact" if abs(moment - times[-1]) <= 1 else "clamped"
    hi = 1
    while hi < len(times) and times[hi] < moment:
        hi += 1
    lo = hi - 1
    span = times[hi] - times[lo]
    fraction = 0.0 if span == 0 else (moment - times[lo]) / span
    left, right = values[lo], values[hi]
    if fraction <= 1e-9:
        return left, "exact"
    if left is None and right is None:
        return None, "nearest"
    if left is None or right is None:
        return (right if left is None else left), "nearest"
    return left + fraction * (right - left), "interpolated"


def overall_match(matches: list[str]) -> str:
    if any(item == "interpolated" for item in matches):
        return "interpolated"
    if any(item == "nearest" for item in matches):
        return "nearest"
    if any(item == "clamped" for item in matches):
        return "clamped"
    return "exact"


def round_latlon(lat: float, lon: float) -> tuple[float, float]:
    return round(lat, 2), round(lon, 2)


def _cache_key(lat: float, lon: float, start: str, end: str) -> str:
    return f"om:v1:{lat:.2f}:{lon:.2f}:{start}:{end}"


def _as_series(payload: dict) -> Series:
    return Series(
        times=[int(item) for item in payload["times"]],
        wind=payload["wind"],
        gust=payload["gust"],
        rain=payload["rain"],
        snow=payload["snow"],
    )


def _from_series(series: Series) -> dict:
    return {
        "times": series.times,
        "wind": series.wind,
        "gust": series.gust,
        "rain": series.rain,
        "snow": series.snow,
    }


class MemoryCache:
    def __init__(self) -> None:
        self.data: dict[str, dict] = {}

    def get_many(self, keys: list[str]) -> dict:
        return {key: self.data[key] for key in keys if key in self.data}

    def set_many(self, mapping: dict, timeout: int | None = None) -> None:
        self.data.update(mapping)


class SafeCache:
    """Django cache, with a process-local dict if Redis is down."""

    def __init__(self, backend) -> None:
        self.backend = backend
        self.local = MemoryCache()
        self.disabled = backend is None

    def get_many(self, keys: list[str]) -> dict:
        if self.disabled:
            return self.local.get_many(keys)
        try:
            return self.backend.get_many(keys)
        except Exception:
            logger.exception("weather cache read failed; using memory")
            self.disabled = True
            return self.local.get_many(keys)

    def set_many(self, mapping: dict, timeout: int) -> None:
        if self.disabled:
            self.local.set_many(mapping, timeout)
            return
        try:
            self.backend.set_many(mapping, timeout)
        except Exception:
            logger.exception("weather cache write failed; using memory")
            self.disabled = True
            self.local.set_many(mapping, timeout)


def parse_forecast(body: dict | list, count: int) -> list[Series]:
    items = body if isinstance(body, list) else [body]
    if len(items) != count:
        raise ValueError(f"forecast returned {len(items)} locations, expected {count}")
    series: list[Series] = []
    for item in items:
        units = item.get("hourly_units") or {}
        hourly = item["hourly"]
        snow_unit = str(units.get("snowfall", "cm"))
        snow = [snow_to_inches(value, snow_unit) for value in hourly["snowfall"]]
        series.append(
            Series(
                times=[int(value) for value in hourly["time"]],
                wind=list(hourly["wind_speed_10m"]),
                gust=list(hourly["wind_gusts_10m"]),
                rain=list(hourly["rain"]),
                snow=snow,
            )
        )
    return series


class OpenMeteoClient:
    def __init__(self, cache=None, client: httpx.Client | None = None) -> None:
        self.cache = cache if isinstance(cache, SafeCache) else SafeCache(cache)
        self.client = client or httpx.Client(timeout=10.0)
        self.calls = 0
        self.cache_hits = 0

    def fetch(
        self,
        points: list[tuple[float, float]],
        start: datetime,
        end: datetime,
    ) -> dict[tuple[float, float], Series]:
        unique: list[tuple[float, float]] = []
        seen: set[tuple[float, float]] = set()
        for lat, lon in points:
            key = round_latlon(lat, lon)
            if key not in seen:
                seen.add(key)
                unique.append(key)
        if not unique:
            return {}
        start_s = _hour_stamp(start)
        end_s = _hour_stamp(end)
        keys = [_cache_key(lat, lon, start_s, end_s) for lat, lon in unique]
        cached = self.cache.get_many(keys)
        found: dict[tuple[float, float], Series] = {}
        missing: list[tuple[float, float]] = []
        for point, key in zip(unique, keys):
            payload = cached.get(key)
            if payload:
                self.cache_hits += 1
                found[point] = _as_series(payload)
            else:
                missing.append(point)
        fresh: dict[str, dict] = {}
        for offset in range(0, len(missing), CHUNK):
            chunk = missing[offset : offset + CHUNK]
            parsed = self._fetch_chunk(chunk, start_s, end_s)
            for point, series in zip(chunk, parsed):
                found[point] = series
                fresh[_cache_key(point[0], point[1], start_s, end_s)] = _from_series(series)
        if fresh:
            self.cache.set_many(fresh, TTL_SECONDS)
        return found

    def _fetch_chunk(self, points: list[tuple[float, float]], start: str, end: str) -> list[Series]:
        params = {
            "latitude": ",".join(f"{lat:.2f}" for lat, _ in points),
            "longitude": ",".join(f"{lon:.2f}" for _, lon in points),
            "hourly": "wind_speed_10m,wind_gusts_10m,rain,snowfall",
            "wind_speed_unit": "mph",
            "precipitation_unit": "inch",
            "timezone": "GMT",
            "timeformat": "unixtime",
            "start_hour": start,
            "end_hour": end,
        }
        response = None
        for attempt in (1, 2):
            self.calls += 1
            try:
                response = self.client.get(OPEN_METEO_URL, params=params)
            except httpx.HTTPError:
                logger.warning("open-meteo request failed", exc_info=True)
                if attempt == 2:
                    raise
                continue
            if response.status_code in (429, 502, 503, 504) and attempt == 1:
                continue
            break
        assert response is not None
        response.raise_for_status()
        return parse_forecast(response.json(), len(points))


def _hour_stamp(moment: datetime) -> str:
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    utc = moment.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    return utc.strftime("%Y-%m-%dT%H:%M")
