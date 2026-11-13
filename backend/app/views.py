import httpx
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from app.analyze import AnalyzeError, run
from app.routing import get_provider
from app.weather import OpenMeteoClient

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"


class HealthView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = []

    def get(self, request):
        return Response({"status": "ok"})


class GeocodeView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [AnonRateThrottle]

    def get(self, request):
        query = (request.query_params.get("q") or "").strip()
        if len(query) < 2:
            return _error("validation_error", "Enter at least 2 characters.", 400)
        try:
            results = geocode(query)
        except httpx.HTTPError:
            return _error("geocode_unavailable", "Place search is unavailable.", 503)
        if not results:
            return _error("geocode_not_found", "No matching place.", 404)
        return Response({"results": results})


class AnalyzeView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [AnonRateThrottle]

    def post(self, request):
        try:
            from django.core.cache import cache

            payload = run(request.data, get_provider(cache), OpenMeteoClient(cache=cache))
        except AnalyzeError as exc:
            return _error(exc.code, exc.message, exc.status, exc.upstream_status)
        return Response(payload)


def geocode(query: str, client: httpx.Client | None = None) -> list[dict]:
    http = client or httpx.Client(timeout=10.0)
    owned = client is None

    def search(country: str | None) -> list[dict]:
        params = {"name": query, "count": 5, "language": "en", "format": "json"}
        if country:
            params["countryCode"] = country
        response = http.get(GEOCODE_URL, params=params)
        response.raise_for_status()
        return response.json().get("results") or []

    try:
        rows = search("US")
        if not rows:
            rows = search(None)
    finally:
        if owned:
            http.close()
    places = []
    for item in rows:
        timezone_name = item.get("timezone")
        if not timezone_name:
            continue
        label = ", ".join(
            part for part in (item.get("name"), item.get("admin1"), item.get("country")) if part
        )
        places.append(
            {
                "label": label,
                "lat": item["latitude"],
                "lon": item["longitude"],
                "country_code": item.get("country_code"),
                "timezone": timezone_name,
            }
        )
    return places


def _error(code: str, message: str, status: int, upstream_status: int | None = None) -> Response:
    error = {"code": code, "message": message}
    if upstream_status is not None:
        error["upstream_status"] = upstream_status
    return Response({"error": error}, status=status)
