from datetime import datetime, timedelta, timezone

import pytest
from rest_framework.test import APIRequestFactory

from app.analyze import AnalyzeError, run
from app.routing import FixtureProvider
from app.views import AnalyzeView, HealthView
from app.weather import Series


NOW = datetime(2026, 11, 16, 12, 0, tzinfo=timezone.utc)


def test_gust_is_display_only_and_no_travel_does_not_change_the_sort():
    calm = run(_payload(load_lb=20000), FixtureProvider(), FlatWeather(10), now=NOW)
    direct = next(route for route in calm["routes"] if route["label"] == "Direct")
    sample = direct["checkpoints"][1]
    assert calm["assumptions"]["wind_field"] == "sustained"
    assert sample["weather"]["gust_mph"] == 80
    assert sample["weather"]["wind_used_mph"] == 10
    assert sample["risk"]["wind"] == "low"
    assert sample["risk"]["level"] == "low"
    assert calm["recommendation"]["route_id"] == direct["id"]

    storm = run(_payload(load_lb=20000), FixtureProvider(), FlatWeather(60), now=NOW)
    winner = next(route for route in storm["routes"] if route["recommended"])
    assert winner["label"] == "Direct"
    assert winner["summary"]["severe_mi"] == 0
    assert winner["summary"]["no_travel_mi"] > 0
    assert "no_travel" in winner["warnings"]
    assert storm["recommendation"]["decided_by"] in {"duration_s", "id", "only_route"}
    assert storm["heatmap"]["hour_count"] == 49
    assert len(storm["heatmap"]["levels"]) == 49
    assert storm["heatmap"]["levels"][0][0] == 4


def test_summary_miles_match_displayed_distance():
    result = run(_payload(load_lb=20000), FixtureProvider(), FlatWeather(10), now=NOW)
    for route in result["routes"]:
        summary = route["summary"]
        total = (
            summary["low_mi"]
            + summary["moderate_mi"]
            + summary["high_mi"]
            + summary["severe_mi"]
            + summary["no_travel_mi"]
            + summary["unknown_mi"]
        )
        assert total == pytest.approx(route["distance_mi"])
        assert route["checkpoints"][-1]["mile"] == pytest.approx(route["distance_mi"])


def test_departure_window_and_same_place():
    with pytest.raises(AnalyzeError) as caught:
        run(_payload(departure="2020-01-01T00:00"), FixtureProvider(), FlatWeather(10), now=NOW)
    assert caught.value.code == "departure_out_of_range"
    same = _payload()
    same["destination"] = dict(same["origin"])
    with pytest.raises(AnalyzeError) as caught:
        run(same, FixtureProvider(), FlatWeather(10), now=NOW)
    assert caught.value.status == 400


def test_views_health_and_analyze():
    factory = APIRequestFactory()
    health = HealthView.as_view()(factory.get("/api/health"))
    assert health.status_code == 200
    assert health.data["status"] == "ok"
    view = AnalyzeView.as_view()
    request = factory.post("/api/analyze", _payload(), format="json")
    # The live view builds its own weather client. Point the provider at the fixture
    # by clearing the key, and stub the network inside OpenMeteo via the cache path
    # is not available here, so this request may call Open-Meteo. Keep it out of the
    # unit path: only assert validation through the view.
    bad = view(factory.post("/api/analyze", {"load_lb": 1}, format="json"))
    assert bad.status_code == 400
    assert bad.data["error"]["code"] == "validation_error"
    del request


class FlatWeather:
    calls = 1
    cache_hits = 0

    def __init__(self, wind: float) -> None:
        self.wind = wind

    def fetch(self, points, start, end):
        times = [int(start.timestamp()) + hour * 3600 for hour in range(80)]
        found = {}
        for lat, lon in {(round(lat, 2), round(lon, 2)) for lat, lon in points}:
            found[(lat, lon)] = Series(
                times=times,
                wind=[self.wind] * len(times),
                gust=[80.0] * len(times),
                rain=[0.0] * len(times),
                snow=[0.0] * len(times),
            )
        return found


def _payload(load_lb=20000, departure=None):
    if departure is None:
        departure = (NOW + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M")
    return {
        "origin": {
            "label": "Chicago, Illinois, United States",
            "lat": 41.8781,
            "lon": -87.6298,
            "timezone": "America/Chicago",
            "country_code": "US",
        },
        "destination": {
            "label": "St. Louis, Missouri, United States",
            "lat": 38.6270,
            "lon": -90.1994,
            "timezone": "America/Chicago",
            "country_code": "US",
        },
        "departure": departure,
        "load_lb": load_lb,
        "sample_miles": 25,
    }
