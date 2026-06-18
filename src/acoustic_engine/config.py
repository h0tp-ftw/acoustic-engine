"""Configuration utilities for the acoustic alarm engine.

This module centralizes all configuration logic for resolution settings,
presets, and engine defaults. It provides helper functions for computing
optimal settings based on loaded profiles and supports loading a unified
global configuration file.
"""

import glob
import logging
import os
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import List, Optional, Tuple, Union

import yaml

from .errors import ConfigError
from .models import AlarmProfile, ResolutionConfig
from .profiles import _parse_profile, load_profiles_from_yaml

logger = logging.getLogger(__name__)

_PROFILE_SUFFIXES = (".yaml", ".yml")


def _resolve_include(spec: str, base_dir: Path) -> List[Path]:
    """Resolve an ``include:`` spec to a sorted list of profile YAML files.

    Supports three forms, resolved against ``base_dir`` (the config file's
    directory) when not absolute:

    - a single file: ``profiles/smoke_alarm.yaml``
    - a shell glob: ``profiles/*.yaml``
    - a directory: ``profiles/`` (loads every ``*.yaml``/``*.yml`` inside,
      non-recursively)

    Returns an empty list if nothing matched; the caller decides whether that
    is an error.
    """
    raw = spec if os.path.isabs(spec) else str(base_dir / spec)

    if any(ch in raw for ch in "*?["):
        return sorted(p for p in (Path(m) for m in glob.glob(raw)) if p.is_file())

    p = Path(raw)
    if p.is_dir():
        return sorted(
            f for f in p.iterdir() if f.is_file() and f.suffix.lower() in _PROFILE_SUFFIXES
        )
    if p.is_file():
        return [p]
    return []


def _apply_engine_overrides(engine_config: "EngineConfig", engine_data: dict) -> None:
    """Apply explicit ``engine:`` settings from YAML onto an EngineConfig.

    Generic over every EngineConfig field, so adding a knob never requires
    touching this function. Unknown keys raise ConfigError (catching typos
    like ``min_magnatude``) instead of being silently ignored.
    """
    valid = {f.name for f in fields(EngineConfig)}
    for key, value in engine_data.items():
        if key not in valid:
            raise ConfigError(
                f"Unknown engine setting '{key}'. Valid settings are: "
                f"{', '.join(sorted(valid))}."
            )
        current = getattr(engine_config, key)
        try:
            if isinstance(current, bool):
                cast: object = bool(value)
            elif isinstance(current, int):
                cast = int(value)
            elif isinstance(current, float):
                cast = float(value)
            else:
                cast = value
        except (TypeError, ValueError):
            raise ConfigError(f"engine.{key} must be a number, got {value!r}.") from None
        setattr(engine_config, key, cast)

# Audio capture defaults. Kept as named constants so every entry point
# (AudioSettings, EngineConfig, GlobalConfig.load, from_profiles, the tester)
# agrees — previously these drifted (1024 vs 4096) so the same profiles
# detected differently depending on whether you went through Engine() or
# from_yaml(). 1024 (~23ms) is the default: fine temporal resolution so a
# single chunk doesn't outlast min_tone_duration and register transients as
# tones. Raise to 4096 to cut CPU on constrained hardware.
DEFAULT_SAMPLE_RATE = 44100  # Hz
DEFAULT_CHUNK_SIZE = 1024  # samples (~23ms @ 44.1kHz); fine temporal resolution
HIGHRES_CHUNK_SIZE = 2048  # cap applied to a larger base when a profile needs fast events

# Default resolution values
DEFAULT_MIN_TONE_DURATION = 0.04  # seconds (requires ~2 chunks to confirm)
DEFAULT_DROPOUT_TOLERANCE = 0.03  # seconds (tolerates 1 missing chunk)
DEFAULT_MIN_MAGNITUDE = 10.0  # Threshold for peak detection

# High-resolution preset values
HIGHRES_MIN_TONE_DURATION = 0.05  # 50ms
HIGHRES_DROPOUT_TOLERANCE = 0.05  # 50ms


def compute_finest_resolution(profiles: List[AlarmProfile]) -> Tuple[float, float]:
    """Compute the finest resolution needed across all profiles.

    Examines all profiles and returns the smallest min_tone_duration
    and dropout_tolerance values. This allows a single EventGenerator
    to capture events at the resolution needed by all profiles.

    Args:
        profiles: List of AlarmProfile objects to analyze.

    Returns:
        A tuple containing (min_tone_duration, dropout_tolerance) as floats.
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
        profile: The AlarmProfile to get resolution for.

    Returns:
        ResolutionConfig object with the effective settings.
    """
    if profile.resolution:
        return profile.resolution
    return ResolutionConfig.standard()


