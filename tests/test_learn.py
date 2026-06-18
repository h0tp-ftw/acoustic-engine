"""Tests for the `learn` autopilot: recording -> profile, and round-trip detection."""

import math

import numpy as np
import pytest

from acoustic_engine.engine import Engine
from acoustic_engine.errors import AcousticEngineError
from acoustic_engine.learn import infer_segments, learn_profile_from_audio


def _t3_audio(sample_rate=44100, freq=3100.0, cycles=4):
    """Synthetic Temporal-Three alarm: 3 beeps (0.5s on / 0.5s off), 1.5s gap."""

    def beep(dur):
        n = int(dur * sample_rate)
        t = np.arange(n) / sample_rate
        env = np.clip(np.minimum(t / 0.01, (dur - t) / 0.01), 0, 1)
        return (0.7 * 32767 * env * np.sin(2 * math.pi * freq * t)).astype(np.int16)

    def sil(dur):
        return np.zeros(int(dur * sample_rate), dtype=np.int16)

    one = np.concatenate([beep(0.5), sil(0.5), beep(0.5), sil(0.5), beep(0.5), sil(1.5)])
    return np.concatenate([one] * cycles), sample_rate


def test_learn_infers_three_tone_cycle():
    audio, sr = _t3_audio()
    profile = learn_profile_from_audio(audio, sr, name="T3")

    tones = [s for s in profile.segments if s.type == "tone"]
    assert len(tones) == 3, f"expected a 3-tone cycle, got {len(tones)}"
    # Each tone should bracket the true 3100 Hz.
    for tone in tones:
        assert tone.frequency.min <= 3100 <= tone.frequency.max


def test_learned_profile_detects_its_own_recording():
    """The whole point: a learned profile must detect the sound it was learned from."""
    audio, sr = _t3_audio()
    profile = learn_profile_from_audio(audio, sr, name="T3")

    detected = []
    engine = Engine(profiles=[profile], on_detection=detected.append)
    chunk = 1024
    for i in range(0, len(audio) - chunk, chunk):
        engine.process_chunk(audio[i : i + chunk])

    assert detected, "learned profile failed to detect its own recording"


def _t4_audio(sample_rate=44100, freq=3200.0, cycles=4):
    """Synthetic Temporal-Four (CO) alarm: 4 fast chirps (0.1s on/off), 4s gap.

    Exercises the high-resolution path: at the engine's default dropout
    tolerance these chirps would merge into one tone.
    """

    def beep(dur):
        n = int(dur * sample_rate)
        t = np.arange(n) / sample_rate
        env = np.clip(np.minimum(t / 0.005, (dur - t) / 0.005), 0, 1)
        return (0.7 * 32767 * env * np.sin(2 * math.pi * freq * t)).astype(np.int16)

    def sil(dur):
        return np.zeros(int(dur * sample_rate), dtype=np.int16)

    one = np.concatenate(
        [beep(0.1), sil(0.1), beep(0.1), sil(0.1), beep(0.1), sil(0.1), beep(0.1), sil(4.0)]
    )
    return np.concatenate([one] * cycles), sample_rate


def test_learn_fast_pattern_keeps_chirps_separate():
    audio, sr = _t4_audio()
    profile = learn_profile_from_audio(audio, sr, name="T4")
    tones = [s for s in profile.segments if s.type == "tone"]
    assert len(tones) == 4, f"expected 4 chirps, got {len(tones)} (merged?)"


def test_silence_raises_helpful_error():
    silence = np.zeros(44100 * 2, dtype=np.int16)
    with pytest.raises(AcousticEngineError, match="No tones"):
        learn_profile_from_audio(silence, 44100, name="Quiet")


def test_infer_segments_empty_raises():
    with pytest.raises(AcousticEngineError):
        infer_segments([])
