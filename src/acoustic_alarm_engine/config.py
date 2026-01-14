"""Configuration utilities for the acoustic alarm engine.

This module centralizes all configuration logic for resolution settings,
presets, and engine defaults. It provides helper functions for computing
optimal settings based on loaded profiles.
"""

from typing import List, Tuple, Optional
from dataclasses import dataclass

from acoustic_alarm_engine.models import AlarmProfile, ResolutionConfig


# Default resolution values
DEFAULT_MIN_TONE_DURATION = 0.1  # seconds
DEFAULT_DROPOUT_TOLERANCE = 0.15  # seconds

# High-resolution preset values
HIGHRES_MIN_TONE_DURATION = 0.05  # 50ms
HIGHRES_DROPOUT_TOLERANCE = 0.05  # 50ms


def compute_finest_resolution(profiles: List[AlarmProfile]) -> Tuple[float, float]:
    """Compute the finest resolution needed across all profiles.

    Examines all profiles and returns the smallest min_tone_duration
    and dropout_tolerance values. This allows a single EventGenerator
    to capture events at the resolution needed by all profiles.

    Args:
        profiles: List of AlarmProfile objects

    Returns:
        (min_tone_duration, dropout_tolerance) tuple
    """
    finest_min_tone = DEFAULT_MIN_TONE_DURATION
    finest_dropout = DEFAULT_DROPOUT_TOLERANCE

    for profile in profiles:
        if profile.resolution:
            finest_min_tone = min(finest_min_tone, profile.resolution.min_tone_duration)
            finest_dropout = min(finest_dropout, profile.resolution.dropout_tolerance)

    return finest_min_tone, finest_dropout


def get_resolution_for_profile(profile: AlarmProfile) -> ResolutionConfig:
    """Get the effective resolution config for a profile.

    Returns the profile's resolution if set, otherwise returns defaults.

    Args:
        profile: The AlarmProfile to get resolution for

    Returns:
        ResolutionConfig object
    """
    if profile.resolution:
        return profile.resolution
    return ResolutionConfig.standard()


@dataclass
class EngineConfig:
    """Complete configuration for the Engine.

    This consolidates all engine settings in one place for easier management.

    Attributes:
        sample_rate: Audio sample rate in Hz
        chunk_size: FFT chunk size in samples
        min_tone_duration: Minimum tone duration to register (computed from profiles)
        dropout_tolerance: Max gap before tone considered ended (computed from profiles)
    """

    sample_rate: int = 44100
    chunk_size: int = 4096
    min_tone_duration: float = DEFAULT_MIN_TONE_DURATION
    dropout_tolerance: float = DEFAULT_DROPOUT_TOLERANCE

    @classmethod
    def from_profiles(
        cls,
        profiles: List[AlarmProfile],
        sample_rate: int = 44100,
        chunk_size: int = 4096,
    ) -> "EngineConfig":
        """Create an EngineConfig with resolution computed from profiles.

        This is the recommended way to create an EngineConfig - it automatically
        sets the resolution to the finest values needed by any profile.

        Args:
            profiles: List of AlarmProfile objects
            sample_rate: Audio sample rate (default 44100)
            chunk_size: FFT chunk size (default 4096, use 2048 for high-res)

        Returns:
            EngineConfig with computed resolution
        """
        min_tone, dropout = compute_finest_resolution(profiles)

        # If any profile needs high-res, reduce chunk size for better resolution
        if min_tone < DEFAULT_MIN_TONE_DURATION or dropout < DEFAULT_DROPOUT_TOLERANCE:
            chunk_size = min(chunk_size, 2048)  # Cap at 2048 for high-res

        return cls(
            sample_rate=sample_rate,
            chunk_size=chunk_size,
            min_tone_duration=min_tone,
            dropout_tolerance=dropout,
        )

    @classmethod
    def high_resolution(cls, sample_rate: int = 44100) -> "EngineConfig":
        """High-resolution preset for fast patterns with small gaps.

        Use this for patterns with <100ms gaps between tones.

        Args:
            sample_rate: Audio sample rate (default 44100)

        Returns:
            EngineConfig with high-res settings
        """
        return cls(
            sample_rate=sample_rate,
            chunk_size=2048,
            min_tone_duration=HIGHRES_MIN_TONE_DURATION,
            dropout_tolerance=HIGHRES_DROPOUT_TOLERANCE,
        )

    @classmethod
    def standard(cls, sample_rate: int = 44100) -> "EngineConfig":
        """Standard preset for noisy environments.

        Use this for typical alarm detection where noise resilience is important.

        Args:
            sample_rate: Audio sample rate (default 44100)

        Returns:
            EngineConfig with standard settings
        """
        return cls(
            sample_rate=sample_rate,
            chunk_size=4096,
            min_tone_duration=DEFAULT_MIN_TONE_DURATION,
            dropout_tolerance=DEFAULT_DROPOUT_TOLERANCE,
        )
