"""Weather classes and the brief's route order.

Wind in every rule is sustained speed. Gusts never reach this module.
"""

from __future__ import annotations

from dataclasses import dataclass

LEVELS = ("low", "moderate", "high", "severe", "no_travel")
SCORE = {level: index + 1 for index, level in enumerate(LEVELS)}
LEVEL_INDEX = {level: index for index, level in enumerate(LEVELS)}


def classify_wind(mph: float) -> str:
    if mph >= 55:
        return "no_travel"
    if mph >= 45:
        return "severe"
    if mph >= 35:
        return "high"
    if mph >= 25:
        return "moderate"
    return "low"


def classify_rain(inches: float) -> str:
    if inches > 1.0:
        return "no_travel"
    if inches >= 0.50:
        return "severe"
    if inches >= 0.25:
        return "high"
    if inches >= 0.10:
        return "moderate"
    return "low"


def classify_snow(inches: float) -> str:
    if inches > 3.0:
        return "no_travel"
    if inches >= 2.0:
        return "severe"
    if inches >= 1.0:
        return "high"
    if inches >= 0.5:
        return "moderate"
    return "low"


def apply_load(wind_mph: float, load_lb: float) -> tuple[str, str | None]:
    """Load rules use the same sustained wind number as the wind table."""
    level = classify_wind(wind_mph)
    if wind_mph >= 55:
        return level, None
    if 45 <= wind_mph < 55 and load_lb > 30_000:
        return "no_travel", "45mph_over_30000"
    if 35 <= wind_mph < 45 and load_lb > 40_000:
        return "severe", "35mph_over_40000"
    return level, None


def worse(left: str, right: str) -> str:
    if left == "unknown" or right == "unknown":
        return "unknown"
    return left if SCORE[left] >= SCORE[right] else right


def combine(
    wind_level: str | None, rain_level: str | None, snow_level: str | None
) -> tuple[str, bool]:
    votes = []
    partial = False
    for level in (wind_level, rain_level, snow_level):
        if level is None:
            partial = True
            continue
        votes.append(level)
    if not votes:
        return "unknown", True
    chosen = votes[0]
    for level in votes[1:]:
        chosen = worse(chosen, level)
    return chosen, partial


@dataclass
class Summary:
    no_travel_mi: float
    severe_mi: float
    high_mi: float
    moderate_mi: float
    low_mi: float
    unknown_mi: float
    avg_risk: float | None
    incomplete: bool

    @property
    def known_mi(self) -> float:
        return self.low_mi + self.moderate_mi + self.high_mi + self.severe_mi + self.no_travel_mi


def summarize_segments(levels_and_miles: list[tuple[str, float]]) -> Summary:
    """`levels_and_miles` is (level at checkpoint, mile along the route)."""
    buckets = {level: 0.0 for level in LEVELS}
    unknown = 0.0
    for (level_a, mile_a), (level_b, mile_b) in zip(levels_and_miles, levels_and_miles[1:]):
        length = max(0.0, mile_b - mile_a)
        segment = "unknown" if level_a == "unknown" or level_b == "unknown" else worse(level_a, level_b)
        if segment == "unknown":
            unknown += length
        else:
            buckets[segment] += length
    known = sum(buckets.values())
    average = None if known <= 1e-9 else sum(SCORE[level] * buckets[level] for level in LEVELS) / known
    return Summary(
        no_travel_mi=buckets["no_travel"],
        severe_mi=buckets["severe"],
        high_mi=buckets["high"],
        moderate_mi=buckets["moderate"],
        low_mi=buckets["low"],
        unknown_mi=unknown,
        avg_risk=average,
        incomplete=unknown > 0.05,
    )


@dataclass
class Ranked:
    id: str
    duration_s: float
    summary: Summary
    label: str = ""


@dataclass
class Recommendation:
    route_id: str
    decided_by: str
    confidence: str
    explanation: str


def _mile_key(value: float) -> float:
    return round(value, 1)


def _avg_key(summary: Summary) -> float:
    if summary.avg_risk is None:
        return 999.0
    return round(summary.avg_risk, 2)


def recommend(routes: list[Ranked]) -> Recommendation | None:
    """Brief order, then id. Routes with no classifiable miles stay out when any route has data."""
    usable = [route for route in routes if route.summary.known_mi > 0.05]
    if not usable:
        return None
    ordered = sorted(
        usable,
        key=lambda route: (
            _mile_key(route.summary.severe_mi),
            _mile_key(route.summary.high_mi),
            _avg_key(route.summary),
            route.duration_s,
            route.id,
        ),
    )
    winner = ordered[0]
    runner = ordered[1] if len(ordered) > 1 else None
    decided_by, explanation = _explain(winner, runner)
    confidence = "partial" if winner.summary.incomplete else "full"
    return Recommendation(winner.id, decided_by, confidence, explanation)


def _format_key(key: str, value: float) -> str:
    if key != "duration_s":
        return f"{value:g}"
    seconds = int(value)
    hours, minutes = divmod(seconds // 60, 60)
    return f"{hours} h {minutes} min"


def _explain(winner: Ranked, runner: Ranked | None) -> tuple[str, str]:
    winner_name = winner.label or winner.id
    runner_name = runner.label or runner.id if runner else ""
    if runner is None:
        return (
            "only_route",
            (
                f"{winner_name} is the only route with weather. "
                f"{_mile_key(winner.summary.severe_mi):.1f} severe miles, "
                f"{_mile_key(winner.summary.high_mi):.1f} high miles."
            ),
        )
    checks = (
        ("severe_mi", _mile_key(winner.summary.severe_mi), _mile_key(runner.summary.severe_mi), "severe miles"),
        ("high_mi", _mile_key(winner.summary.high_mi), _mile_key(runner.summary.high_mi), "high miles"),
        ("avg_risk", _avg_key(winner.summary), _avg_key(runner.summary), "average risk"),
        ("duration_s", round(winner.duration_s), round(runner.duration_s), "travel time"),
    )
    for key, left, right, label in checks:
        if left != right:
            return key, f"{winner_name} has {_format_key(key, left)} {label} versus {_format_key(key, right)} on {runner_name}."
    return "id", f"{winner_name} ties {runner_name} on the brief's keys. Stable id order picks {winner.id}."
