"""Tests for the unified `acoustic-engine` CLI (arg handling, no audio hardware)."""

import math
import struct
import wave

import numpy as np

from acoustic_engine import cli
from acoustic_engine.cli import main


def test_profiles_lists_builtin_presets(capsys):
    rc = main(["profiles"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "smoke_t3" in out
    assert "co_t4" in out


def test_run_with_no_source_returns_error():
    # No preset/profile/config -> error, before any audio is opened.
    assert main(["run"]) == 1


def test_run_unknown_preset_returns_error():
    assert main(["run", "--preset", "does_not_exist"]) == 1


def test_no_command_prints_help_and_returns_error(capsys):
    rc = main([])
    out = capsys.readouterr().out
    assert rc == 1
    assert "run" in out and "learn" in out


def _write_t3_wav(path, sample_rate=44100, freq=3100.0, cycles=3):
    samples = []
    for _ in range(cycles):
        for _ in range(3):
            for i in range(int(0.5 * sample_rate)):
                samples.append(int(0.7 * 32767 * math.sin(2 * math.pi * freq * (i / sample_rate))))
            samples.extend([0] * int(0.5 * sample_rate))
        samples.extend([0] * int(1.0 * sample_rate))
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(struct.pack(f"<{len(samples)}h", *samples))


def test_learn_command_writes_profile(tmp_path, capsys):
    wav = tmp_path / "alarm.wav"
    out = tmp_path / "alarm.yaml"
    _write_t3_wav(wav)

    rc = main(["learn", str(wav), "--name", "CLI Alarm", "-o", str(out)])
    assert rc == 0
    assert out.exists()

    # The written YAML round-trips through the loader (and therefore validates).
    from acoustic_engine.profiles import load_profiles_from_yaml

    profiles = load_profiles_from_yaml(out)
    assert profiles[0].name == "CLI Alarm"
    assert any(s.type == "tone" for s in profiles[0].segments)


def _t3_samples(sample_rate=44100, freq=3100.0, cycles=4):
    """Synthetic T3 alarm as an int16 mono array (3 beeps, 0.5s on/off, 1.5s gap)."""

    def beep(dur):
        n = int(dur * sample_rate)
        t = np.arange(n) / sample_rate
        env = np.clip(np.minimum(t / 0.01, (dur - t) / 0.01), 0, 1)
        return (0.7 * 32767 * env * np.sin(2 * math.pi * freq * t)).astype(np.int16)

    def sil(dur):
        return np.zeros(int(dur * sample_rate), dtype=np.int16)

    one = np.concatenate([beep(0.5), sil(0.5), beep(0.5), sil(0.5), beep(0.5), sil(1.5)])
    return np.concatenate([one] * cycles)


def test_learn_without_audio_or_record_errors():
    # Neither a file nor --record -> a clear error, not a crash.
    assert main(["learn"]) == 1


def test_learn_record_without_backend_errors():
    # No capture backend in the test env -> friendly failure and return 1.
    assert main(["learn", "--record", "--seconds", "1"]) == 1


def test_learn_record_builds_profile_and_keeps_wav(tmp_path, monkeypatch, capsys):
    """`learn --record` runs the real learn pipeline on captured audio and keeps the WAV."""
    samples = _t3_samples()
    # Stand in for the microphone: return our synthetic capture + a healthy level.
    monkeypatch.setattr(cli, "_run_capture", lambda *a, **k: (samples, 0.2))

    out = tmp_path / "rec.yaml"
    # An explicit --device skips the "is there a mic?" pre-flight, so the faked
    # capture is what gets exercised (no real backend needed in tests).
    rc = main(
        ["learn", "--record", "--device", "0", "--seconds", "2", "--name", "Rec Alarm", "-o", str(out)]
    )
    assert rc == 0
    assert out.exists()

    # The recording is kept next to the profile and stays re-readable by learn.
    wav = out.with_suffix(".wav")
    assert wav.exists()
    from acoustic_engine.learn import _load_wav_int16_mono

    loaded, sr = _load_wav_int16_mono(wav)
    assert sr == 44100
    assert len(loaded) == len(samples)

    # The written YAML round-trips (and therefore validates) with the 3 tones.
    from acoustic_engine.profiles import load_profiles_from_yaml

    profiles = load_profiles_from_yaml(out)
    assert profiles[0].name == "Rec Alarm"
    assert sum(1 for s in profiles[0].segments if s.type == "tone") == 3

    assert "Inferred pattern" in capsys.readouterr().out


def test_describe_profile_and_slug():
    from acoustic_engine.models import AlarmProfile, Range, Segment

    profile = AlarmProfile(
        name="My Dryer",
        segments=[
            Segment(type="tone", frequency=Range(3000, 3200), duration=Range(0.4, 0.6)),
            Segment(type="silence", duration=Range(0.3, 0.7)),
        ],
    )
    summary = cli._describe_profile(profile)
    assert "tone" in summary and "3000" in summary
    assert cli._slug("My Dryer") == "my_dryer"
    assert cli._slug("!!!") == "alarm"
