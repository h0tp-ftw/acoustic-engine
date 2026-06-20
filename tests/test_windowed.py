#!/usr/bin/env python3
"""Quick integration test for the windowed matcher."""

import sys

sys.path.insert(0, "src")

from acoustic_engine.analysis.event_buffer import EventBuffer
from acoustic_engine.analysis.windowed_matcher import WindowedMatcher
from acoustic_engine.events import ToneEvent
from acoustic_engine.profiles import load_profiles_from_yaml


def test_basic_imports():
    """Test that all new components import correctly."""
    print("✓ EventBuffer imported")
    print("✓ WindowedMatcher imported")
    print("✓ All imports OK!")


def test_event_buffer():
    """Test EventBuffer functionality."""
    buf = EventBuffer(max_duration=10.0)

    # Add some events
    buf.add(ToneEvent(timestamp=1.0, duration=0.5, frequency=3000, magnitude=0.8))
    buf.add(ToneEvent(timestamp=2.0, duration=0.5, frequency=3000, magnitude=0.8))
    buf.add(ToneEvent(timestamp=3.0, duration=0.5, frequency=3000, magnitude=0.8))

    assert len(buf) == 3, f"Expected 3 events, got {len(buf)}"
    print("✓ EventBuffer basic operations work")

    # Test windowing
    events = buf.get_window(3.5, 2.0)  # Get events from 1.5 to 3.5
    assert len(events) == 2, f"Expected 2 events in window, got {len(events)}"
    print("✓ EventBuffer windowing works")


def test_windowed_matcher():
    """Test WindowedMatcher with smoke alarm profile."""
    profiles = load_profiles_from_yaml("profiles/smoke_alarm_t3.yaml")
    print(f"✓ Loaded profile: {profiles[0].name}")

    matcher = WindowedMatcher(profiles)
    print("✓ WindowedMatcher initialized")
    print(f"  Window config: duration={matcher.configs[profiles[0].name].window_duration:.1f}s")
    print(f"  Eval frequency: {matcher.configs[profiles[0].name].eval_frequency:.2f}s")

    # Simulate some tone events (3 beeps for T3 pattern)
    matcher.add_event(ToneEvent(timestamp=0.5, duration=0.5, frequency=3000, magnitude=0.8))
    matcher.add_event(ToneEvent(timestamp=1.2, duration=0.5, frequency=3000, magnitude=0.8))
    matcher.add_event(ToneEvent(timestamp=1.9, duration=0.5, frequency=3000, magnitude=0.8))
    # Second cycle
    matcher.add_event(ToneEvent(timestamp=3.0, duration=0.5, frequency=3000, magnitude=0.8))
    matcher.add_event(ToneEvent(timestamp=3.7, duration=0.5, frequency=3000, magnitude=0.8))
    matcher.add_event(ToneEvent(timestamp=4.4, duration=0.5, frequency=3000, magnitude=0.8))

    print("✓ Added 6 events (2 T3 cycles)")

    # Evaluate
    matches = matcher.evaluate(5.0)
    print(f"  Matches found: {len(matches)}")

    print("✓ WindowedMatcher evaluation completed")


def test_engine_with_windowed_matcher():
    """Test that Engine uses WindowedMatcher."""
    from acoustic_engine.analysis.windowed_matcher import WindowedMatcher
    from acoustic_engine.engine import Engine

    profiles = load_profiles_from_yaml("profiles/smoke_alarm_t3.yaml")
    engine = Engine(profiles=profiles)

    assert isinstance(engine._matcher, WindowedMatcher), "Engine should use WindowedMatcher"
    print("✓ Engine correctly uses WindowedMatcher")


def _t3_profile():
    from acoustic_engine.models import AlarmProfile, Range, Segment

    def tone():
        return Segment(type="tone", frequency=Range(2900, 3100), duration=Range(0.4, 0.6))

    def sil(lo, hi):
        return Segment(type="silence", duration=Range(lo, hi))

    return AlarmProfile(
        name="T3",
        segments=[tone(), sil(0.4, 0.6), tone(), sil(0.4, 0.6), tone(), sil(1.3, 1.7)],
        confirmation_cycles=2,
    )


def _beep_cycles(gap, long_gap=1.5, beep=0.5, freq=3000.0, cycles=2):
    """Two cycles of 3 beeps, with `gap` between beeps and `long_gap` between cycles."""
    events, t = [], 0.0
    for _ in range(cycles):
        for i in range(3):
            events.append(ToneEvent(timestamp=round(t, 3), duration=beep, frequency=freq, magnitude=0.8))
            t += beep + (gap if i < 2 else long_gap)
    return events


def _matches(profile, events, at=10.0):
    matcher = WindowedMatcher([profile])
    for e in events:
        matcher.add_event(e)
    return len(matcher.evaluate(at))


def test_gap_validation_rejects_wrong_rhythm():
    """Correctly-pitched beeps at the wrong spacing must NOT match the pattern."""
    profile = _t3_profile()
    # Correct 0.5s gaps detect.
    assert _matches(profile, _beep_cycles(0.5)) == 1
    # Wrong rhythms (too fast / too slow) are rejected — the gaps don't fit.
    assert _matches(profile, _beep_cycles(0.2)) == 0
    assert _matches(profile, _beep_cycles(1.0)) == 0
    assert _matches(profile, _beep_cycles(2.0)) == 0
    print("✓ Gap validation rejects wrong rhythms")


def test_gap_validation_tolerates_reverb_smearing():
    """Reverb inflates a tone's measured duration, shrinking the following gap;
    crediting that overflow back keeps the rhythm matching (no false negative)."""
    profile = _t3_profile()
    # Tones measure 0.7s (> nominal max 0.6) so end-to-start gaps shrink to 0.3s,
    # below the relaxed floor (0.32) — yet detection must still succeed.
    events, t = [], 0.0
    for _ in range(2):
        for i in range(3):
            events.append(ToneEvent(timestamp=round(t, 3), duration=0.7, frequency=3000, magnitude=0.8))
            t += 0.7 + (0.3 if i < 2 else 1.3)
    assert _matches(profile, events) == 1
    print("✓ Gap validation tolerates reverb-smeared gaps")


def main():
    print("=" * 50)
    print("Windowed Matcher Integration Tests")
    print("=" * 50)
    print()

    test_basic_imports()
    print()

    test_event_buffer()
    print()

    test_windowed_matcher()
    print()

    test_engine_with_windowed_matcher()
    print()

    print("=" * 50)
    print("All tests passed! ✓")
    print("=" * 50)


if __name__ == "__main__":
    main()