@dataclass
class SystemConfig:
    """System-level configuration settings.

    Attributes:
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL).
        log_file: Optional path to a log file.
    """

    log_level: str = "INFO"
    log_file: Optional[str] = None


@dataclass
class AudioSettings:
    """Audio capture configuration settings.

    Attributes:
        sample_rate: Audio sampling rate in Hz.
        chunk_size: Number of samples per buffer.
        device_index: Specific audio device index (None for default).
        channels: Number of audio channels (usually 1 for mono).
    """

    sample_rate: int = DEFAULT_SAMPLE_RATE
    chunk_size: int = DEFAULT_CHUNK_SIZE
    device_index: Optional[int] = None
    channels: int = 1


@dataclass
class EngineConfig:
    """Complete configuration for the Engine's detection pipeline.

    This consolidates all engine settings in one place for easier management.

    Attributes:
        sample_rate: Audio sample rate in Hz.
        chunk_size: FFT chunk size in samples.
        min_tone_duration: Minimum tone duration to register (computed from profiles).
        dropout_tolerance: Max gap before tone considered ended (computed from profiles).
        min_magnitude: Threshold for peak detection.

        # --- Advanced DSP Settings ---
        min_sharpness: Minimum prominence of a spectral peak (default 1.5).
        noise_floor_factor: Multiplier for adaptive noise floor (default 3.0).
        max_peaks: Maximum peaks to track per chunk (default 5).

        # --- Advanced Generation Settings ---
        frequency_tolerance: Hz range to consider peaks as the same tone (default 50.0).
        freq_smoothing: Alpha for EMA frequency tracking (default 0.3).
        dip_threshold: Ratio for instantaneous dip detection (default 0.6).
        strong_signal_ratio: Ratio to consider signal "strong" for duration (default 0.5).
        coalesce_ratio: Overlap ratio for merging concurrent events (default 0.5).

        # --- Advanced Matching Settings ---
        max_buffer_duration: Seconds of history to keep in memory (default 60.0).
        noise_skip_limit: Max number of noise events to skip during matching (default 2).
        duration_relax_low: Multiplier for minimum segment duration (default 0.8).
        duration_relax_high: Multiplier for maximum segment duration (default 1.5).
    """

    sample_rate: int = DEFAULT_SAMPLE_RATE
    chunk_size: int = DEFAULT_CHUNK_SIZE
    min_tone_duration: float = DEFAULT_MIN_TONE_DURATION
    dropout_tolerance: float = DEFAULT_DROPOUT_TOLERANCE
    min_magnitude: float = DEFAULT_MIN_MAGNITUDE  # Threshold for peak detection

    # Advanced DSP
    min_sharpness: float = 1.5
    noise_floor_factor: float = 3.0
    noise_learning_rate: float = 0.01  # Alpha for background noise profile updates
    max_peaks: int = 5

    # Advanced Generation
    frequency_tolerance: float = 50.0
    freq_smoothing: float = 0.3
    dip_threshold: float = 0.6
    strong_signal_ratio: float = 0.5
    coalesce_ratio: float = 0.5

    # Advanced Matching
    max_buffer_duration: float = 60.0
    noise_skip_limit: int = 2
    duration_relax_low: float = 0.8
    duration_relax_high: float = 1.5

    @classmethod
    def from_profiles(
        cls,
        profiles: List[AlarmProfile],
        sample_rate: int = DEFAULT_SAMPLE_RATE,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
    ) -> "EngineConfig":
        """Create an EngineConfig with resolution computed from profiles.

        This is the recommended way to create an EngineConfig - it automatically
        sets the resolution to the finest values needed by any profile.

        Args:
            profiles: List of AlarmProfile objects.
            sample_rate: Audio sample rate (default 44100).
            chunk_size: FFT chunk size (default 4096, will be reduced to 2048 for high-res).

        Returns:
            EngineConfig with computed resolution settings.
        """
        min_tone, dropout = compute_finest_resolution(profiles)

        # If any profile needs high-res, reduce chunk size for better temporal resolution
        if min_tone < DEFAULT_MIN_TONE_DURATION or dropout < DEFAULT_DROPOUT_TOLERANCE:
            chunk_size = min(chunk_size, HIGHRES_CHUNK_SIZE)  # finer temporal resolution

        return cls(
            sample_rate=sample_rate,
            chunk_size=chunk_size,
            min_tone_duration=min_tone,
            dropout_tolerance=dropout,
        )

    @classmethod
    def from_single_profile(
        cls,
        profile: AlarmProfile,
        sample_rate: int = 44100,
        chunk_size: int = 1024,
    ) -> "EngineConfig":
        """Create an EngineConfig tailored for a SINGLE profile.

        Used in parallel pipeline architectures where each profile gets its own engine.

        Args:
            profile: The single AlarmProfile object.
            sample_rate: Audio sample rate.
            chunk_size: FFT chunk size.

        Returns:
            EngineConfig with resolution settings matching the profile.
        """
        # Default requirements
        min_tone = DEFAULT_MIN_TONE_DURATION
        dropout = DEFAULT_DROPOUT_TOLERANCE

        # Override if profile has specific requirements
        if profile.resolution:
            min_tone = profile.resolution.min_tone_duration
            dropout = profile.resolution.dropout_tolerance

        # Adaptive chunk size for high resolution
        target_min_mag = DEFAULT_MIN_MAGNITUDE

        if min_tone < 0.05 or dropout < 0.05:
            # For very fast patterns, ensure chunk size isn't too large
            # 1024 samples @ 44.1kHz is ~23ms, which is fine for 50ms events.
            chunk_size = min(chunk_size, 1024)

        # Scale min_magnitude based on chunk size reduction relative to standard (4096)
        # FFT magnitude is proportional to N. If we use smaller N, we need smaller threshold.
        # Reference: N=4096, Threshold=DEFAULT_MIN_MAGNITUDE
        if chunk_size < 4096:
            scale_factor = chunk_size / 4096.0
            target_min_mag = DEFAULT_MIN_MAGNITUDE * scale_factor
            # Avoid going too low (noise floor)
            target_min_mag = max(target_min_mag, 1.0)

            # Scale frequency_tolerance up for smaller FFT (wider bins = more jitter)
            target_freq_tol = 50.0 * (4096.0 / chunk_size)

        else:
            target_freq_tol = 50.0

        return cls(
            sample_rate=sample_rate,
            chunk_size=chunk_size,
            min_tone_duration=min_tone,
            dropout_tolerance=dropout,
            min_magnitude=target_min_mag,
            frequency_tolerance=target_freq_tol,
        )

    @classmethod
    def high_resolution(cls, sample_rate: int = 44100) -> "EngineConfig":
        """High-resolution preset for fast patterns with small gaps.

        Use this for patterns with <100ms gaps between tones.

        Args:
            sample_rate: Audio sample rate (default 44100).

        Returns:
            EngineConfig with high-res settings.
        """
        return cls(
            sample_rate=sample_rate,
            chunk_size=1024,
            min_tone_duration=HIGHRES_MIN_TONE_DURATION,
            dropout_tolerance=HIGHRES_DROPOUT_TOLERANCE,
        )

    @classmethod
    def standard(cls, sample_rate: int = 44100) -> "EngineConfig":
        """Standard preset for noisy environments.

        Use this for typical alarm detection where noise resilience is important.

        Args:
            sample_rate: Audio sample rate (default 44100).

        Returns:
            EngineConfig with standard settings.
        """
        return cls(
            sample_rate=sample_rate,
            chunk_size=1024,
            min_tone_duration=DEFAULT_MIN_TONE_DURATION,
            dropout_tolerance=DEFAULT_DROPOUT_TOLERANCE,
        )


