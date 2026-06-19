"""YAML configuration loader for AlarmProfiles.

This module provides functionality to load and save `AlarmProfile` objects
from YAML files. It supports various YAML structures including single profiles,
lists of profiles, and bundled profiles. It handles the parsing of segments,
frequency ranges, and resolution settings.
"""

import logging
from pathlib import Path
from typing import List, Union

import yaml

from .errors import ProfileError
from .models import (
    DEFAULT_DROPOUT_TOLERANCE,
    DEFAULT_MIN_TONE_DURATION,
    AlarmProfile,
    Range,
    ResolutionConfig,
    Segment,
)

logger = logging.getLogger(__name__)

VALID_SEGMENT_TYPES = ("tone", "silence", "any")


def validate_profile(profile: AlarmProfile) -> None:
    """Validate an alarm profile, raising ProfileError with a clear message.

    Catches the mistakes that otherwise make the engine silently never fire:
    a tone with no frequency range, an inverted min/max, a profile with no
    tones to match, etc. Messages name the profile and segment at fault.

    Args:
        profile: The AlarmProfile to check.

    Raises:
        ProfileError: If the profile is structurally invalid.
    """
    name = profile.name or "UnnamedProfile"

    if not profile.segments:
        raise ProfileError(
            f"Profile '{name}' has no segments. Add at least one 'tone' segment "
            "with a frequency range."
        )

    tone_count = 0
    for i, seg in enumerate(profile.segments):
        where = f"Profile '{name}', segment {i} ({seg.type})"

        if seg.type not in VALID_SEGMENT_TYPES:
            raise ProfileError(
                f"{where}: unknown type '{seg.type}'. "
                f"Expected one of {', '.join(VALID_SEGMENT_TYPES)}."
            )

        if seg.type == "tone":
            tone_count += 1
            if seg.frequency is None:
                raise ProfileError(
                    f"{where} has no frequency range, so it can never match. "
                    "Add 'frequency: {min: <hz>, max: <hz>}' (or a single value)."
                )
            if seg.frequency.min <= 0 or seg.frequency.max <= 0:
                raise ProfileError(
                    f"{where}: frequency must be positive "
                    f"(got {seg.frequency.min}-{seg.frequency.max} Hz)."
                )
            if seg.frequency.min > seg.frequency.max:
                raise ProfileError(
                    f"{where}: frequency min ({seg.frequency.min}) is greater than "
                    f"max ({seg.frequency.max}). Did you swap them?"
                )

        if seg.duration.min < 0 or seg.duration.max < 0:
            raise ProfileError(
                f"{where}: duration cannot be negative "
                f"(got {seg.duration.min}-{seg.duration.max} s)."
            )
        if seg.duration.min > seg.duration.max:
            raise ProfileError(
                f"{where}: duration min ({seg.duration.min}s) is greater than "
                f"max ({seg.duration.max}s). Did you swap them?"
            )

    if tone_count == 0:
        raise ProfileError(
            f"Profile '{name}' has no 'tone' segments, so it can never match. "
            "A pattern needs at least one tone with a frequency range."
        )

    if profile.confirmation_cycles < 1:
        raise ProfileError(
            f"Profile '{name}': confirmation_cycles must be at least 1 "
            f"(got {profile.confirmation_cycles})."
        )

    if profile.reset_timeout < 0:
        raise ProfileError(
            f"Profile '{name}': reset_timeout cannot be negative "
            f"(got {profile.reset_timeout})."
        )


def load_profile_from_yaml(path: Union[str, Path]) -> AlarmProfile:
    """Load a single AlarmProfile from a YAML file.

    This function expects the YAML file to describe exactly one profile.

    Example YAML format:
    ```yaml
    name: "SmokeAlarm"
    confirmation_cycles: 2
    segments:
      - type: "tone"
        frequency:
          min: 2900
          max: 3100
        duration:
          min: 0.4
          max: 0.6
      - type: "silence"
        duration:
          min: 0.1
          max: 0.3
    ```

    Args:
        path: Path to the YAML file.

    Returns:
        The valid AlarmProfile object parsed from the file.

    Raises:
        FileNotFoundError: If the file does not exist.
        ValueError: If the YAML structure is invalid.
    """
    with open(path, "r") as f:
        data = yaml.safe_load(f)

    return _parse_profile(data)


