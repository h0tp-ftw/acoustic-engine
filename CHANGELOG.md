# Changelog

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
