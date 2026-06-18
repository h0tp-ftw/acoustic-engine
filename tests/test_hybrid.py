"""Integration test: full pipeline with TestRunner using synthetic audio.

Generates WAV files in-memory and runs the real detection pipeline
(SpectralMonitor → FrequencyFilter → EventGenerator → WindowedMatcher)
through TestRunner to verify end-to-end detection.
"""

import io
import math
import struct
import wave

import pytest

from acoustic_engine.tester.display import Display
from acoustic_engine.tester.runner import TestRunner


def generate_wav(sample_rate=44100, duration=6.0, freq=3200, beep_dur=0.5, silence_dur=0.5, long_silence=1.5, cycles=2):
    """Generate a synthetic alarm WAV matching a T3-like pattern."""
    samples = []
    t = 0.0
    dt = 1.0 / sample_rate

    for _ in range(cycles):
        for beep_idx in range(3):
            # Tone
            for _ in range(int(beep_dur * sample_rate)):
                samples.append(int(0.8 * 32767 * math.sin(2 * math.pi * freq * t)))
                t += dt
            # Short silence (not after last beep in group)
            gap = silence_dur if beep_idx < 2 else long_silence
            for _ in range(int(gap * sample_rate)):
                samples.append(0)
                t += dt

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(struct.pack(f"<{len(samples)}h", *samples))
    return buf.getvalue()


@pytest.fixture
def smoke_alarm_wav(tmp_path):
    """Write a synthetic smoke alarm WAV to a temp file."""
    wav_bytes = generate_wav(freq=3200, beep_dur=0.5, silence_dur=0.5, long_silence=1.5, cycles=3)
    path = tmp_path / "smoke_alarm_synthetic.wav"
    path.write_bytes(wav_bytes)
    return path


@pytest.fixture
def smoke_alarm_profile(tmp_path):
    """Write a matching profile YAML to a temp file."""
    yaml_content = """\
name: "Smoke_Alarm_Test"
confirmation_cycles: 2
segments:
  - type: "tone"
    frequency: { min: 3100, max: 3300 }
    duration: { min: 0.3, max: 0.7 }
  - type: "silence"
    duration: { min: 0.3, max: 0.7 }
  - type: "tone"
    frequency: { min: 3100, max: 3300 }
    duration: { min: 0.3, max: 0.7 }
  - type: "silence"
    duration: { min: 0.3, max: 0.7 }
  - type: "tone"
    frequency: { min: 3100, max: 3300 }
    duration: { min: 0.3, max: 0.7 }
  - type: "silence"
    duration: { min: 1.0, max: 2.0 }
"""
    path = tmp_path / "smoke_alarm_test.yaml"
    path.write_text(yaml_content)
    return path


def test_full_pipeline_detects_synthetic_alarm(smoke_alarm_wav, smoke_alarm_profile):
    """The full TestRunner pipeline should detect a clean synthetic alarm."""
    display = Display(verbose=False)
    runner = TestRunner(
        profile_path=smoke_alarm_profile,
        chunk_size=1024,
        verbose=False,
        display=display,
    )
    runner.run_file(smoke_alarm_wav)

    # Dip detection may split clean synthetic sine waves at onset/offset,
    # producing more events than the 9 beeps. What matters is that the
    # matcher found the pattern — check detections, not raw event count.
    assert len(runner.results.tone_events) >= 6, (
        f"Expected at least 6 tone events (2 cycles x 3 beeps), got {len(runner.results.tone_events)}"
    )

    assert len(runner.results.detections) >= 1, (
        f"Expected at least 1 pattern detection, got {len(runner.results.detections)}"
    )

    for tone in runner.results.tone_events:
        assert 3100 <= tone.frequency <= 3300, (
            f"Tone frequency {tone.frequency}Hz outside expected range 3100-3300Hz"
        )


def test_no_false_positive_on_silence(tmp_path):
    """A silent WAV should produce zero tone events and zero detections."""
    # Generate 3 seconds of silence
    sr = 44100
    n_samples = sr * 3
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(struct.pack(f"<{n_samples}h", *([0] * n_samples)))

    wav_path = tmp_path / "silence.wav"
    wav_path.write_bytes(buf.getvalue())

    profile_yaml = """\
name: "ShouldNotMatch"
confirmation_cycles: 1
segments:
  - type: "tone"
    frequency: { min: 3100, max: 3300 }
    duration: { min: 0.3, max: 0.7 }
"""
    profile_path = tmp_path / "no_match.yaml"
    profile_path.write_text(profile_yaml)

    display = Display(verbose=False)
    runner = TestRunner(
        profile_path=profile_path,
        verbose=False,
        display=display,
    )
    runner.run_file(wav_path)

    assert len(runner.results.tone_events) == 0, (
        f"Expected 0 tone events on silence, got {len(runner.results.tone_events)}"
    )
    assert len(runner.results.detections) == 0


def test_wrong_frequency_no_match(tmp_path):
    """Tones at the wrong frequency should not match a profile."""
    # Generate beeps at 1000Hz
    wav_bytes = generate_wav(freq=1000, beep_dur=0.5, silence_dur=0.5, long_silence=1.5, cycles=3)
    wav_path = tmp_path / "wrong_freq.wav"
    wav_path.write_bytes(wav_bytes)

    # Profile expects 3100-3300Hz
    profile_yaml = """\
name: "HighFreqOnly"
confirmation_cycles: 1
segments:
  - type: "tone"
    frequency: { min: 3100, max: 3300 }
    duration: { min: 0.3, max: 0.7 }
"""
    profile_path = tmp_path / "high_freq.yaml"
    profile_path.write_text(profile_yaml)

    display = Display(verbose=False)
    runner = TestRunner(
        profile_path=profile_path,
        verbose=False,
        display=display,
    )
    runner.run_file(wav_path)

    # FrequencyFilter should reject all 1000Hz peaks — zero tone events
    assert len(runner.results.tone_events) == 0, (
        f"Expected 0 tone events (freq filter), got {len(runner.results.tone_events)}"
    )
