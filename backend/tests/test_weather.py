import json
from datetime import datetime, timezone

import httpx
import pytest

from app.weather import (
    OpenMeteoClient,
    Series,
    match_series,
    parse_forecast,
    snow_to_inches,
)


def test_snow_conversion_trusts_the_unit_field():
    assert snow_to_inches(2.54, "cm") == pytest.approx(1.0)
    assert snow_to_inches(1.0, "inch") == pytest.approx(1.0)
    with pytest.raises(ValueError):
        snow_to_inches(1, "mm")


def test_interpolation_and_edges():
    times = [0, 3600]
    values = [10.0, 20.0]
    assert match_series(times, values, 1800) == pytest.approx((15.0, "interpolated"))
    assert match_series(times, values, 0)[1] == "exact"
    assert match_series(times, values, -10) == (10.0, "clamped")
    assert match_series(times, [None, 20.0], 1800) == (20.0, "nearest")
    assert match_series(times, [None, None], 1800) == (None, "nearest")


def test_parse_forecast_converts_cm_and_keeps_inches():
    body = {
        "hourly_units": {"snowfall": "cm", "wind_speed_10m": "mph", "rain": "inch"},
        "hourly": {
            "time": [100, 200],
            "wind_speed_10m": [10, 12],
            "wind_gusts_10m": [40, 55],
            "rain": [0.1, 0.2],
            "snowfall": [2.54, 0],
        },
    }
    series = parse_forecast(body, 1)[0]
    assert series.snow[0] == pytest.approx(1.0)
    assert series.wind == [10, 12]
    assert series.gust == [40, 55]


def test_failed_chunk_does_not_drop_successful_points():
    def handler(request: httpx.Request) -> httpx.Response:
        lats = request.url.params["latitude"].split(",")
        if lats[0].startswith("10"):
            return httpx.Response(500, json={"error": "no"})
        body = [
            {
                "hourly_units": {"snowfall": "inch"},
                "hourly": {
                    "time": [1_700_000_000],
                    "wind_speed_10m": [8],
                    "wind_gusts_10m": [9],
                    "rain": [0],
                    "snowfall": [0],
                },
            }
            for _ in lats
        ]
        payload = body[0] if len(body) == 1 else body
        return httpx.Response(200, json=payload)

    client = OpenMeteoClient(cache=None, client=httpx.Client(transport=httpx.MockTransport(handler)))
    client.calls = 0
    start = datetime(2026, 11, 16, tzinfo=timezone.utc)
    end = datetime(2026, 11, 18, tzinfo=timezone.utc)
    # Force two chunks by patching the chunk size for this call.
    import app.weather as weather_module

    original = weather_module.CHUNK
    weather_module.CHUNK = 1
    try:
        found = client.fetch([(41.88, -87.63), (10.0, 10.0)], start, end)
    finally:
        weather_module.CHUNK = original
    assert (41.88, -87.63) in found
    assert (10.0, 10.0) in client.failed_points
    assert client.calls == 4  # one success plus three attempts on the failure


def test_client_batches_and_caches():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        lats = request.url.params["latitude"].split(",")
        body = []
        for _ in lats:
            body.append(
                {
                    "hourly_units": {"snowfall": "inch"},
                    "hourly": {
                        "time": [1_700_000_000],
                        "wind_speed_10m": [8],
                        "wind_gusts_10m": [30],
                        "rain": [0],
                        "snowfall": [0.2],
                    },
                }
            )
        payload = body[0] if len(body) == 1 else body
        return httpx.Response(200, json=payload)

    client = OpenMeteoClient(
        cache=None,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    start = datetime(2026, 11, 16, tzinfo=timezone.utc)
    end = datetime(2026, 11, 18, tzinfo=timezone.utc)
    points = [(41.88, -87.63), (41.881, -87.631), (32.78, -96.80)]
    first = client.fetch(points, start, end)
    assert calls["n"] == 1
    assert len(first) == 2
    assert first[(41.88, -87.63)].snow == [0.2]
    second = client.fetch(points, start, end)
    assert calls["n"] == 1
    assert client.cache_hits == 2
    assert second[(32.78, -96.80)].wind == [8]
    json.dumps({"ok": True})
