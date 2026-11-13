import pytest

from app.risk import (
    Ranked,
    align_display,
    apply_load,
    classify_rain,
    classify_snow,
    classify_wind,
    combine,
    recommend,
    summarize_segments,
)


@pytest.mark.parametrize(
    "mph, level",
    [
        (24.9, "low"),
        (25, "moderate"),
        (34.9, "moderate"),
        (35, "high"),
        (44.9, "high"),
        (45, "severe"),
        (54.9, "severe"),
        (55, "no_travel"),
        (70, "no_travel"),
    ],
)
def test_wind_edges(mph, level):
    assert classify_wind(mph) == level


@pytest.mark.parametrize(
    "inches, level",
    [
        (0.09, "low"),
        (0.10, "moderate"),
        (0.249, "moderate"),
        (0.25, "high"),
        (0.499, "high"),
        (0.50, "severe"),
        (1.00, "severe"),
        (1.01, "no_travel"),
    ],
)
def test_rain_edges(inches, level):
    assert classify_rain(inches) == level


@pytest.mark.parametrize(
    "inches, level",
    [
        (0.49, "low"),
        (0.5, "moderate"),
        (0.99, "moderate"),
        (1.0, "high"),
        (1.99, "high"),
        (2.0, "severe"),
        (3.0, "severe"),
        (3.01, "no_travel"),
    ],
)
def test_snow_edges(inches, level):
    assert classify_snow(inches) == level


def test_load_boundaries_are_strict():
    assert apply_load(50, 30000) == ("severe", None)
    assert apply_load(50, 30000.01) == ("no_travel", "45mph_over_30000")
    assert apply_load(40, 40000) == ("high", None)
    assert apply_load(40, 40000.01) == ("severe", "35mph_over_40000")
    assert apply_load(54.9, 30000)[0] == "severe"
    assert apply_load(55, 80000) == ("no_travel", None)
    assert apply_load(20, 80000) == ("low", None)
    assert apply_load(44.999, 45000) == ("severe", "35mph_over_40000")
    assert apply_load(45, 45000) == ("no_travel", "45mph_over_30000")


def test_combine_takes_the_worst_and_ignores_null():
    assert combine("severe", "low", "low")[0] == "severe"
    level, partial = combine("high", None, "low")
    assert level == "high"
    assert partial is True
    assert combine(None, None, None) == ("unknown", True)


def test_display_miles_sum_to_the_route_distance():
    miles, summary = align_display(["low", "severe", "low"], [0, 10.04, 25.26], 30.0)
    buckets = (
        summary.low_mi
        + summary.moderate_mi
        + summary.high_mi
        + summary.severe_mi
        + summary.no_travel_mi
        + summary.unknown_mi
    )
    assert miles[-1] == 30.0
    assert buckets == pytest.approx(30.0)
    assert summary.severe_mi > 0


def test_segment_uses_the_worse_endpoint():
    summary = summarize_segments([("low", 0), ("severe", 10), ("low", 20)])
    assert summary.severe_mi == pytest.approx(20)
    assert summary.avg_risk == pytest.approx(4)


def test_brief_order_picks_fewest_severe_miles_even_with_no_travel():
    routes = [
        _ranked("A", no_travel=0, severe=10, high=5, avg=2.0, hours=5),
        _ranked("B", no_travel=0, severe=10, high=8, avg=1.2, hours=4),
        _ranked("C", no_travel=2, severe=0, high=0, avg=1.1, hours=3),
    ]
    choice = recommend(routes)
    assert choice is not None
    assert choice.route_id == "C"
    assert choice.decided_by == "severe_mi"
    assert [route.id for route in sorted(routes, key=_sort)] == ["C", "A", "B"]


def test_average_then_time_then_id():
    tied = [
        _ranked("b", no_travel=0, severe=0, high=0, avg=1.5, hours=4),
        _ranked("a", no_travel=0, severe=0, high=0, avg=1.5, hours=4),
    ]
    assert recommend(tied).route_id == "a"
    faster = [
        _ranked("slow", no_travel=0, severe=0, high=1, avg=1.2, hours=6),
        _ranked("fast", no_travel=0, severe=0, high=1, avg=1.2, hours=5),
    ]
    choice = recommend(faster)
    assert choice.route_id == "fast"
    assert choice.decided_by == "duration_s"
    lower_avg = [
        _ranked("calm", no_travel=0, severe=1, high=1, avg=1.4, hours=9),
        _ranked("rough", no_travel=0, severe=1, high=1, avg=2.2, hours=3),
    ]
    assert recommend(lower_avg).decided_by == "avg_risk"
    assert recommend(lower_avg).route_id == "calm"


def test_unknown_data_does_not_win_on_zeros():
    empty = _ranked("empty", no_travel=0, severe=0, high=0, avg=None, hours=1, unknown=10, known=False)
    real = _ranked("real", no_travel=0, severe=5, high=0, avg=4, hours=8)
    assert recommend([empty, real]).route_id == "real"
    assert recommend([empty]) is None


def _sort(route: Ranked):
    return (
        round(route.summary.severe_mi, 1),
        round(route.summary.high_mi, 1),
        round(route.summary.avg_risk or 999, 2),
        route.duration_s,
        route.id,
    )


def _ranked(name, no_travel, severe, high, avg, hours, unknown=0, known=True):
    from app.risk import Summary

    low = 10 if known and severe == 0 and high == 0 and no_travel == 0 else 0
    if not known:
        low = 0
    summary = Summary(
        no_travel_mi=no_travel,
        severe_mi=severe,
        high_mi=high,
        moderate_mi=0,
        low_mi=low,
        unknown_mi=unknown,
        avg_risk=avg,
        incomplete=unknown > 0,
    )
    return Ranked(name, hours * 3600, summary)
