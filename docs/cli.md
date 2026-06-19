# CLI Reference

Everything is behind one command:

```
acoustic-engine <command> [options]

  run        Run detection (from presets, profiles, or a config).
  learn      Build a profile YAML from a recording.
  test       Test a profile/preset against audio.
  profiles   List built-in presets.
  devices    List microphones (input devices).
  doctor     Check the mic works: live level meter + dominant frequency.
  serve      Run the validation API used by the browser tuner.
```

`acoustic-engine --version` prints the version. Add `-h` / `--help` to any
command for its options.

> The module forms still work if you prefer them
> (`python -m acoustic_engine.runner`, `python -m acoustic_engine.tester`,
> `python -m acoustic_engine.tuner`); the CLI wraps these.

---

## `run` — detect alarms

Runs the detector on live microphone input until interrupted (Ctrl-C).

```
acoustic-engine run [-c CONFIG] [-p PRESET] [-f PROFILE] [--device N] [--sample-rate HZ]
                    [--on-detect CMD] [--webhook URL]
```

| Option | Description |
| :-- | :-- |
| `-p, --preset NAME` | Built-in preset to detect (repeatable). See `acoustic-engine profiles`. |
| `-f, --profile FILE` | Profile YAML to detect (repeatable). |
| `-c, --config FILE` | Full config YAML — audio settings, multiple profiles, MQTT, actions (repeatable). |
| `--device N` | Input device index (which microphone — see `acoustic-engine devices`). |
| `--sample-rate HZ` | Capture sample rate (default 44100). |
| `--on-detect CMD` | Shell command to run on each detection. `{name}`/`{timestamp}` are substituted; `$ALARM_NAME`/`$ALARM_TIMESTAMP` are exported. |
| `--webhook URL` | POST a JSON `{event, profile_name, timestamp}` to this URL on each detection. |

With no source given, `run` falls back to `$ACOUSTIC_CONFIG`, then `./config.yaml`.
You can mix sources, e.g. a config plus an extra preset. CLI `--on-detect` /
`--webhook` override an `actions:` block in a config file.

```bash
acoustic-engine run --preset smoke_t3                 # one preset
acoustic-engine run --preset smoke_t3 --preset co_t4  # several at once
acoustic-engine run --profile my_alarm.yaml
acoustic-engine run --config config.yaml              # production
acoustic-engine run --config config.yaml --preset co_t4

# Act on a detection without any broker:
acoustic-engine run --preset smoke_t3 --on-detect 'notify-send "Alarm: {name}"'
acoustic-engine run --preset smoke_t3 --webhook https://ntfy.sh/my-alarms
```

---

## `learn` — recording → profile

Runs the real DSP front-end on a recording, finds the repeating pattern, and
writes a working profile YAML.

```
acoustic-engine learn AUDIO [--name NAME] [-o OUTPUT]
```

| Argument / Option | Description |
| :-- | :-- |
| `AUDIO` | Path to a recording of the alarm (16-bit PCM WAV). |
| `--name NAME` | Name for the profile (defaults to the file name). |
| `-o, --output FILE` | Output path (defaults to `<audio>.yaml`). |

```bash
acoustic-engine learn dryer.wav --name "My Dryer"          # -> dryer.yaml
acoustic-engine learn dryer.wav -o profiles/dryer.yaml
```

Tips for a good result: record 10–20 s with several repeats of the pattern and
minimal background noise. WAV only — convert other formats first
(`ffmpeg -i in.mp3 -ac 1 -ar 44100 out.wav`). Always verify the result with
`test`. See the [Profiles guide](profiles.md) if the pattern needs a tweak.

---

## `test` — check a profile against audio

Runs a profile (or preset) through the real engine and reports detections.
Works on an audio file or a live microphone.

```
acoustic-engine test (--profile FILE | --preset NAME) (-a AUDIO | --live)
                     [-v] [-n NOISE] [--noise-type {white,pink,brown}]
                     [-d DURATION] [--high-res]
```

| Option | Description |
| :-- | :-- |
| `--profile FILE` | Profile YAML, or a directory of profiles. |
| `--preset NAME` | Test a built-in preset instead of a file. |
| `-a, --audio FILE` | Audio file to test against (WAV). |
| `--live` | Use live microphone input. |
| `-v, --verbose` | Show every detected tone event (great for debugging). |
| `-n, --noise LEVEL` | Mix in noise (0.0–1.0) to check robustness. |
| `--noise-type` | `white`, `pink`, or `brown` (default white). |
| `-d, --duration SEC` | Time limit for `--live` (default: until Ctrl-C). |
| `--high-res` | Smaller gap tolerance for very fast patterns (<100 ms gaps). |

```bash
acoustic-engine test --profile my_alarm.yaml --audio recording.wav -v
acoustic-engine test --preset smoke_t3 --audio recording.wav
acoustic-engine test --profile profiles/ --live --duration 60
acoustic-engine test --profile my_alarm.yaml --audio recording.wav --noise 0.3
```

---

## `profiles` — list built-in presets

```bash
acoustic-engine profiles
```

Prints each preset's name, the sound it matches, and a one-line summary. Use a
name with `run --preset` or `test --preset`.

---

## `devices` — list microphones

```bash
acoustic-engine devices
```

Prints each input device with its index, name, channel count, and which backend
saw it. Use an index with `run --device N` or `doctor --device N`.

---

## `doctor` — is the mic working?

Captures a few seconds from the microphone, shows a live level meter, and
reports the loudest frequency plus a plain-English verdict — the fastest way to
confirm capture works before you try to detect anything.

```
acoustic-engine doctor [--device N] [--seconds SEC]
```

| Option | Description |
| :-- | :-- |
| `--device N` | Input device index to test (see `acoustic-engine devices`). |
| `--seconds SEC` | How long to listen (default 5). |

```bash
acoustic-engine doctor                 # test the default input for 5s
acoustic-engine doctor --device 2 --seconds 8
```

---

## `serve` — validation API for the browser tuner

Starts the HTTP server the React tuner calls to run audio + a profile through
the real engine. Requires the tuner extra (`pip install "acoustic-engine[tuner]"`).

```
acoustic-engine serve [--port PORT] [--host HOST]
```

```bash
acoustic-engine serve --port 8787              # then run the tuner: cd tuner && npm run dev
acoustic-engine serve --host 0.0.0.0           # expose on the network
```

---

## Exit codes

`0` on success, `1` on a usage error or a bad profile/config (the message tells
you what to fix).
