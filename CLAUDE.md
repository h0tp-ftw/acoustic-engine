# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
# Install (editable; extras: mqtt, tuner, dev)
pip install -e ".[tuner,dev,mqtt]"

# Run tests
pytest tests/ -v

# Run a single test file or test
pytest tests/test_windowed.py -v
pytest tests/test_hybrid.py::test_full_pipeline_detects_synthetic_alarm -v

# Lint
ruff check src/

# Unified CLI (preferred entry point — see src/acoustic_engine/cli.py)
acoustic-engine profiles                                   # list built-in presets
acoustic-engine devices                                    # list microphones (input devices)
acoustic-engine doctor                                     # mic check: live level meter + dominant freq
acoustic-engine run --preset smoke_t3                      # detect, zero config
acoustic-engine run --preset smoke_t3 --on-detect 'notify-send {name}'   # act on a hit (or --webhook URL)
acoustic-engine run --config config.example.yaml           # production
acoustic-engine learn --record --name "My Alarm"           # mic -> profile YAML (live capture)
acoustic-engine learn recording.wav --name "My Alarm"      # recording file -> profile YAML
acoustic-engine test --profile profiles/smoke_alarm.yaml --audio recording.wav -v
acoustic-engine serve --port 8787                          # validation API for the tuner

# Equivalent module forms (still work; the CLI wraps these)
python -m acoustic_engine.runner --config config.example.yaml
python -m acoustic_engine.tester --profile profiles/ --live --duration 60 --noise 0.3 --noise-type white

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

`EngineConfig.from_profiles()` computes the **finest resolution** needed across all profiles. A single EventGenerator runs at that resolution. Each profile's WindowedMatcher applies its own confirmation logic independently. Audio defaults are unified via named constants in `config.py` (`DEFAULT_CHUNK_SIZE=1024`, `HIGHRES_CHUNK_SIZE=2048`) so every entry point agrees. If a profile needs fast events, `from_profiles` caps a larger base chunk_size at 2048; the per-profile `from_single_profile` path (used by `ParallelEngine`) additionally scales `min_magnitude` and `frequency_tolerance` to the chosen chunk size.

### Parallel Engine

`ParallelEngine` runs multiple isolated `Engine` instances sharing one audio input. Each gets a bespoke `EngineConfig` computed from its single profile — so a slow loud smoke alarm and a fast quiet medical beep can have totally different sensitivity settings without interference.

### Browser Tuner ↔ Python Engine

The React app (`tuner/`) does its own client-side FFT analysis for interactive feedback. The validation API (`src/acoustic_engine/tuner/validate.py`) runs the **real** engine pipeline (SpectralMonitor → FrequencyFilter → EventGenerator → WindowedMatcher) on uploaded audio + profile YAML, returning tone events and pattern matches. The browser overlays both results so users can see where they diverge.

### CLI, Presets, Learn (the easy path)

`cli.py` is the single `acoustic-engine` entry point (subcommands run/learn/test/profiles/serve); `runner.py` is factored into reusable pieces (`load_configs`, `build_pipelines`, `init_mqtt`, `run_pipelines`) that the CLI shares. `presets/` ships ready-to-use standardized profiles (ISO 8201 T3/T4) loadable by name via `load_preset()`. `learn.py` runs the real DSP front-end on a recording, collapses harmonics, splits the signal into repeated cycles and averages the modal cycle into a profile — the on-device "record → profile → detect" loop. Profiles are validated at YAML load time (`profiles.validate_profile`, raising `ProfileError`); config errors raise `ConfigError` (`errors.py`).

## Key Data Flow

Audio chunk (int16) → `SpectralMonitor.process()` → `List[Peak]` → `FrequencyFilter.filter_peaks()` → `List[Peak]` → `EventGenerator.process()` → `List[ToneEvent]` → `WindowedMatcher.add_event()` + `evaluate()` → `List[PatternMatchEvent]`

## Profile YAML Schema

```yaml
name: "Alarm_Name"
confirmation_cycles: 2
reset_timeout: 10.0           # optional, cooldown seconds before re-arming after a detection
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
