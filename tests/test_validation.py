"""Tests for profile validation and clear error reporting."""

import pytest

from acoustic_engine.errors import ProfileError
from acoustic_engine.models import AlarmProfile, Range, Segment
from acoustic_engine.profiles import load_profiles_from_yaml, validate_profile


def _tone(fmin=2900, fmax=3100, dmin=0.4, dmax=0.6):
    return Segment(type="tone", frequency=Range(fmin, fmax), duration=Range(dmin, dmax))


def test_valid_profile_passes():
    profile = AlarmProfile(name="OK", segments=[_tone(), Segment(type="silence", duration=Range(0.1, 0.3))])
    validate_profile(profile)  # should not raise


def test_no_segments_rejected():
    with pytest.raises(ProfileError, match="no segments"):
        validate_profile(AlarmProfile(name="Empty", segments=[]))


def test_tone_without_frequency_rejected():
    seg = Segment(type="tone", frequency=None, duration=Range(0.4, 0.6))
    with pytest.raises(ProfileError, match="no frequency range"):
        validate_profile(AlarmProfile(name="NoFreq", segments=[seg]))


def test_inverted_frequency_rejected():
    with pytest.raises(ProfileError, match="greater than"):
        validate_profile(AlarmProfile(name="Swapped", segments=[_tone(fmin=3300, fmax=3100)]))


def test_inverted_duration_rejected():
    with pytest.raises(ProfileError, match="duration min"):
        validate_profile(AlarmProfile(name="BadDur", segments=[_tone(dmin=0.6, dmax=0.4)]))


def test_no_tone_segments_rejected():
    seg = Segment(type="silence", duration=Range(0.1, 0.3))
    with pytest.raises(ProfileError, match="no 'tone' segments"):
        validate_profile(AlarmProfile(name="SilenceOnly", segments=[seg]))


def test_bad_confirmation_cycles_rejected():
    with pytest.raises(ProfileError, match="confirmation_cycles"):
        validate_profile(AlarmProfile(name="Zero", segments=[_tone()], confirmation_cycles=0))


def test_validation_runs_through_yaml_loader(tmp_path):
    """A malformed profile should fail loudly at load time, not silently."""
    bad = tmp_path / "bad.yaml"
    bad.write_text(
        "name: Bad\nsegments:\n  - type: tone\n    duration: {min: 0.4, max: 0.6}\n"
    )
    with pytest.raises(ProfileError, match="no frequency range"):
        load_profiles_from_yaml(bad)
