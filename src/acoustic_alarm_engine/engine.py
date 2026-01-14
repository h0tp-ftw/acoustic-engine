"""Main Engine class - orchestrates the detection pipeline."""

import time
import logging
import threading
import numpy as np
from typing import Callable, List, Optional

from acoustic_alarm_engine.models import AlarmProfile
from acoustic_alarm_engine.listener import AudioConfig, AudioListener
from acoustic_alarm_engine.dsp import SpectralMonitor
from acoustic_alarm_engine.filter import FrequencyFilter
from acoustic_alarm_engine.generator import EventGenerator
from acoustic_alarm_engine.windowed_matcher import WindowedMatcher
from acoustic_alarm_engine.events import PatternMatchEvent
from acoustic_alarm_engine.config import compute_finest_resolution

logger = logging.getLogger(__name__)


class Engine:
    """Acoustic Alarm Detection Engine.

    Orchestrates the full detection pipeline:
    Audio Input → DSP/FFT → Frequency Filter → Event Generation → Pattern Matching → Callbacks

    Example:
        >>> from acoustic_alarm_engine import Engine, AudioConfig
        >>> from acoustic_alarm_engine.profiles import load_profiles_from_yaml
        >>>
        >>> profiles = load_profiles_from_yaml("smoke_alarm.yaml")
        >>> engine = Engine(
        ...     profiles=profiles,
        ...     audio_config=AudioConfig(),
        ...     on_detection=lambda name: print(f"ALARM: {name}")
        ... )
        >>> engine.start()  # Blocking
    """

    def __init__(
        self,
        profiles: List[AlarmProfile],
        audio_config: Optional[AudioConfig] = None,
        on_detection: Optional[Callable[[str], None]] = None,
        on_match: Optional[Callable[[PatternMatchEvent], None]] = None,
    ):
        """Initialize the detection engine.

        Args:
            profiles: List of AlarmProfile patterns to detect
            audio_config: Audio capture settings (uses defaults if None)
            on_detection: Simple callback with just profile name (str)
            on_match: Full callback with PatternMatchEvent object
        """
        self.profiles = profiles
        self.audio_config = audio_config or AudioConfig()
        self.on_detection = on_detection
        self.on_match = on_match

        # State
        self._alarm_active = False
        self._current_time = 0.0
        self._running = False

        # Calculate the finest resolution needed across all profiles
        min_tone_dur, dropout_tol = self._compute_finest_resolution()

        # Pipeline components
        self._dsp = SpectralMonitor(self.audio_config.sample_rate, self.audio_config.chunk_size)
        self._freq_filter = FrequencyFilter(self.profiles)
        self._generator = EventGenerator(
            self.audio_config.sample_rate,
            self.audio_config.chunk_size,
            min_tone_duration=min_tone_dur,
            dropout_tolerance=dropout_tol,
        )
        self._matcher = WindowedMatcher(self.profiles)

        # Audio listener (created on start)
        self._listener: Optional[AudioListener] = None

        logger.info(
            f"Engine initialized with {len(profiles)} profile(s): {[p.name for p in profiles]}"
        )

    def process_chunk(self, audio_chunk: np.ndarray) -> bool:
        """Process a single audio chunk through the pipeline.

        This can be called directly if you're handling audio capture yourself.

        Args:
            audio_chunk: Raw audio samples (int16, mono)

        Returns:
            True if an alarm was detected in this chunk
        """
        # Time keeping
        chunk_duration = self.audio_config.chunk_size / self.audio_config.sample_rate
        self._current_time += chunk_duration

        # DSP Analysis
        peaks = self._dsp.process(audio_chunk)

        # Frequency Filter - remove irrelevant frequencies early
        filtered_peaks = self._freq_filter.filter_peaks(peaks)

        # Event Generation
        events = self._generator.process(filtered_peaks, self._current_time)

        # Buffer events for windowed analysis
        for event in events:
            self._matcher.add_event(event)

        # Evaluate windows periodically
        detected = False
        matches = self._matcher.evaluate(self._current_time)
        for match in matches:
            self._trigger_alarm(match)
            detected = True

        return detected

    def _compute_finest_resolution(self) -> tuple:
        """Compute the finest resolution needed across all profiles.

        Uses the centralized logic from config.py.

        Returns:
            (min_tone_duration, dropout_tolerance) tuple
        """
        min_tone, dropout = compute_finest_resolution(self.profiles)
        logger.info(f"Engine resolution: min_tone={min_tone}s, dropout={dropout}s")
        return min_tone, dropout

    def _trigger_alarm(self, match: PatternMatchEvent) -> None:
        """Handle a pattern match detection."""
        logger.info(f"MATCH: {match.profile_name} (Cycle {match.cycle_count})")

        if not self._alarm_active:
            logger.critical("=" * 60)
            logger.critical(f"🚨 ALARM DETECTED: [{match.profile_name.upper()}] 🚨")
            logger.critical(f"Timestamp: {match.timestamp:.2f}s")
            logger.critical("=" * 60)

            self._alarm_active = True

            # Fire callbacks
            if self.on_detection:
                try:
                    self.on_detection(match.profile_name)
                except Exception as e:
                    logger.error(f"Error in on_detection callback: {e}")

            if self.on_match:
                try:
                    self.on_match(match)
                except Exception as e:
                    logger.error(f"Error in on_match callback: {e}")

            # Auto-reset after timeout
            def clear():
                time.sleep(10)
                if self._alarm_active:
                    logger.info("Auto-clearing alarm state.")
                    self._alarm_active = False

            threading.Thread(target=clear, daemon=True).start()

    def start(self) -> None:
        """Start the engine with audio capture (blocking).

        This will block the current thread and capture audio until stop() is called.
        """
        self._listener = AudioListener(self.audio_config, self.process_chunk)

        if not self._listener.setup():
            logger.error("Failed to setup audio listener")
            return

        self._running = True

        try:
            self._listener.start()
        except KeyboardInterrupt:
            logger.info("Keyboard interrupt received")
        finally:
            self.stop()

    def start_async(self) -> threading.Thread:
        """Start the engine in a background thread.

        Returns:
            The background thread (already started)
        """
        thread = threading.Thread(target=self.start, daemon=True)
        thread.start()
        return thread

    def stop(self) -> None:
        """Stop the engine and release resources."""
        self._running = False

        if self._listener:
            self._listener.stop()
            self._listener.cleanup()
            self._listener = None

        logger.info("Engine stopped")

    @property
    def is_running(self) -> bool:
        """Check if the engine is currently running."""
        return self._running

    @property
    def alarm_active(self) -> bool:
        """Check if an alarm is currently active."""
        return self._alarm_active
