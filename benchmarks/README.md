# Benchmarking Guide

## Overview
The `benchmarks/` directory contains scripts to validate the robustness of the acoustic engine against noise and handling of fast alarm patterns.

## Scripts

### 1. `benchmark_suite.py` (Standard White Noise)
This runs the standard regression test suite using white noise (uniform distribution).

**Usage:**
```bash
python3 benchmarks/benchmark_suite.py
```

**Tests Performed:**
- **Standard T3 Pattern (Smoke Alarm)**: Verifies robust detection of standard 0.5s beeps.
- **Fast T4 Pattern (CO Alarm High-Speed)**: Verifies detection of 50ms beeps, stressing temporal resolution.
- **Noise Sweep**: Tests both patterns against 0%, 10%, 25%, 50%, and 80% noise levels.

### 2. `benchmark_suite_complex_noise.py` (Pink Noise)
This is an advanced benchmark that uses **Pink Noise (1/f)** instead of white noise. Pink noise has equal energy per octave, making it a much better approximation of real-world environmental noise (traffic, wind, HVAC, office bustle).

**Usage:**
```bash
python3 benchmarks/benchmark_suite_complex_noise.py
```

**Why Pink Noise?**
- White noise is "hissy" (too much high frequency energy).
- Pink noise has more low-frequency energy, which is harder for many algorithms to filter out and represents a more realistic "rumble" test case.

## Interpreting Results

- **✅ PASS**: The engine detected the full alarm pattern (at least 2 cycles) despite the noise.
- **Matches: N**: How many distinct alarm events were confirmed.
- **SNR (Signal-to-Noise Ratio)**:
  - **6.0 dB**: Signal is 2x louder than noise.
  - **0.0 dB**: Signal and noise are equal volume.
  - **-4.1 dB**: Noise is louder than the signal.

**Success Criteria:**
The engine is considered "Robust" if it passes all tests up to **0dB SNR** (50% Noise).
Passing **-4.1dB SNR** (80% Noise) is considered "Excellent".

### 3. `benchmark_suite_chaotic.py` (Spectral Chaos)
This is a stress test using **Chaotic Spectal Noise**.

**Usage:**
```bash
python3 benchmarks/benchmark_suite_chaotic.py
```

**What is it?**
This script generates a random spectral envelope (effectively a random 64-band equalizer) and applies it to white noise.
- This creates noise that is unpredictably "loud" at some frequencies and "quiet" at others.
- It changes every time you run the script.
- It simulates an unpredictable environment like a factory floor with specific machine hums, or a room with specific resonant modes.

### 4. `benchmark_suite_stress.py` (Negative Control)
This is a **Stress Test** to determine the breaking point of the engine.
It pushes noise levels well beyond realistic limits (up to 500% Amplitude, or -20dB SNR).

**Usage:**
```bash
python3 benchmarks/benchmark_suite_stress.py
```

**Noise Levels Tested:**
- **0.8 (80%)**: -4.1 dB SNR
- **1.0 (100%)**: -6.0 dB SNR (Noise is 2x Signal)
- **1.5 (150%)**: -9.5 dB SNR
- **2.0 (200%)**: -12.0 dB SNR (Noise is 4x Signal)
- **3.0 (300%)**: -15.6 dB SNR
- **5.0 (500%)**: -20.0 dB SNR (Noise is 10x Signal)

This helps us verify that the engine *does* eventually fail when physics dictates it should (i.e., signal is completely buried).

### 5. `benchmark_suite_specificity.py` (False Positive Test)
This tests the engine's **Specificity**, ensuring it doesn't trigger on incorrect patterns.

**Usage:**
```bash
python3 benchmarks/benchmark_suite_specificity.py
```

**Scenarios Tested:**
1.  **Control**: Standard T3 (Should Detect)
2.  **Wrong Frequency**: A T3 pattern at 1500Hz instead of 3000Hz (Should Reject).
3.  **Wrong Timing**: A T3 pattern with 0.2s beeps instead of 0.5s beeps (Should Reject).
4.  **Pure Noise**: 500% Amplitude White Noise (Should Reject).

**Pass Criteria:**
- **Control**: Matches > 0
- **Negatives**: Matches == 0

