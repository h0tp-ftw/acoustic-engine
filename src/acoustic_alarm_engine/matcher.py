"""State machine for matching event streams against alarm profiles."""

import logging
from typing import List, Optional

from acoustic_alarm_engine.models import AlarmProfile
from acoustic_alarm_engine.events import AudioEvent, ToneEvent, PatternMatchEvent

logger = logging.getLogger(__name__)


class MatcherState:
    """Tracks progress of a single profile match."""

    def __init__(self, profile: AlarmProfile):
        self.profile = profile
        self.current_segment_index = 0
        self.cycle_count = 0
        self.last_event_time = 0.0
        self.start_time = 0.0

    def reset(self):
        """Reset matching state."""
        self.current_segment_index = 0
        self.cycle_count = 0
        self.last_event_time = 0.0


class SequenceMatcher:
    """Matches incoming events against multiple alarm profiles.

    Maintains state for each profile and checks incoming events
    against expected patterns.
    """

    def __init__(self, profiles: List[AlarmProfile]):
        """Initialize with list of profiles to match against."""
        self.profiles = profiles
        self.states = {p.name: MatcherState(p) for p in profiles}

    def process(self, event: AudioEvent) -> List[PatternMatchEvent]:
        """Process a new event and return any pattern matches.

        Args:
            event: An AudioEvent (usually ToneEvent)

        Returns:
            List of PatternMatchEvent for any completed matches
        """
        matches = []

        for profile in self.profiles:
            match_event = self._update_profile(self.states[profile.name], event)
            if match_event:
                matches.append(match_event)

        return matches

    def _update_profile(
        self, state: MatcherState, event: AudioEvent
    ) -> Optional[PatternMatchEvent]:
        """Update matching state for a single profile."""
        p = state.profile

        if state.current_segment_index >= len(p.segments):
            state.current_segment_index = 0

        expected = p.segments[state.current_segment_index]
        is_match = False

        if isinstance(event, ToneEvent):
            # Check silence gap before this tone
            gap_duration = event.timestamp - state.last_event_time

            # If expecting silence, check if gap matches
            if expected.type == "silence":
                if expected.duration.contains(gap_duration):
                    state.current_segment_index += 1

                    if state.current_segment_index >= len(p.segments):
                        state.cycle_count += 1
                        state.current_segment_index = 0
                        logger.debug(
                            f"[{p.name}] Cycle {state.cycle_count}/{p.confirmation_cycles} (silence)"
                        )

                        if state.cycle_count >= p.confirmation_cycles:
                            state.cycle_count = 0
                            return PatternMatchEvent(
                                timestamp=event.timestamp,
                                duration=0,
                                profile_name=p.name,
                                cycle_count=p.confirmation_cycles,
                            )

                    expected = p.segments[state.current_segment_index]
                else:
                    if state.current_segment_index > 0:
                        logger.debug(f"[{p.name}] Reset: Gap {gap_duration:.2f}s doesn't match")
                        state.reset()
                        expected = p.segments[0]

            # Now check if this tone matches current expectation
            if expected.type == "tone" and expected.frequency:
                freq_match = expected.frequency.contains(event.frequency)
                dur_match = expected.duration.contains(event.duration)

                if freq_match and dur_match:
                    is_match = True
                    logger.debug(
                        f"[{p.name}] Step {state.current_segment_index} OK: "
                        f"{event.frequency:.0f}Hz, {event.duration:.2f}s"
                    )
                else:
                    if state.current_segment_index > 0:
                        logger.debug(f"[{p.name}] Mismatch at step {state.current_segment_index}")
                        state.reset()
                        expected = p.segments[0]
                        # Try matching step 0
                        if (
                            expected.type == "tone"
                            and expected.frequency
                            and expected.frequency.contains(event.frequency)
                            and expected.duration.contains(event.duration)
                        ):
                            is_match = True

        # Advance state if matched
        if is_match:
            state.last_event_time = event.timestamp + event.duration
            state.current_segment_index += 1

            if state.current_segment_index >= len(p.segments):
                state.cycle_count += 1
                state.current_segment_index = 0
                logger.debug(f"[{p.name}] Cycle {state.cycle_count}/{p.confirmation_cycles}")

                if state.cycle_count >= p.confirmation_cycles:
                    state.cycle_count = 0
                    return PatternMatchEvent(
                        timestamp=event.timestamp,
                        duration=0,
                        profile_name=p.name,
                        cycle_count=p.confirmation_cycles,
                    )

        return None
