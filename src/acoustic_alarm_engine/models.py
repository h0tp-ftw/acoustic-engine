"""Data models for alarm pattern definitions."""

from dataclasses import dataclass, field
from typing import List, Literal, Optional


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
    """

    name: str
    segments: List[Segment]
    confirmation_cycles: int = 1
    reset_timeout: float = 10.0

    def __repr__(self) -> str:
        return f"AlarmProfile('{self.name}', {len(self.segments)} segments, {self.confirmation_cycles} cycles)"
