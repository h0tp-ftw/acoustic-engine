# Changelog

## 1.3.0

### Added
- **Rhythm-specific matching.** The pattern matcher now validates the silence
  *between* tones, not just the tones themselves — correctly-pitched beeps at the
  wrong spacing (a different cadence) are no longer detected as the alarm. The
  gap check is reverb-tolerant (a reverb tail that inflates a tone's measured
  duration is credited back to the following gap) and skips sub-150 ms gaps that
  are too short to measure reliably, so fast patterns (e.g. a CO T4) still
  detect. Existing profiles need no changes — they just get more specific.

## 1.2.1

### Fixed
- Event-resolution defaults are now consistent. A partial `resolution:` block
  (e.g. only `min_tone_duration`) filled the missing field with a 5× coarser
  stale value (`dropout_tolerance` 0.15) instead of the engine's real default
  (0.03), in both the profile loader and the tuner validation API.
  `ResolutionConfig` and the live pipeline now share one source of truth
  (0.04 / 0.03).

### Changed
- Documentation reconciled with the 1.2.0 surface (sounddevice capture,
  `devices` / `doctor`, detection actions); CI actions bumped to their Node 24
  runtimes; removed dead code and two misnamed scratch profiles.

## 1.2.0

The theme of this release is **frictionless deployment** — turning a laptop into
an alarm detector should be one `pip install` and one command.

### Added
- **`acoustic-engine devices`** lists input devices, and **`acoustic-engine doctor`**
  runs a live level meter plus a dominant-frequency check, so you can confirm your
  microphone works in seconds before trying to detect anything.
- **Act on detections without a broker**: `--on-detect "command"` runs a shell
  command on each detection (`{name}`/`{timestamp}` substituted, `$ALARM_NAME` /
  `$ALARM_TIMESTAMP` exported) and `--webhook URL` POSTs a JSON
  `{event, profile_name, timestamp}`. Both are also configurable via an `actions:`
  block in a config file.

### Changed
- **Microphone capture now uses `sounddevice`** instead of PyAudio. Its macOS and
  Windows wheels bundle PortAudio, so `pip install` needs no system packages on a
  laptop; Linux needs only the lightweight `libportaudio2` runtime (no compiler or
  dev headers). PyAudio still works as a fallback: `pip install 'acoustic-engine[pyaudio]'`.
- **`scipy` is no longer a runtime dependency.** The engine never imported it; only
  the benchmark suite does, now under the `dev` extra. Installs are smaller and
  faster on laptops and Raspberry Pis.
- The README no longer bills the project as an "open standard" (it is CC BY-NC);
  the tagline now reflects what it is — lightweight, deterministic DSP detection.

## 1.1.0

The theme of this release is **making the engine easy to use** — the common path
now needs no signal-processing knowledge.

### Added
- **Unified `acoustic-engine` CLI** with subcommands `run`, `learn`, `test`,
  `profiles`, and `serve`. One front door instead of several `python -m` modules.
  See [docs/cli.md](docs/cli.md).
- **`acoustic-engine learn recording.wav`** — turns a recording of your alarm
  into a working profile automatically (the on-device record → profile → detect
  loop). See [docs/getting-started.md](docs/getting-started.md).
- **Built-in presets** for standardized alarms (ISO 8201 T3 smoke, T4 CO),
  usable with `--preset` and listed by `acoustic-engine profiles`.
- **Profile/config validation** with clear, human-readable errors (`ProfileError`,
  `ConfigError`) at load time, plus a public `validate_profile()`.
- **Task-oriented documentation**: Getting Started, CLI reference, Profiles &
  Troubleshooting, and a systemd/Docker deployment guide.
- `[mqtt]` install extra; a `deploy/` systemd unit for reboot-survival.

### Fixed
- `include:` in config files now actually expands **globs and directories**
  (previously a silent no-op).
- Unknown `engine:` settings (typos) now raise instead of being silently dropped.
- `reset_timeout` now drives the detection cooldown (it was parsed but unused;
  the cooldown was a hardcoded 10 s).
- `ParallelEngine.from_config()` no longer crashes.
- The default `chunk_size` is consistent across every entry point (1024); the
  same profiles no longer detect differently via `Engine()` vs `from_yaml()`.
- `acoustic-engine learn` extracts at high resolution so fast patterns (e.g. a
  CO T4) aren't merged into one tone, and attaches a `resolution` block when
  needed so the saved profile is self-contained.
- `save_profile_to_yaml` now preserves the `resolution` block (save → reload is
  lossless).
- `acoustic-engine serve` fails with a friendly message when the `tuner` extra
  is missing instead of a traceback.

### Changed
- `paho-mqtt` moved from a hard dependency to the optional `[mqtt]` extra.
- README now leads with the CLI and the three-tier mental model
  (presets → learn + edit → advanced tuning).

## 1.0.0

Initial release: DSP detection pipeline, YAML profiles, parallel engine, browser
tuner with validation API, MQTT notifications.
