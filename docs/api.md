# API

Base path: `/api`. The production host is `https://fsapi.kadamsahil.com`.

`GET /api/geocode`, `POST /api/analyze`, and `POST /api/recheck` share one anonymous throttle, 20 requests per minute. `GET /api/health` is not throttled. A throttle response is HTTP 429 with Django REST framework's `detail` string, which is a different shape from the `error` object below.

Application errors use this body:

```json
{
  "error": {
    "code": "validation_error",
    "message": "sample_miles must be 10, 25, or 50."
  }
}
```

`routing_unavailable` also includes `upstream_status` when OpenRouteService returned an HTTP status.

## GET /api/health

```json
{ "status": "ok" }
```

## GET /api/geocode

Query string: `q`. Fewer than 2 characters is `validation_error` (400). The view searches Open-Meteo geocoding for the United States first, then worldwide. Places with no timezone are dropped. The UI adds its own `id` after this response. The API does not send one.

```json
{
  "results": [
    {
      "label": "Chicago, Illinois, United States",
      "lat": 41.85,
      "lon": -87.65,
      "country_code": "US",
      "timezone": "America/Chicago"
    }
  ]
}
```

| Status | code | When |
| --- | --- | --- |
| 400 | `validation_error` | `q` is missing or shorter than 2 characters. |
| 404 | `geocode_not_found` | No place came back. The UI treats this as an empty list. |
| 503 | `geocode_unavailable` | The geocoder could not be reached. |

## POST /api/analyze and POST /api/recheck

Both URLs call `AnalyzeView`. The body, the pipeline, and the response are the same. Follow mode posts the truck's current position as `origin`, the original destination, and the current time as `departure`.

### Request

```json
{
  "origin": {
    "label": "Chicago, Illinois, United States",
    "lat": 41.8781,
    "lon": -87.6298,
    "timezone": "America/Chicago",
    "country_code": "US"
  },
  "destination": {
    "label": "St. Louis, Missouri, United States",
    "lat": 38.627,
    "lon": -90.1994,
    "timezone": "America/Chicago",
    "country_code": "US"
  },
  "departure": "2026-11-13T20:00:00",
  "load_lb": 45000,
  "sample_miles": 25
}
```

`origin` and `destination` need `label`, `lat`, and `lon`. `origin.timezone` is required and must be an IANA name. A `departure` with no offset is read in that timezone. A `departure` that already has an offset keeps it. `country_code` is optional. A code other than `US` adds the warning `non_us`.

`sample_miles` is the integer `10`, `25`, or `50`. `load_lb` is a number greater than 0 and at most 200000. The two pins must be at least 1 mile apart. Departure must fall in the last 6 hours or the next 14 days.

### Response

The block below has every field. Geometry and the checkpoint list are shortened so the example stays readable. A live route has the full Douglas-Peucker polyline and one checkpoint per sample, including the end of the route.