@dataclass
class MQTTConfig:
    """MQTT notification settings.

    Attributes:
        enabled: Whether MQTT publishing is enabled.
        broker: MQTT broker address.
        port: MQTT broker port.
        username: Optional username for authentication.
        password: Optional password for authentication.
        topic: Topic to publish alerts to.
        client_id: Optional client ID.
    """

    enabled: bool = False
    broker: str = "localhost"
    port: int = 1883
    username: Optional[str] = None
    password: Optional[str] = None
    topic: str = "acoustic_engine/alerts"
    client_id: Optional[str] = None


@dataclass
class GlobalConfig:
    """Unified configuration for the entire application.

    This class serves as the single source of truth for configuration,
    loading system settings, audio parameters, and alarm profiles from
    a single YAML file or structure.
    """

    system: SystemConfig = field(default_factory=SystemConfig)
    audio: AudioSettings = field(default_factory=AudioSettings)
    profiles: List[AlarmProfile] = field(default_factory=list)
    mqtt: MQTTConfig = field(default_factory=MQTTConfig)
    # The calculated engine config based on the above
    engine: EngineConfig = field(default_factory=EngineConfig)

    @classmethod
    def load(cls, path: Union[str, Path]) -> "GlobalConfig":
        """Load the global configuration from a YAML file.

        The YAML file should have the following structure:
        ```yaml
        system:
          log_level: INFO
        audio:
          sample_rate: 44100
        profiles:
          - name: "Smoke Alarm"
            segments: ...
          - include: "path/to/other/profiles.yaml"
        ```

        Args:
            path: Path to the main configuration YAML file.

        Returns:
            A GlobalConfig object populated with the settings.
        """
        path = Path(path)
        if not path.exists():
            raise FileNotFoundError(f"Configuration file not found: {path}")

        with open(path, "r") as f:
            data = yaml.safe_load(f) or {}

        # 1. Parse System Config
        sys_data = data.get("system", {})
        system_config = SystemConfig(
            log_level=sys_data.get("log_level", "INFO"),
            log_file=sys_data.get("log_file"),
        )

        # 2. Parse Audio Settings
        audio_data = data.get("audio", {})
        audio_config = AudioSettings(
            sample_rate=audio_data.get("sample_rate", DEFAULT_SAMPLE_RATE),
            chunk_size=audio_data.get("chunk_size", DEFAULT_CHUNK_SIZE),
            device_index=audio_data.get("device_index"),
            channels=audio_data.get("channels", 1),
        )

        # 3. Parse Profiles (inline definitions and/or external includes).
        profiles: List[AlarmProfile] = []
        raw_profiles = data.get("profiles", [])

        if not isinstance(raw_profiles, list):
            raise ConfigError(
                f"'profiles' in {path} must be a list of profiles and/or includes, "
                f"got {type(raw_profiles).__name__}."
            )

        for item in raw_profiles:
            if not isinstance(item, dict):
                raise ConfigError(
                    f"Each entry under 'profiles' in {path} must be a mapping "
                    f"(an inline profile or an 'include:'), got {item!r}."
                )

            if "include" in item:
                spec = str(item["include"])
                files = _resolve_include(spec, path.parent)
                if not files:
                    raise ConfigError(
                        f"include '{spec}' (in {path}) matched no profile files. "
                        "Paths and globs are resolved relative to the config file; "
                        "check the path is correct."
                    )
                for f in files:
                    profiles.extend(load_profiles_from_yaml(f))
                    logger.info(f"Included profiles from {f}")
            elif "name" in item or "segments" in item:
                # Inline profile definition
                profiles.append(_parse_profile(item))
            else:
                raise ConfigError(
                    f"Profile entry in {path} has neither 'include', 'name', nor "
                    f"'segments': {item!r}"
                )

        # 4. Generate Engine Config
        # We use the profiles to determine the best resolution
        engine_config = EngineConfig.from_profiles(
            profiles,
            sample_rate=audio_config.sample_rate,
            chunk_size=audio_config.chunk_size,
        )

        # 5. Apply explicit engine overrides from YAML.
        # Generic over every EngineConfig field, and reports unknown keys
        # (typos) instead of silently dropping them.
        engine_data = data.get("engine", {}) or {}
        if engine_data:
            if not isinstance(engine_data, dict):
                raise ConfigError(
                    f"'engine' in {path} must be a mapping of settings, "
                    f"got {type(engine_data).__name__}."
                )
            _apply_engine_overrides(engine_config, engine_data)

        # 6. Parse MQTT Settings
        mqtt_data = data.get("mqtt", {})
        mqtt_config = MQTTConfig(
            enabled=mqtt_data.get("enabled", False),
            broker=mqtt_data.get("broker", "localhost"),
            port=mqtt_data.get("port", 1883),
            username=mqtt_data.get("username"),
            password=mqtt_data.get("password"),
            topic=mqtt_data.get("topic", "acoustic_engine/alerts"),
            client_id=mqtt_data.get("client_id"),
        )

        return cls(
            system=system_config,
            audio=audio_config,
            profiles=profiles,
            mqtt=mqtt_config,
            engine=engine_config,
        )
