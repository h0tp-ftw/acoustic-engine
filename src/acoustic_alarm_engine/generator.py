"""Generates discrete events from continuous DSP data."""

import logging
from typing import List
from dataclasses import dataclass

from acoustic_alarm_engine.events import AudioEvent, ToneEvent
from acoustic_alarm_engine.dsp import Peak

logger = logging.getLogger(__name__)


@dataclass
class ActiveTone:
    """Tracks a currently playing tone."""

    start_time: float
    frequency: float
    max_magnitude: float
    last_seen_time: float
    samples_count: int


class EventGenerator:
    """Converts spectral peaks into discrete Tone/Silence events.

    Handles debouncing and tone continuity to produce clean events
    from noisy FFT data.
    """

    def __init__(self, sample_rate: int, chunk_size: int):
        """Initialize the event generator.

        Args:
            sample_rate: Audio sample rate in Hz
            chunk_size: Number of samples per chunk
        """
        self.sample_rate = sample_rate
        self.chunk_size = chunk_size
        self.chunk_duration = chunk_size / sample_rate

        # Configuration
        self.frequency_tolerance = 50.0  # Hz to match same tone
        self.min_tone_duration = 0.1  # Minimum duration for valid tone
        self.dropout_tolerance = 0.15  # Max gap before tone ends

        # State
        self.active_tones: List[ActiveTone] = []
        self.last_process_time = 0.0

    def process(self, peaks: List[Peak], timestamp: float) -> List[AudioEvent]:
        """Process peaks for a time slice and return completed events.

        Args:
            peaks: Spectral peaks from DSP layer
            timestamp: Current time in seconds

        Returns:
            List of completed ToneEvents
        """
        events: List[AudioEvent] = []
        current_active_indices = set()

        # Match peaks to active tones
        for peak in peaks:
            matched = False
            for i, tone in enumerate(self.active_tones):
                if abs(peak.frequency - tone.frequency) < self.frequency_tolerance:
                    # Update existing tone
                    tone.max_magnitude = max(tone.max_magnitude, peak.magnitude)
                    tone.last_seen_time = timestamp
                    tone.samples_count += 1
                    current_active_indices.add(i)
                    matched = True
                    break

            if not matched:
                # New potential tone
                new_tone = ActiveTone(
                    start_time=timestamp,
                    frequency=peak.frequency,
                    max_magnitude=peak.magnitude,
                    last_seen_time=timestamp,
                    samples_count=1,
                )
                self.active_tones.append(new_tone)
                current_active_indices.add(len(self.active_tones) - 1)

        # Check for ended tones
        active_tones_next: List[ActiveTone] = []

        for i, tone in enumerate(self.active_tones):
            if i in current_active_indices:
                active_tones_next.append(tone)
            else:
                time_since_seen = timestamp - tone.last_seen_time

                if time_since_seen > self.dropout_tolerance:
                    # Tone ended
                    duration = tone.samples_count * self.chunk_duration

                    if duration >= self.min_tone_duration:
                        event = ToneEvent(
                            timestamp=tone.start_time,
                            duration=duration,
                            frequency=tone.frequency,
                            magnitude=tone.max_magnitude,
                            confidence=1.0,
                        )
                        events.append(event)
                        logger.debug(
                            f"Generated Tone: {event.frequency:.0f}Hz, {event.duration:.2f}s"
                        )
                else:
                    # Keep waiting (dropout tolerance)
                    active_tones_next.append(tone)

        self.active_tones = active_tones_next
        self.last_process_time = timestamp

        return events
