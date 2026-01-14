#!/usr/bin/env python3
"""Example: Test a profile with noise mixing.

This demonstrates the workflow of:
1. Design profiles in the Web Tuner
2. Test them with the Profile Tester
3. Verify detection works under various conditions

Run the tester from command line:

    # Basic test with audio file
    python -m acoustic_alarm_engine.tester \
        --profile profiles/smoke_alarm.yaml \
        --audio path/to/alarm_sample.wav

    # Test with white noise (30% level)
    python -m acoustic_alarm_engine.tester \
        --profile profiles/smoke_alarm.yaml \
        --audio path/to/alarm_sample.wav \
        --noise 0.3 \
        --noise-type white

    # Live microphone test
    python -m acoustic_alarm_engine.tester \
        --profile profiles/ \
        --live \
        --duration 60 \
        --verbose

    # Verbose mode shows every detected tone event
    python -m acoustic_alarm_engine.tester \
        --profile profiles/smoke_alarm.yaml \
        --audio path/to/alarm_sample.wav \
        -v

You can also use the tester programmatically:
"""

from pathlib import Path

from acoustic_alarm_engine.tester.display import Display
from acoustic_alarm_engine.tester.runner import TestRunner


def test_profile_with_audio(
    profile_path: str,
    audio_path: str,
    noise_level: float = 0.0,
    noise_type: str = "white",
    verbose: bool = True,
):
    """Test a profile against an audio file.

    Args:
        profile_path: Path to YAML profile
        audio_path: Path to WAV audio file
        noise_level: Noise mixing level (0.0-1.0)
        noise_type: Type of noise (white, pink, brown)
        verbose: Show detailed event logging
    """
    display = Display(verbose=verbose)
    display.header()

    runner = TestRunner(
        profile_path=Path(profile_path),
        noise_level=noise_level,
        noise_type=noise_type,
        verbose=verbose,
        display=display,
    )

    runner.run_file(Path(audio_path))
    runner.show_results()

    return runner.results


def test_with_increasing_noise(
    profile_path: str,
    audio_path: str,
    noise_levels: list = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5],
):
    """Test detection robustness across different noise levels.

    This helps determine the maximum noise level where
    detection still works reliably.
    """
    print("=" * 60)
    print("🔊 Noise Robustness Test")
    print("=" * 60)

    for level in noise_levels:
        display = Display(verbose=False)

        runner = TestRunner(
            profile_path=Path(profile_path),
            noise_level=level,
            noise_type="white",
            verbose=False,
            display=display,
        )

        runner.run_file(Path(audio_path))

        status = "✓ DETECTED" if runner.results.detections else "✗ missed"
        print(
            f"  Noise {level * 100:3.0f}%: {status} ({len(runner.results.detections)} detections)"
        )

    print("=" * 60)


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 3:
        print("Usage: python test_with_noise.py <profile.yaml> <audio.wav>")
        print()
        print("Example:")
        print("  python examples/test_with_noise.py profiles/smoke_alarm.yaml samples/alarm.wav")
        sys.exit(1)

    profile_path = sys.argv[1]
    audio_path = sys.argv[2]

    # Run single test
    results = test_profile_with_audio(profile_path, audio_path, verbose=True)

    # Run noise robustness test
    print()
    test_with_increasing_noise(profile_path, audio_path)