```json
{
  "units": {
    "distance": "mi",
    "duration": "s",
    "wind": "mph",
    "rain": "in/hr",
    "snow": "in/hr",
    "load": "lb",
    "coordinates": "[lon, lat]",
    "time": "utc iso8601",
    "avg_risk": "1 low, 2 moderate, 3 high, 4 severe, 5 no_travel"
  },
  "assumptions": {
    "tare_lb": 35000,
    "height_m": 4.0,
    "width_m": 2.6,
    "wind_field": "sustained"
  },
  "routes": [
    {
      "id": "via-east",
      "label": "Via east",
      "recommended": true,
      "provider": "ors",
      "truck_profile": true,
      "distance_mi": 296.0,
      "duration_s": 18720,
      "geometry": [[-87.6298, 41.8781], [-88.1, 40.9], [-90.1994, 38.627]],
      "summary": {
        "no_travel_mi": 0.0,
        "severe_mi": 0.0,
        "high_mi": 0.0,
        "moderate_mi": 100.0,
        "low_mi": 196.0,
        "unknown_mi": 0.0,
        "avg_risk": 1.34,
        "incomplete": false
      },
      "checkpoints": [
        {
          "index": 0,
          "lon": -87.6298,
          "lat": 41.8781,
          "mile": 0.0,
          "eta": "2026-11-14T02:00:00Z",
          "eta_source": "steps",
          "weather": {
            "wind_mph": 18.0,
            "gust_mph": 28.0,
            "wind_used_mph": 18.0,
            "rain_in_hr": 0.0,
            "snow_in_hr": 0.0,
            "matched": "hour"
          },
          "risk": {
            "level": "low",
            "wind": "low",
            "rain": "low",
            "snow": "low",
            "load_adjustment": null,
            "partial": false
          }
        }
      ],
      "warnings": []
    }
  ],
  "recommendation": {
    "route_id": "via-east",
    "decided_by": "severe_mi",
    "confidence": "full",
    "explanation": "Via east has 0 severe miles versus 50 on Direct."
  },
  "heatmap": {
    "anchor": "2026-11-14T02:00:00Z",
    "hour_count": 49,
    "points": [[-87.63, 41.88], [-90.2, 38.63]],
    "levels": [[0, 1], [1, 2]]
  },
  "warnings": [],
  "meta": {
    "routing_calls": 4,
    "weather_calls": 2,
    "cache_hits": 0
  }
}
```

`routes` is ordered with the recommended route first, then shorter `duration_s`, then `id`. That display order is separate from the ranker. The ranker still picks `recommendation.route_id` by Severe miles, High miles, average risk, time, then id. `recommended` on a route is true only for that id.

`wind_used_mph` is the sustained wind. `gust_mph` is present for display. Segment miles use the worse of the two checkpoint levels. `summary` miles add up to `distance_mi`. `avg_risk` is the mile-weighted score from the `units.avg_risk` scale, or null when no miles could be classed. `incomplete` is true when `unknown_mi` is above 0.05. `confidence` is `partial` in that case and `full` otherwise.

`recommendation` is null when no route has classifiable miles. `decided_by` is one of `severe_mi`, `high_mi`, `avg_risk`, `duration_s`, `id`, or `only_route`.

`heatmap.anchor` is the departure hour in UTC, or the current hour when departure is more than an hour behind now (`heatmap_anchored_now`). `hour_count` is 49. `points` are `[lon, lat]`. Each row of `levels` is one hour. A cell is `0` low, `1` moderate, `2` high, `3` severe, `4` no travel, or `null` when that point has no class. The heatmap is a display. Checkpoint risk stays matched to each arrival.

`eta_source` is `steps` when the provider sent step durations, and `uniform` otherwise (route warning `eta_uniform`). `weather.matched` describes how the forecast hour was chosen. `risk.partial` is true when a weather field was missing or the match had to use a neighboring hour. `load_adjustment` is `45mph_over_30000`, `35mph_over_40000`, or null.

`provider` is `ors`, `osrm`, or `fixture`. `truck_profile` is false when the truck restrictions were dropped to find a road.

Top-level `warnings` repeat a few route warnings so the client can show them once: `routing_fixture`, `weight_restriction_relaxed`, `truck_profile_unavailable`, `partial_routes` (fewer than three routes), `non_us`, `heatmap_anchored_now`, `weather_unavailable`, `weather_partial`.

A route's own `warnings` can also include `eta_uniform`, `distance_mismatch` (polyline miles and provider miles differ by more than 5 percent), and `no_travel`.

### Error codes

| Status | code | When |
| --- | --- | --- |
| 400 | `validation_error` | Body is not an object, a place is incomplete, the pins are under 1 mile apart, `sample_miles` is not 10, 25, or 50, `load_lb` is out of range, or the departure string or origin timezone cannot be read. |
| 422 | `departure_out_of_range` | Departure is outside the last 6 hours and the next 14 days. |
| 422 | `point_not_routable` | A pin cannot be tied to the road network. |
| 422 | `no_route` | Nothing drivable was found. |
| 503 | `routing_unavailable` | OpenRouteService failed. `upstream_status` is set when the provider returned one. |
| 429 | | Throttled. Body is `{"detail": "..."}`. |
