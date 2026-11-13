from datetime import datetime, timezone

import pytest

from app.geo import cumulative_miles, destination, sample_targets
from app.routing import Step
from app.sampling import eta_at, place_checkpoints


def _north(miles: int):
    coords = [(-90.0, 40.0)]
    for _ in range(miles):
        coords.append(destination(coords[-1][0], coords[-1][1], 0, 1))
    return coords


def test_sample_miles_include_the_end_and_skip_nothing_on_a_short_route():
    assert sample_targets(60, 25) == pytest.approx([0, 25, 50, 60])
    assert sample_targets(12, 50) == pytest.approx([0, 12])
    placed, total = place_checkpoints(_north(60), [], 3600, _departure(), 25)
    assert total == pytest.approx(60, abs=0.05)
    assert [point.mile for point in placed] == pytest.approx([0, 25, 50, 60], abs=0.05)
    short, _ = place_checkpoints(_north(12), [], 600, _departure(), 50)
    assert len(short) == 2


def test_eta_uses_step_durations_not_the_trip_average():
    coords = _north(20)
    cumulative = cumulative_miles(coords)
    steps = [
        Step(distance_m=1609.344 * 10, duration_s=600, start_index=0, end_index=10),
        Step(distance_m=1609.344 * 10, duration_s=1200, start_index=10, end_index=20),
    ]
    eta, source = eta_at(cumulative, steps, 15, 1800, _departure())
    assert source == "step"
    assert (eta - _departure()).total_seconds() == pytest.approx(1200, abs=2)
    assert (eta - _departure()).total_seconds() != pytest.approx(900, abs=2)


def test_zero_length_step_is_added_before_the_next_movement():
    coords = _north(10)
    cumulative = cumulative_miles(coords)
    steps = [
        Step(0, 100, 0, 0),
        Step(1609.344 * 10, 600, 0, 10),
    ]
    eta, _ = eta_at(cumulative, steps, 5, 700, _departure())
    assert (eta - _departure()).total_seconds() == pytest.approx(100 + 300, abs=2)


def _departure():
    return datetime(2026, 11, 16, 12, 0, tzinfo=timezone.utc)