def load_profiles_from_yaml(path: Union[str, Path]) -> List[AlarmProfile]:
    """Load multiple AlarmProfiles from a YAML file.

    This function is flexible and supports three different top-level structures
    in the YAML file:
    1. A single profile dictionary (returns a list with one element).
    2. A list of profile dictionaries.
    3. A "bundled" dictionary with a 'profiles' key containing a list.

    Args:
        path: Path to the YAML file.

    Returns:
        A list of loaded AlarmProfile objects.
    """
    with open(path, "r") as f:
        data = yaml.safe_load(f)

    # Format 3: Bundled profiles
    if isinstance(data, dict) and "profiles" in data:
        return [_parse_profile(p) for p in data["profiles"]]

    # Format 2: List of profiles
    if isinstance(data, list):
        return [_parse_profile(p) for p in data]

    # Format 1: Single profile (fallback)
    return [_parse_profile(data)]


def _parse_profile(data: dict) -> AlarmProfile:
    """Parse a raw dictionary into an AlarmProfile object.

    Handles defaults, type conversion, and structure validation for
    segments, frequency ranges, and resolution settings.

    Args:
        data: Use dictionary containing profile definition.

    Returns:
        A validated AlarmProfile object.
    """
    segments = []

    for seg_data in data.get("segments", []):
        seg_type = seg_data.get("type", "tone")

        # Parse frequency range (only for tones)
        frequency = None
        if seg_type == "tone" and "frequency" in seg_data:
            freq_data = seg_data["frequency"]
            if isinstance(freq_data, dict):
                frequency = Range(
                    min=float(freq_data.get("min", 0)),
                    max=float(freq_data.get("max", 20000)),
                )
            else:
                # Single value: apply ±5% tolerance
                freq = float(freq_data)
                frequency = Range(min=freq * 0.95, max=freq * 1.05)

        # Parse duration range
        dur_data = seg_data.get("duration", {"min": 0.1, "max": 1.0})
        if isinstance(dur_data, dict):
            duration = Range(
                min=float(dur_data.get("min", 0.1)), max=float(dur_data.get("max", 1.0))
            )
        else:
            # Single value: apply ±20% tolerance
            dur = float(dur_data)
            duration = Range(min=dur * 0.8, max=dur * 1.2)

        segments.append(
            Segment(
                type=seg_type,
                frequency=frequency,
                duration=duration,
                min_magnitude=float(seg_data.get("min_magnitude", 0.05)),
            )
        )

    # Parse resolution settings if present
    resolution = None
    if "resolution" in data:
        res_data = data["resolution"]
        resolution = ResolutionConfig(
            min_tone_duration=float(res_data.get("min_tone_duration", DEFAULT_MIN_TONE_DURATION)),
            dropout_tolerance=float(res_data.get("dropout_tolerance", DEFAULT_DROPOUT_TOLERANCE)),
        )

    profile = AlarmProfile(
        name=data.get("name", "UnnamedProfile"),
        segments=segments,
        confirmation_cycles=int(data.get("confirmation_cycles", 1)),
        reset_timeout=float(data.get("reset_timeout", 10.0)),
        window_duration=data.get("window_duration"),
        eval_frequency=float(data.get("eval_frequency", 0.5)),
        resolution=resolution,
    )
    validate_profile(profile)
    return profile


def _profile_to_dict(profile: AlarmProfile) -> dict:
    """Serialize an AlarmProfile to a plain dict matching the YAML schema.

    Shared by the single- and multi-profile savers so they can't drift. Includes
    the resolution block when set, so a save -> reload round-trip is lossless.
    """
    data: dict = {
        "name": profile.name,
        "confirmation_cycles": profile.confirmation_cycles,
        "reset_timeout": profile.reset_timeout,
    }
    if profile.resolution:
        data["resolution"] = {
            "min_tone_duration": profile.resolution.min_tone_duration,
            "dropout_tolerance": profile.resolution.dropout_tolerance,
        }

    segments = []
    for seg in profile.segments:
        seg_data: dict = {
            "type": seg.type,
            "duration": {"min": seg.duration.min, "max": seg.duration.max},
        }
        if seg.type == "tone" and seg.frequency:
            seg_data["frequency"] = {"min": seg.frequency.min, "max": seg.frequency.max}
            seg_data["min_magnitude"] = seg.min_magnitude
        segments.append(seg_data)

    data["segments"] = segments
    return data


def save_profile_to_yaml(profile: AlarmProfile, path: Union[str, Path]) -> None:
    """Save an AlarmProfile to a YAML file.

    Args:
        profile: The AlarmProfile object to save.
        path: Destination file path.
    """
    with open(path, "w") as f:
        yaml.dump(_profile_to_dict(profile), f, default_flow_style=False, sort_keys=False)

    logger.info(f"Saved profile '{profile.name}' to {path}")


def save_profiles_to_yaml(profiles: List[AlarmProfile], path: Union[str, Path]) -> None:
    """Save multiple AlarmProfiles to a YAML file (as a list of profiles)."""
    data_list = [_profile_to_dict(profile) for profile in profiles]
    with open(path, "w") as f:
        yaml.dump(data_list, f, default_flow_style=False, sort_keys=False)
