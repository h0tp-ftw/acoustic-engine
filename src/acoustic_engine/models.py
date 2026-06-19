"""Data models for alarm pattern definitions."""

from dataclasses import dataclass, field
from typing import List, Literal, Optional

# Canonical event-resolution defaults — the single source of truth shared by
# ResolutionConfig and config.EngineConfig (config.py imports these). They live
# here, the lowest-level module with no internal imports, to avoid a cycle.
#
# 0.04s ≈ 2 chunks at chunk_size=1024 / 44.1kHz: fine enough that a transient
# click doesn't register as a tone, coarse enough to confirm a real tone fast.
DEFAULT_MIN_TONE_DURATION = 0.04  # seconds (requires ~2 chunks to confirm)
DEFAULT_DROPOUT_TOLERANCE = 0.03  # seconds (tolerates ~1 missing chunk)

# High-resolution preset, for sub-100ms patterns (e.g. a CO T4's chirps).
HIGHRES_MIN_TONE_DURATION = 0.05  # seconds
HIGHRES_DROPOUT_TOLERANCE = 0.05  # seconds


@dataclass
class Range:
    """A numeric range (min, max)."""

    min: float
    max: float

    def contains(self, value: float) -> bool:
        """Check if value falls within this range."""
        return self.min <= value <= self.max

    def __repr__(self) -> str:
        return f"Range({self.min}, {self.max})"


@dataclass
class ResolutionConfig:
    """Resolution settings for event detection.

    Lower values = higher resolution but more noise sensitivity.
    Higher values = more noise resilient but may merge fast patterns.

    Attributes:
        min_tone_duration: Minimum duration for a tone to count (filters clicks/pops)
        dropout_tolerance: Max gap before tone is considered ended
    """

    min_tone_duration: float = DEFAULT_MIN_TONE_DURATION  # seconds
    dropout_tolerance: float = DEFAULT_DROPOUT_TOLERANCE  # seconds

    @classmethod
    def high_resolution(cls) -> "ResolutionConfig":
        """Preset for fast patterns with small gaps (<100ms)."""
        return cls(HIGHRES_MIN_TONE_DURATION, HIGHRES_DROPOUT_TOLERANCE)

    @classmethod
    def standard(cls) -> "ResolutionConfig":
        """Preset matching the engine's default event resolution."""
        return cls(DEFAULT_MIN_TONE_DURATION, DEFAULT_DROPOUT_TOLERANCE)


@dataclass
class Segment:
    """A single step in an alarm pattern.

    Attributes:
        type: Either 'tone', 'silence', or 'any'
        frequency: Expected frequency range for tones (Hz)
        min_magnitude: Minimum FFT magnitude to consider valid
        duration: Expected duration range (seconds)
    """

    type: Literal["tone", "silence", "any"]

    # Tone specific
    frequency: Optional[Range] = None  # Hz
    min_magnitude: float = 0.05

    # Timing
    duration: Range = field(default_factory=lambda: Range(0, 999))

    def __str__(self) -> str:
        if self.type == "tone" and self.frequency:
            return f"Tone({self.frequency.min}-{self.frequency.max}Hz, {self.duration.min}-{self.duration.max}s)"
        elif self.type == "silence":
            return f"Silence({self.duration.min}-{self.duration.max}s)"
        return f"Any({self.duration.min}-{self.duration.max}s)"


@dataclass
class AlarmProfile:
    """Definition of an alarm pattern.

    Attributes:
        name: Unique identifier for this profile
        segments: Ordered list of Tone/Silence segments defining the pattern
        confirmation_cycles: How many full pattern repeats required for detection
        reset_timeout: Seconds of silence before resetting pattern matching
        window_duration: Optional window size for windowed matching (auto-calculated if None)
        eval_frequency: How often to evaluate windows in seconds (default 0.5)
        resolution: Resolution settings for event detection (optional, uses finest needed if None)
    """

    name: str
    segments: List[Segment]
    confirmation_cycles: int = 1
    reset_timeout: float = 10.0

    # Windowed matching parameters (optional, auto-calculated if not set)
    window_duration: Optional[float] = None  # Total window size in seconds
    eval_frequency: float = 0.5  # How often to evaluate (seconds)

    # Resolution settings (optional, per-profile override)
    resolution: Optional[ResolutionConfig] = None

    def __repr__(self) -> str:
        return f"AlarmProfile('{self.name}', {len(self.segments)} segments, {self.confirmation_cycles} cycles)"
