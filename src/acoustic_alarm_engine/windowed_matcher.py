"""Windowed pattern matcher using sliding window analysis.

This replaces the sequential SequenceMatcher with a more robust approach:
1. Collect ALL relevant frequency hits as discrete events
2. Periodically evaluate sliding windows of events
3. Pattern matching looks for best fit within window, ignoring noise
"""

import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from acoustic_alarm_engine.event_buffer import EventBuffer
from acoustic_alarm_engine.events import PatternMatchEvent, ToneEvent
from acoustic_alarm_engine.models import AlarmProfile

logger = logging.getLogger(__name__)


@dataclass
class WindowConfig:
    """Configuration for windowed matching of a profile."""

    window_duration: float  # Total window size in seconds
    eval_frequency: float  # How often to evaluate (seconds)
    pattern_duration: float  # Expected duration of one pattern cycle


class WindowedMatcher:
    """Pattern matcher using sliding window analysis.

    Instead of processing events sequentially and maintaining state,
    this matcher:
    1. Buffers all events
    2. Periodically evaluates sliding windows
    3. Tries to find patterns within each window

    This is much more robust to noise because leading/trailing noise
    events are simply ignored when searching for the pattern.
    """

    def __init__(self, profiles: List[AlarmProfile]):
        """Initialize with profiles to match against.

        Args:
            profiles: List of AlarmProfile patterns to detect
        """
        self.profiles = profiles
        self.event_buffer = EventBuffer(max_duration=60.0)  # Keep 60s of history

        # Per-profile configuration and state
        self.configs: Dict[str, WindowConfig] = {}
        self.last_eval_times: Dict[str, float] = {}
        self.cycle_counts: Dict[str, int] = {}
        self.last_match_times: Dict[str, float] = {}  # Prevent duplicate detections

        for profile in profiles:
            config = self._compute_config(profile)
            self.configs[profile.name] = config
            self.last_eval_times[profile.name] = 0.0
            self.cycle_counts[profile.name] = 0
            self.last_match_times[profile.name] = -999.0  # Long ago

            logger.debug(
                f"[{profile.name}] Window config: duration={config.window_duration:.1f}s, "
                f"eval_freq={config.eval_frequency:.2f}s, pattern={config.pattern_duration:.2f}s"
            )

    def _compute_config(self, profile: AlarmProfile) -> WindowConfig:
        """Compute window configuration for a profile.

        If profile specifies window_duration, use it.
        Otherwise, auto-calculate based on segment durations.
        """
        # Calculate expected pattern duration (sum of all segment mean durations)
        pattern_duration = 0.0
        for seg in profile.segments:
            pattern_duration += (seg.duration.min + seg.duration.max) / 2

        # Window should be large enough to capture confirmation_cycles patterns
        # plus some buffer for noise
        min_window = pattern_duration * profile.confirmation_cycles

        # Use profile's window_duration if set, otherwise auto-calculate
        window_duration = getattr(profile, "window_duration", None)
        if window_duration is None:
            # Window = pattern_duration * cycles * 1.5 (for buffer)
            window_duration = min_window * 1.5

        # Use profile's eval_frequency if set, otherwise auto-calculate
        eval_frequency = getattr(profile, "eval_frequency", None)
        if eval_frequency is None:
            # Evaluate more frequently for shorter patterns
            eval_frequency = min(0.5, pattern_duration / 4)

        return WindowConfig(
            window_duration=window_duration,
            eval_frequency=eval_frequency,
            pattern_duration=pattern_duration,
        )

    def add_event(self, event: ToneEvent) -> None:
        """Add a new event to the buffer.

        Args:
            event: ToneEvent to buffer
        """
        self.event_buffer.add(event)
        logger.debug(f"Buffered event: {event.frequency:.0f}Hz at t={event.timestamp:.2f}s")

    def evaluate(self, current_time: float) -> List[PatternMatchEvent]:
        """Evaluate all profiles and return any matches.

        This should be called periodically (e.g., after each audio chunk).
        It will only actually evaluate profiles when their eval_frequency
        interval has elapsed.

        Args:
            current_time: Current time in seconds

        Returns:
            List of PatternMatchEvent for any detected patterns
        """
        matches = []

        for profile in self.profiles:
            config = self.configs[profile.name]
            last_eval = self.last_eval_times[profile.name]

            # Only evaluate if enough time has passed
            if current_time - last_eval < config.eval_frequency:
                continue

            self.last_eval_times[profile.name] = current_time

            # Get events in the current window
            window_events = self.event_buffer.get_window(current_time, config.window_duration)

            if not window_events:
                continue

            # Try to match pattern in window
            match = self._match_pattern_in_window(window_events, profile, current_time)
            if match:
                matches.append(match)

        return matches

    def _match_pattern_in_window(
        self,
        events: List[ToneEvent],
        profile: AlarmProfile,
        current_time: float,
    ) -> Optional[PatternMatchEvent]:
        """Check if events in window match the profile pattern.

        The algorithm:
        1. Filter events to only those matching profile's frequency ranges
        2. Find sequences of events that match the expected tone-silence pattern
        3. If enough cycles are found, return a match

        Args:
            events: Events in the current window
            profile: Profile to match against
            current_time: Current time for the match event

        Returns:
            PatternMatchEvent if pattern found, None otherwise
        """
        config = self.configs[profile.name]

        # Build list of valid frequency ranges from profile
        freq_ranges: List[Tuple[float, float]] = []
        for seg in profile.segments:
            if seg.type == "tone" and seg.frequency:
                freq_ranges.append((seg.frequency.min, seg.frequency.max))

        if not freq_ranges:
            return None

        # Filter events to only those in valid frequency ranges
        relevant_events = []
        for event in events:
            for fmin, fmax in freq_ranges:
                if fmin <= event.frequency <= fmax:
                    relevant_events.append(event)
                    break

        if not relevant_events:
            return None

        # Sort by timestamp
        relevant_events.sort(key=lambda e: e.timestamp)

        logger.debug(
            f"[{profile.name}] Evaluating {len(relevant_events)} relevant events in window"
        )

        # Try to find pattern starting from each event
        best_cycles = 0

        for start_idx in range(len(relevant_events)):
            cycles = self._count_pattern_cycles(relevant_events[start_idx:], profile)
            if cycles > best_cycles:
                best_cycles = cycles

        # Check if we have enough cycles
        if best_cycles >= profile.confirmation_cycles:
            # Prevent duplicate detections (must be at least pattern_duration since last)
            last_match = self.last_match_times[profile.name]
            if current_time - last_match < config.pattern_duration:
                logger.debug(f"[{profile.name}] Suppressing duplicate detection")
                return None

            self.last_match_times[profile.name] = current_time

            logger.info(f"[{profile.name}] Pattern matched! {best_cycles} cycles found")

            return PatternMatchEvent(
                timestamp=current_time,
                duration=config.pattern_duration * best_cycles,
                profile_name=profile.name,
                cycle_count=best_cycles,
            )

        return None

    def _count_pattern_cycles(
        self,
        events: List[ToneEvent],
        profile: AlarmProfile,
    ) -> int:
        """Count how many complete pattern cycles match from the start.

        Args:
            events: Sequence of events to check (already filtered by frequency)
            profile: Profile defining the pattern

        Returns:
            Number of complete cycles matched
        """
        if not events:
            return 0

        # Extract tone segments from profile
        tone_segments = [s for s in profile.segments if s.type == "tone"]
        silence_segments = [s for s in profile.segments if s.type == "silence"]

        if not tone_segments:
            return 0

        cycle_count = 0
        event_idx = 0

        # Try to match complete cycles
        while event_idx < len(events):
            cycle_matched = True

            for seg_idx, tone_seg in enumerate(tone_segments):
                if event_idx >= len(events):
                    cycle_matched = False
                    break

                event = events[event_idx]

                # Check if this event matches the expected tone
                if not (tone_seg.frequency and tone_seg.frequency.contains(event.frequency)):
                    cycle_matched = False
                    break

                # Check duration (with some tolerance)
                if not tone_seg.duration.contains(event.duration):
                    # Allow some flexibility - within 50% of range
                    dur_min = tone_seg.duration.min * 0.5
                    dur_max = tone_seg.duration.max * 1.5
                    if not (dur_min <= event.duration <= dur_max):
                        cycle_matched = False
                        break

                # Check silence gap to next event (if not last tone in cycle)
                if seg_idx < len(tone_segments) - 1 and event_idx + 1 < len(events):
                    next_event = events[event_idx + 1]
                    gap = next_event.timestamp - (event.timestamp + event.duration)

                    # Find corresponding silence segment
                    if seg_idx < len(silence_segments):
                        silence_seg = silence_segments[seg_idx]
                        # Allow flexible gap matching
                        gap_min = silence_seg.duration.min * 0.5
                        gap_max = silence_seg.duration.max * 2.0

                        if not (gap_min <= gap <= gap_max):
                            # Gap doesn't match - might be noise, try skipping
                            cycle_matched = False
                            break

                event_idx += 1

            if cycle_matched:
                cycle_count += 1
                logger.debug(f"[{profile.name}] Cycle {cycle_count} matched")
            else:
                # If first cycle didn't match, we're done
                if cycle_count == 0:
                    break
                # Otherwise, we've run out of matching events
                break

        return cycle_count

    def reset(self) -> None:
        """Reset all state."""
        self.event_buffer.clear()
        for name in self.last_eval_times:
            self.last_eval_times[name] = 0.0
            self.cycle_counts[name] = 0
            self.last_match_times[name] = -999.0
