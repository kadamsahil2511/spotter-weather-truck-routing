"""Checkpoint placement and ETAs from route step durations."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from app.geo import cumulative_miles, point_at, sample_targets
from app.routing import Step


@dataclass
class Placed:
    index: int
    lon: float
    lat: float
    mile: float
    eta: datetime
    eta_source: str


def place_checkpoints(
    coordinates: list[tuple[float, float]],
    steps: list[Step],
    duration_s: float,
    departure: datetime,
    interval: float,
) -> tuple[list[Placed], float]:
    cumulative = cumulative_miles(coordinates)
    total = cumulative[-1]
    placed: list[Placed] = []
    for index, mile in enumerate(sample_targets(total, interval)):
        (lon, lat), _ = point_at(coordinates, cumulative, mile)
        eta, source = eta_at(cumulative, steps, mile, duration_s, departure)
        placed.append(Placed(index, lon, lat, mile, eta, source))
    return placed, total


def eta_at(
    cumulative: list[float],
    steps: list[Step],
    mile: float,
    duration_s: float,
    departure: datetime,
) -> tuple[datetime, str]:
    if not steps:
        total = cumulative[-1] if cumulative else 0.0
        fraction = 0.0 if total <= 1e-9 else min(1.0, max(0.0, mile / total))
        return departure + timedelta(seconds=fraction * duration_s), "uniform"

    elapsed = 0.0
    for step in steps:
        start_index = min(max(step.start_index, 0), len(cumulative) - 1)
        end_index = min(max(step.end_index, 0), len(cumulative) - 1)
        start_mile = cumulative[start_index]
        end_mile = cumulative[end_index]
        length = end_mile - start_mile
        if length <= 1e-9:
            elapsed += step.duration_s
            continue
        if mile <= end_mile + 1e-6:
            fraction = 0.0 if mile <= start_mile else min(1.0, (mile - start_mile) / length)
            elapsed += fraction * step.duration_s
            return departure + timedelta(seconds=elapsed), "step"
        elapsed += step.duration_s
    return departure + timedelta(seconds=elapsed), "step"
