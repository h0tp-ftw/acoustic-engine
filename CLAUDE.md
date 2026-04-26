# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
# Install (editable with all extras)
pip install -e ".[tuner,dev]"

# Run tests
pytest tests/ -v

# Run a single test file or test
pytest tests/test_windowed.py -v
pytest tests/test_hybrid.py::test_full_pipeline_detects_synthetic_alarm -v

# Lint
ruff check src/

# Production runner
python -m acoustic_engine.runner --config config.example.yaml

# Test a profile against audio
python -m acoustic_engine.tester --profile profiles/smoke_alarm.yaml --audio recording.wav -v

# Live mic testing with noise injection
python -m acoustic_engine.tester --profile profiles/ --live --duration 60 --noise 0.3 --noise-type white

# Validation API (used by the React tuner)
python -m acoustic_engine.tuner --port 8787

# React tuner
cd tuner && npm install && npm run dev
```

## Architecture

The engine is a 4-stage DSP pipeline: **Input → Processing → Analysis → Output**.

### Processing: `SpectralMonitor` → `FrequencyFilter`

`SpectralMonitor` (processing/dsp.py) runs FFT on int16 audio chunks, finds spectral peaks with parabolic interpolation, and maintains an adaptive noise floor via asymmetric EMA (fast down, slow up). `FrequencyFilter` (processing/filter.py) pre-analyzes all loaded profiles to extract expected frequency ranges, then discards peaks outside those ranges before they reach the generator.

### Analysis: `EventGenerator` → `WindowedMatcher`

`EventGenerator` (analysis/generator.py) tracks peak persistence across chunks, applying debouncing (min_tone_duration), dropout bridging (dropout_tolerance), dip detection (reverb tail cutting), and frequency smoothing (EMA). Outputs `ToneEvent` objects in strict chronological order.

`WindowedMatcher` (analysis/windowed_matcher.py) replaces state machines with sliding window analysis. It buffers up to 60s of ToneEvents, periodically scans for the best-fit pattern subsequence, ignores leading/trailing noise, and fires `PatternMatchEvent` when enough cycles match.

### Resolution Negotiation (cross-cutting)

`EngineConfig.from_profiles()` computes the **finest resolution** needed across all profiles. A single EventGenerator runs at that resolution. Each profile's WindowedMatcher applies its own confirmation logic independently. If any profile needs min_tone_duration < 0.05s, chunk_size auto-reduces from 4096 to 2048 and min_magnitude scales proportionally.

### Parallel Engine

`ParallelEngine` runs multiple isolated `Engine` instances sharing one audio input. Each gets a bespoke `EngineConfig` computed from its single profile — so a slow loud smoke alarm and a fast quiet medical beep can have totally different sensitivity settings without interference.

### Browser Tuner ↔ Python Engine

The React app (`tuner/`) does its own client-side FFT analysis for interactive feedback. The validation API (`src/acoustic_engine/tuner/validate.py`) runs the **real** engine pipeline (SpectralMonitor → FrequencyFilter → EventGenerator → WindowedMatcher) on uploaded audio + profile YAML, returning tone events and pattern matches. The browser overlays both results so users can see where they diverge.

## Key Data Flow

Audio chunk (int16) → `SpectralMonitor.process()` → `List[Peak]` → `FrequencyFilter.filter_peaks()` → `List[Peak]` → `EventGenerator.process()` → `List[ToneEvent]` → `WindowedMatcher.add_event()` + `evaluate()` → `List[PatternMatchEvent]`

## Profile YAML Schema

```yaml
name: "Alarm_Name"
confirmation_cycles: 2
reset_timeout: 10.0           # optional, seconds of silence before reset
resolution:                    # optional, per-profile override
  min_tone_duration: 0.05
  dropout_tolerance: 0.05
segments:
  - type: "tone"
    frequency: { min: 3100, max: 3300 }
    duration: { min: 0.4, max: 0.6 }
  - type: "silence"
    duration: { min: 0.3, max: 0.7 }
```

Profiles are loaded by `profiles.py` which accepts three formats: single dict, list of dicts, or `{"profiles": [...]}`. Frequency and duration can be a single value (auto-applies ±5%/±20% tolerance) or a `{min, max}` dict.

## Code Conventions

- Line length: 100 (Black and Ruff)
- Python: 3.9+ (no walrus operators in hot paths)
- Ruff rules: E, F, I, N, W (E501 ignored)
- Tests use synthetic audio generated with numpy — no audio fixtures in the repo
- All tests must pass without audio hardware (no microphone required)
- React tuner: Vite 6, React 19, Tailwind CSS v4, js-yaml for YAML serialization
