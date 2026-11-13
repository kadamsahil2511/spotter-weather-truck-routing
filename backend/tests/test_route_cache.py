import httpx
import pytest

from app.route_cache import TTL_SECONDS, cache_key
from app.routing import OrsProvider


class DictCache:
    def __init__(self, fail: bool = False) -> None:
        self.data: dict = {}
        self.fail = fail
        self.sets = 0

    def get(self, key):
        if self.fail:
            raise ConnectionError("redis down")
        return self.data.get(key)

    def set(self, key, value, timeout=None):
        if self.fail:
            raise ConnectionError("redis down")
        assert timeout == TTL_SECONDS
        self.sets += 1
        self.data[key] = value


def _body():
    return {
        "routes": [
            {
                "summary": {"distance": 1000.0, "duration": 60.0},
                "geometry": "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
                "segments": [
                    {
                        "steps": [
                            {
                                "distance": 1000.0,
                                "duration": 60.0,
                                "way_points": [0, 2],
                            }
                        ]
                    }
                ],
            }
        ]
    }


def test_route_cache_key_rounds_pins_and_load():
    left = cache_key((-87.62981, 41.87814), (-90.19944, 38.62701), 45000.4)
    right = cache_key((-87.6302, 41.8776), (-90.1991, 38.6274), 44999.6)
    assert left == right
    assert "45000" in left
    assert "driving-hgv" in left
    heavier = cache_key((-87.62981, 41.87814), (-90.19944, 38.62701), 80000)
    assert heavier != left


def test_second_trip_is_served_from_the_cache():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json=_body())

    cache = DictCache()
    provider = OrsProvider("secret", client=httpx.Client(transport=httpx.MockTransport(handler)), cache=cache)
    first = provider.routes((-87.63, 41.88), (-90.2, 38.63), 45000)
    after_first = calls["n"]
    second = provider.routes((-87.6301, 41.8801), (-90.2001, 38.6301), 45000.2)
    assert after_first >= 1
    assert calls["n"] == after_first
    assert cache.sets == 1
    assert [route.label for route in second] == [route.label for route in first]
    assert second[0].coordinates[0] == pytest.approx(first[0].coordinates[0])
    calls_after = calls["n"]
    provider.routes((-87.63, 41.88), (-90.2, 38.63), 45000)
    assert calls["n"] == calls_after


def test_dead_redis_still_returns_the_route():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_body())

    provider = OrsProvider(
        "secret",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        cache=DictCache(fail=True),
    )
    routes = provider.routes((-87.63, 41.88), (-90.2, 38.63), 20000)
    assert routes
    assert routes[0].provider == "ors-hgv"
