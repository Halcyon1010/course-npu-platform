"""Reference forecast for one healthy FIFO pool of interchangeable single cards.

Times are minutes from a single snapshot. Run directly for reproducible examples.
"""

from bisect import bisect_right
from dataclasses import dataclass
from heapq import heapify, heapreplace
from math import ceil, isfinite
from random import Random


@dataclass(frozen=True)
class StartEstimate:
    position: int
    p10: float
    p50: float
    p90: float


def forecast(free_cards, running, queue, history, *, trials=200, seed=42):
    """Return start estimates in FIFO order, or None if a forecast is unavailable.

    running contains (job_class, elapsed_minutes) for occupied reusable cards.
    queue contains job classes in dispatch order. history maps classes to
    observed card-occupancy durations, including startup and cleanup.
    """
    if type(free_cards) is not int or free_cards < 0 or trials < 1:
        raise ValueError("invalid card or trial count")
    if not queue:
        return []
    if free_cards >= len(queue):
        return [StartEstimate(i + 1, 0, 0, 0) for i in range(len(queue))]
    if not running and free_cards == 0:
        return None
    samples = {}
    for kind, durations in history.items():
        if any(not isfinite(value) or value <= 0 for value in durations):
            raise ValueError("occupancy samples must be finite and positive")
        samples[kind] = sorted(durations)

    busy = []
    for kind, elapsed in running:
        if not isfinite(elapsed) or elapsed < 0:
            raise ValueError("elapsed time must be finite and nonnegative")
        durations = samples.get(kind, [])
        first = bisect_right(durations, elapsed)
        if first == len(durations):
            return None
        busy.append((durations, first, elapsed))
    if any(not samples.get(kind) for kind in queue[:-1]):
        return None

    rng = Random(seed)
    starts = [[] for _ in queue]
    for _ in range(trials):
        available = [0.0] * free_cards
        for durations, first, elapsed in busy:
            available.append(durations[rng.randrange(first, len(durations))] - elapsed)
        heapify(available)
        for index, kind in enumerate(queue):
            start = available[0]
            starts[index].append(start)
            if index + 1 < len(queue):
                heapreplace(available, start + rng.choice(samples[kind]))

    estimates = []
    for position, values in enumerate(starts, start=1):
        values.sort()
        quantiles = [values[ceil(q * trials) - 1] for q in (0.1, 0.5, 0.9)]
        estimates.append(StartEstimate(position, *quantiles))
    return estimates


def demo():
    for cards in (64, 48):
        estimates = forecast(cards, [], ["course"] * 1000, {"course": [20]})
        last = estimates[-1]
        print(f"{cards} cards, 1000 jobs, 20 min/job: last start {last.p50:g} min, "
              f"last finish {last.p50 + 20:g} min")
    estimates = forecast(0, [("known", 18), ("known", 3)], ["known"] * 3,
                         {"known": [5, 10, 20, 30, 60]})
    for point in estimates:
        print(f"Mixed durations, position {point.position}: "
              f"P10/P50/P90 = {point.p10:g}/{point.p50:g}/{point.p90:g} min")


if __name__ == "__main__":
    demo()
