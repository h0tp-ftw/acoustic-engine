"""Tests for the unified `acoustic-engine` CLI (arg handling, no audio hardware)."""

import math
import struct
import wave

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
