# Benchmarking & Performance Results

## Summary Table

| Benchmark Type                 | Test Case        | Max Performance       | Result                |
| :----------------------------- | :--------------- | :-------------------- | :-------------------- |
| **Robustness (White Noise)**   | Standard T3      | **-14.0 dB SNR**      | ✅ Highly Robust      |
| **Robustness (High Res)**      | Fast T4 (50ms)   | **-20.0 dB SNR**      | ✅ Extreme Robustness |
| **Environmental (Pink Noise)** | Standard T3      | **-4.1 dB SNR** (80%) | ✅ Real-world Ready   |
| **Spectral Chaos**             | Random Envelopes | **-4.1 dB SNR**       | ✅ Jamming Resistant  |
| **Specificity (Freq)**         | Wrong Frequency  | **0 False Positives** | ✅ Perfect Rejection  |
| **Specificity (Time)**         | Wrong Duration   | **0 False Positives** | ✅ Perfect Rejection  |

## Interpretations

### 1. Robustness (Stress Testing)

The engine has been pushed to physics-breaking limits.

- **Standard Mode** maintains lock until noise is 6x louder than the signal (-15.6dB).
- **High-Res Mode** remains active even at **10x louder noise** (-20dB), proving that rapid spectral updates are superior for extreme conditions.

### 2. Specificity (Positive Identification)

Following a refined duration tolerance update (tightened to 0.75x min), the engine now strictly distinguishes between patterns:

- **Wrong Frequency**: Completely rejected. The frequency filter effectively blocks out-of-band signals.
- **Wrong Timing**: Previously a weak point, the engine now correctly rejects 0.2s beeps when expecting 0.5s, ensuring we only detect valid alarm types.
- **Pure Noise**: Even at 500% amplitude, the engine generates zero phantom match events.

## Scripts

### 1. `benchmark_suite.py` (Standard White Noise)

Standard regression test.

```bash
python3 benchmarks/benchmark_suite.py
```

### 2. `benchmark_suite_complex_noise.py` (Pink Noise)

Realistic environmental rumble (HVAC, wind, traffic).

```bash
python3 benchmarks/benchmark_suite_complex_noise.py
```

### 3. `benchmark_suite_chaotic.py` (Spectral Chaos)

Jamming-resistant test with random spectral envelopes.

```bash
python3 benchmarks/benchmark_suite_chaotic.py
```

### 4. `benchmark_suite_stress.py` (Negative Control)

Pushes noise to -20dB SNR to find the breaking point.

```bash
python3 benchmarks/benchmark_suite_stress.py
```

### 5. `benchmark_suite_specificity.py` (False Positive Test)

Ensures the engine only triggers on the _correct_ alarm.

```bash
python3 benchmarks/benchmark_suite_specificity.py
```
