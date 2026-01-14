#!/usr/bin/env python3
"""Test the windowed matcher with synthetic audio and noise mixing.

This test:
1. Generates synthetic T3 smoke alarm patterns
2. Mixes with various noise levels
3. Verifies detection still works
"""

import sys
import os

sys.path.insert(0, "src")

import numpy as np
from acoustic_alarm_engine.profiles import load_profiles_from_yaml
from acoustic_alarm_engine.tester.mixer import AudioMixer
from acoustic_alarm_engine.dsp import SpectralMonitor
from acoustic_alarm_engine.filter import FrequencyFilter
from acoustic_alarm_engine.generator import EventGenerator
from acoustic_alarm_engine.windowed_matcher import WindowedMatcher
from acoustic_alarm_engine.events import ToneEvent


SAMPLE_RATE = 44100
CHUNK_SIZE = 4096


def generate_tone(frequency: float, duration: float, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """Generate a pure sine wave tone."""
    t = np.arange(int(duration * sample_rate)) / sample_rate
    # Add slight attack/release envelope to avoid clicks
    envelope = np.ones_like(t)
    attack_samples = int(0.01 * sample_rate)
    if attack_samples > 0 and len(envelope) > attack_samples * 2:
        envelope[:attack_samples] = np.linspace(0, 1, attack_samples)
        envelope[-attack_samples:] = np.linspace(1, 0, attack_samples)
    return (np.sin(2 * np.pi * frequency * t) * envelope * 0.8).astype(np.float32)


def generate_silence(duration: float, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """Generate silence."""
    return np.zeros(int(duration * sample_rate), dtype=np.float32)


def generate_t3_pattern(frequency: float = 3100, cycles: int = 2) -> np.ndarray:
    """Generate a T3 smoke alarm pattern (3 beeps, pause, repeat)."""
    pattern = []

    for cycle in range(cycles):
        # 3 beeps with short pauses
        for beep in range(3):
            pattern.append(generate_tone(frequency, 0.5))
            if beep < 2:
                pattern.append(generate_silence(0.2))

        # Inter-cycle pause
        if cycle < cycles - 1:
            pattern.append(generate_silence(1.0))

    return np.concatenate(pattern)


def run_detection_pipeline(audio: np.ndarray, profiles, verbose: bool = False) -> list:
    """Run the full detection pipeline on audio and return matches."""
    dsp = SpectralMonitor(SAMPLE_RATE, CHUNK_SIZE)
    freq_filter = FrequencyFilter(profiles)
    generator = EventGenerator(SAMPLE_RATE, CHUNK_SIZE)
    matcher = WindowedMatcher(profiles)

    # Convert to int16 for DSP
    audio_int16 = (audio * 32768).astype(np.int16)

    matches = []

    # Process in chunks
    for i in range(0, len(audio_int16) - CHUNK_SIZE, CHUNK_SIZE):
        chunk = audio_int16[i : i + CHUNK_SIZE]
        timestamp = i / SAMPLE_RATE

        # DSP
        peaks = dsp.process(chunk)

        # Filter
        filtered_peaks = freq_filter.filter_peaks(peaks)

        # Generate events
        events = generator.process(filtered_peaks, timestamp)

        # Buffer events
        for event in events:
            if isinstance(event, ToneEvent):
                matcher.add_event(event)
                if verbose:
                    print(
                        f"  Event: {event.frequency:.0f}Hz @ {event.timestamp:.2f}s ({event.duration:.2f}s)"
                    )

        # Evaluate
        chunk_matches = matcher.evaluate(timestamp)
        matches.extend(chunk_matches)

    return matches


def test_clean_detection():
    """Test detection with clean audio (no noise)."""
    print("=" * 60)
    print("Test 1: Clean T3 Pattern Detection")
    print("=" * 60)

    profiles = load_profiles_from_yaml("profiles/smoke_alarm_t3.yaml")
    print(f"Profile: {profiles[0].name}")

    # Generate clean T3 pattern
    audio = generate_t3_pattern(frequency=3100, cycles=2)
    # Add some silence padding
    audio = np.concatenate([generate_silence(0.5), audio, generate_silence(0.5)])

    print(f"Audio duration: {len(audio) / SAMPLE_RATE:.1f}s")

    matches = run_detection_pipeline(audio, profiles)

    if matches:
        print(f"✓ DETECTED: {len(matches)} match(es)")
        for m in matches:
            print(f"  - {m.profile_name} at {m.timestamp:.2f}s ({m.cycle_count} cycles)")
        return True
    else:
        print("✗ NOT DETECTED")
        return False


def test_with_noise(noise_level: float, noise_type: str = "white"):
    """Test detection with noise mixed in."""
    print(f"\nTest: Detection with {noise_level * 100:.0f}% {noise_type} noise")
    print("-" * 40)

    profiles = load_profiles_from_yaml("profiles/smoke_alarm_t3.yaml")
    mixer = AudioMixer(SAMPLE_RATE)

    # Generate clean T3 pattern
    audio = generate_t3_pattern(frequency=3100, cycles=2)
    audio = np.concatenate([generate_silence(0.5), audio, generate_silence(0.5)])

    # Mix noise
    noisy_audio = mixer.mix_noise(audio, noise_type=noise_type, level=noise_level)

    matches = run_detection_pipeline(noisy_audio, profiles)

    if matches:
        print(f"  ✓ DETECTED with {noise_level * 100:.0f}% noise")
        return True
    else:
        print(f"  ✗ NOT DETECTED with {noise_level * 100:.0f}% noise")
        return False


def test_with_leading_noise():
    """Test that leading noise doesn't break detection."""
    print("\n" + "=" * 60)
    print("Test 2: Leading Noise (The Core Problem)")
    print("=" * 60)
    print("This tests that random beeps BEFORE the pattern don't break detection.")

    profiles = load_profiles_from_yaml("profiles/smoke_alarm_t3.yaml")

    # Generate: random beeps + T3 pattern
    leading_noise = np.concatenate(
        [
            generate_silence(0.3),
            generate_tone(3050, 0.3),  # Random nearby beep
            generate_silence(0.5),
            generate_tone(3100, 0.2),  # Another random beep
            generate_silence(0.4),
        ]
    )

    t3_pattern = generate_t3_pattern(frequency=3100, cycles=2)

    audio = np.concatenate([leading_noise, t3_pattern, generate_silence(0.5)])

    print(
        f"Audio: {len(leading_noise) / SAMPLE_RATE:.1f}s noise + {len(t3_pattern) / SAMPLE_RATE:.1f}s T3 pattern"
    )

    matches = run_detection_pipeline(audio, profiles)

    if matches:
        print(f"✓ DETECTED despite leading noise: {len(matches)} match(es)")
        return True
    else:
        print("✗ NOT DETECTED - leading noise broke detection")
        return False


def test_noise_levels():
    """Test detection at various noise levels."""
    print("\n" + "=" * 60)
    print("Test 3: Noise Resilience Across Levels")
    print("=" * 60)

    results = {}
    for level in [0.0, 0.1, 0.2, 0.3, 0.4, 0.5]:
        results[level] = test_with_noise(level, "white")

    print("\nSummary:")
    for level, passed in results.items():
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"  {level * 100:3.0f}% noise: {status}")

    return results


def main():
    print("=" * 60)
    print("WINDOWED MATCHER NOISE RESILIENCE TESTS")
    print("=" * 60)
    print()

    results = {}

    # Test 1: Clean detection
    results["clean"] = test_clean_detection()

    # Test 2: Leading noise (the core problem we're solving)
    results["leading_noise"] = test_with_leading_noise()

    # Test 3: Various noise levels
    noise_results = test_noise_levels()
    results["noise_0.3"] = noise_results.get(0.3, False)

    # Summary
    print("\n" + "=" * 60)
    print("FINAL RESULTS")
    print("=" * 60)

    all_critical_passed = results["clean"] and results["leading_noise"]

    if all_critical_passed:
        print("✓ All critical tests PASSED!")
        print("  - Clean detection works")
        print("  - Leading noise doesn't break detection (CORE FIX)")
    else:
        print("✗ Some critical tests FAILED")

    if results.get("noise_0.3"):
        print("  - Detection works with 30% noise")

    return 0 if all_critical_passed else 1


if __name__ == "__main__":
    sys.exit(main())
