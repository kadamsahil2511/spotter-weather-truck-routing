import json
from pathlib import Path

import httpx
import pytest

from app.geo import haversine
from app.routing import (
    FixtureProvider,
    OrsProvider,
    PointNotRoutable,
    RoutingUnavailable,
    assign_labels,
    decode_polyline,
    drop_long_detours,
    line_route,
    ors_body,
    ors_directions_url,
    parse_ors,
    parse_osrm,
    share_fraction,
)


FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "ors_sample.json"


def test_ors_directions_url_includes_openrouteservice_prefix(monkeypatch):
    monkeypatch.delenv("ORS_BASE_URL", raising=False)
    assert (
        ors_directions_url()
        == "https://api.heigit.org/openrouteservice/v2/directions/driving-hgv"
    )
    monkeypatch.setenv("ORS_BASE_URL", "https://api.openrouteservice.org")
    assert ors_directions_url() == "https://api.openrouteservice.org/v2/directions/driving-hgv"
    assert ors_directions_url("https://example.test/ors/") == "https://example.test/ors/v2/directions/driving-hgv"


def test_ors_http_error_is_routing_unavailable_not_no_route():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/v2/directions/driving-hgv")
        assert "secret-key" not in (request.url.params.get("api_key") or "")
        return httpx.Response(401, json={"error": "Invalid API key: secret-key"})

    provider = OrsProvider("secret-key", client=httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(RoutingUnavailable) as caught:
        provider.routes((-87.63, 41.88), (-90.2, 38.63), 20000)
    assert caught.value.status == 401
    assert "401" in str(caught.value)


def test_via_more_than_40_percent_longer_is_dropped():
    direct = line_route(
        [(-90.0, 40.0), (-90.0, 41.0)],
        mph=55,
        provider="ors-hgv",
        truck_profile=True,
        warnings=[],
        kind="direct",
    )
    long = line_route(
        [(-90.0, 40.0), (-88.0, 40.5), (-90.0, 41.0)],
        mph=50,
        provider="ors-hgv",
        truck_profile=True,
        warnings=[],
        kind="via",
        via=(-88.0, 40.5),
    )
    kept = drop_long_detours([direct, long])
    assert [route.kind for route in kept] == ["direct"]


def test_polyline_precision_5_known_vector():
    coords = decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")
    assert coords[0] == pytest.approx((-120.2, 38.5), abs=1e-4)
    assert coords[1] == pytest.approx((-120.95, 40.7), abs=1e-4)
    assert coords[2] == pytest.approx((-126.453, 43.252), abs=1e-4)


def test_ors_fixture_parses_steps_and_drops_instruction_text():
    routes = parse_ors(json.loads(FIXTURE.read_text()), truck_profile=True)
    assert len(routes) == 1
    assert routes[0].steps[0].start_index == 0
    assert routes[0].steps[0].end_index == 2
    assert routes[0].duration_s == 60
    assert routes[0].truck_profile is True
    assert "instruction" not in routes[0].__dict__


def test_ors_body_uses_meters_and_tare_weight():
    body = ors_body([(-87.6, 41.9), (-90.2, 38.6)], 45000, alternatives=False, restrictions=True, preference="recommended")
    assert body["units"] == "m"
    assert body["options"]["profile_params"]["restrictions"]["weight"] == pytest.approx(36.29, abs=0.01)
    assert "alternative_routes" not in body
    short = ors_body([(-87.6, 41.9), (-87.7, 41.9)], 10000, alternatives=True, restrictions=True, preference="recommended")
    assert short["alternative_routes"]["target_count"] == 3


def test_share_fraction_flags_the_same_line_and_keeps_a_shifted_one():
    line = [(-90.0, 40.0), (-90.0, 40.5), (-90.0, 41.0)]
    assert share_fraction(line, line) == pytest.approx(1)
    shifted = [(-89.7, 40.0), (-89.7, 40.5), (-89.7, 41.0)]
    assert share_fraction(line, shifted) < 0.5


def test_fixture_returns_three_labeled_routes_without_a_key():
    routes = FixtureProvider().routes((-87.6298, 41.8781), (-90.1994, 38.6270), 32000)
    assert len(routes) == 3
    assert {route.provider for route in routes} == {"fixture"}
    assert all("routing_fixture" in route.warnings for route in routes)
    assert all(route.truck_profile is False for route in routes)
    direct = next(route for route in routes if route.label == "Direct")
    assert direct.duration_s == min(route.duration_s for route in routes)
    assert haversine(*direct.coordinates[0], *direct.coordinates[-1]) > 200


def test_osrm_parser_stitches_step_geometry():
    payload = {
        "routes": [
            {
                "distance": 300,
                "duration": 40,
                "legs": [
                    {
                        "steps": [
                            {
                                "distance": 100,
                                "duration": 10,
                                "geometry": {"coordinates": [[0, 0], [1, 0]]},
                            },
                            {
                                "distance": 200,
                                "duration": 30,
                                "geometry": {"coordinates": [[1, 0], [1, 1]]},
                            },
                        ]
                    }
                ],
            }
        ]
    }
    route = parse_osrm(payload)[0]
    assert route.coordinates == [(0, 0), (1, 0), (1, 1)]
    assert route.steps[1].start_index == 1
    assert route.truck_profile is False


def test_ors_provider_falls_back_to_vias_when_alternatives_are_rejected(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if "alternative_routes" in body:
            return httpx.Response(400, json={"error": "too long"})
        coords = body["coordinates"]
        geometry = _tiny_polyline(coords)
        return httpx.Response(
            200,
            json={
                "routes": [
                    {
                        "summary": {"distance": 50000, "duration": 3000},
                        "geometry": geometry,
                        "segments": [
                            {"steps": [{"distance": 50000, "duration": 3000, "way_points": [0, 1]}]}
                        ],
                    }
                ]
            },
        )

    provider = OrsProvider("test-key", client=httpx.Client(transport=httpx.MockTransport(handler)))
    routes = provider.routes((-87.63, 41.88), (-87.70, 41.90), 20000)
    assert routes
    assert provider.calls >= 2
    assert all(route.provider == "ors-hgv" for route in routes)


def test_shortest_preference_is_labeled_by_distance():
    route = line_route(
        [(-90.0, 40.0), (-90.0, 41.0)],
        mph=40,
        provider="ors-hgv",
        truck_profile=True,
        warnings=[],
        kind="shortest",
    )
    direct = line_route(
        [(-90.0, 40.0), (-90.2, 41.0)],
        mph=55,
        provider="ors-hgv",
        truck_profile=True,
        warnings=[],
        kind="direct",
    )
    labeled = assign_labels([direct, route])
    assert any(item.label == "Shortest distance" for item in labeled)


def test_unroutable_pin_retries_wider_radiuses_then_names_the_endpoint():
    seen: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(body.get("radiuses"))
        if body.get("radiuses") == [5000.0, 5000.0] or body.get("radiuses") == [5000, 5000]:
            geometry = _tiny_polyline(body["coordinates"])
            return httpx.Response(
                200,
                json={
                    "routes": [
                        {
                            "summary": {"distance": 8000, "duration": 600},
                            "geometry": geometry,
                            "segments": [
                                {"steps": [{"distance": 8000, "duration": 600, "way_points": [0, 1]}]}
                            ],
                        }
                    ]
                },
            )
        return httpx.Response(
            404,
            json={
                "error": {
                    "code": 2010,
                    "message": "Could not find routable point within a radius of 350.0 meters of specified coordinate 0: -106.3 42.8.",
                }
            },
        )

    provider = OrsProvider("test-key", client=httpx.Client(transport=httpx.MockTransport(handler)))
    routes = provider.routes((-106.31, 42.85), (-106.25, 42.90), 20000)
    assert routes
    assert [2000.0, 2000.0] in seen
    assert [5000.0, 5000.0] in seen


def test_unroutable_destination_raises_after_both_radiuses():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            404,
            json={
                "error": {
                    "code": 2010,
                    "message": "Could not find routable point within a radius of 5000.0 meters of specified coordinate 1: -106.3 42.8.",
                }
            },
        )

    provider = OrsProvider("test-key", client=httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(PointNotRoutable) as caught:
        provider.routes((-106.31, 42.85), (-106.25, 42.90), 20000)
    assert caught.value.endpoint == "destination"


def test_via_snap_miss_is_skipped():
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if len(body["coordinates"]) > 2:
            return httpx.Response(
                404,
                json={"error": {"code": 2010, "message": "specified coordinate 1: -90 40."}},
            )
        geometry = _tiny_polyline(body["coordinates"])
        return httpx.Response(
            200,
            json={
                "routes": [
                    {
                        "summary": {"distance": 400000, "duration": 18000},
                        "geometry": geometry,
                        "segments": [
                            {"steps": [{"distance": 400000, "duration": 18000, "way_points": [0, 1]}]}
                        ],
                    }
                ]
            },
        )

    provider = OrsProvider("test-key", client=httpx.Client(transport=httpx.MockTransport(handler)))
    routes = provider.routes((-87.6298, 41.8781), (-90.1994, 38.627), 32000)
    assert any(route.label == "Direct" for route in routes)
    assert all(route.kind != "via" for route in routes)


def _tiny_polyline(coords):
    # Build a precision-5 polyline from the requested coordinates only.
    encoded = []
    prev_lat = 0
    prev_lon = 0
    for lon, lat in coords:
        ilat = int(round(lat * 1e5))
        ilon = int(round(lon * 1e5))
        encoded.append(_enc(ilat - prev_lat))
        encoded.append(_enc(ilon - prev_lon))
        prev_lat, prev_lon = ilat, ilon
    return "".join(encoded)


def _enc(value: int) -> str:
    value = ~(value << 1) if value < 0 else value << 1
    chunks = []
    while value >= 0x20:
        chunks.append(chr((0x20 | (value & 0x1F)) + 63))
        value >>= 5
    chunks.append(chr(value + 63))
    return "".join(chunks)
