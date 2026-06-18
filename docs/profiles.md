# Profiles

A **profile** describes one sound you want to detect. You rarely write one from
scratch — `acoustic-engine learn` generates them and the built-in presets cover
the standard alarms — but understanding the YAML lets you tweak a detector in
seconds without touching any signal processing.

## The mental model

An alarm is a **repeating rhythm of tones and silences**. The engine doesn't
recognise "a beep"; it recognises *this pitch, for this long, this many times,
with these gaps* — the rhythm is what makes detection specific. So a profile is
just an ordered list of `tone` and `silence` segments that make up **one cycle**
of the pattern, plus how many cycles to require.

```yaml
name: "Dishwasher Done"
confirmation_cycles: 2          # require the cycle twice before alerting
segments:
  - type: tone
    frequency: { min: 2000, max: 2200 }   # Hz
    duration:  { min: 0.15, max: 0.30 }   # seconds
  - type: silence
    duration:  { min: 0.10, max: 0.25 }
  - type: tone
    frequency: { min: 2000, max: 2200 }
    duration:  { min: 0.15, max: 0.30 }
  - type: silence
    duration:  { min: 1.50, max: 3.00 }   # the long gap before it repeats
```

Read that as: *beep (~2 kHz, ~0.2 s), short gap, beep, long gap — and I want to
see that whole thing happen twice.*

## Field reference

### Top level

| Field | Default | Meaning |
| :-- | :-- | :-- |
| `name` | `UnnamedProfile` | A label for logs and MQTT messages. |
| `segments` | — | The ordered tone/silence list for **one cycle** (required). |
| `confirmation_cycles` | `1` | How many full cycles must match before it alerts. `2`–`3` for critical alarms to avoid false positives. |
| `reset_timeout` | `10.0` | Cooldown in seconds after a detection before it will fire again. |
| `resolution` | auto | High-resolution override for fast patterns (see below). |

### Segments

Each segment is a `tone`, a `silence`, or `any` (a wildcard duration).

| Field | Applies to | Meaning |
| :-- | :-- | :-- |
| `type` | all | `tone`, `silence`, or `any`. |
| `frequency` | tone | Pitch range in Hz, as `{ min, max }`. |
| `duration` | all | How long the segment lasts, in seconds, as `{ min, max }`. |

### Shorthand: single values

You can give a single number instead of a `{min, max}` range and the engine adds
sensible tolerance for you:

```yaml
- type: tone
  frequency: 3000      # becomes 2850–3150 Hz  (±5%)
  duration: 0.5        # becomes 0.40–0.60 s    (±20%)
```

Use this to write profiles fast; switch to explicit `{min, max}` when you need
tighter or looser bounds.

### High-resolution patterns

For alarms with very short tones/gaps (a CO T4's 0.1 s chirps), add a
`resolution` block so the engine doesn't blur the fast features into one tone:

```yaml
resolution:
  min_tone_duration: 0.05    # shortest blip counted as a tone
  dropout_tolerance: 0.05    # gaps shorter than this are bridged, not split
```

`acoustic-engine learn` adds this automatically when it detects a fast pattern,
and the built-in `co_t4` preset includes it.

## Loading profiles

Profiles reach the engine in several ways:

```bash
acoustic-engine run --preset smoke_t3          # built-in
acoustic-engine run --profile my_alarm.yaml    # a file
```

Or from a config file, which can inline profiles **and** include external ones —
globs and directories both work:

```yaml
profiles:
  - include: "profiles/*.yaml"     # every YAML in the folder
  - include: "profiles/dryer.yaml" # a single file
  - name: "Inline Alarm"           # or define one right here
    segments:
      - type: tone
        frequency: 3100
        duration: 0.5
      - type: silence
        duration: 1.0
```

A single profile file may contain one profile, a list of them, or a
`{profiles: [...]}` block.

## Validation

Profiles are checked when they load, and mistakes fail loudly with a message
that names the segment at fault — a tone with no frequency, a `min` greater than
a `max`, a profile with no tones, and so on. If a profile loads without error,
it is structurally sound (whether it *detects well* is what `test` is for).

---

## Troubleshooting

Use `acoustic-engine test --profile <file> --audio <recording> -v` while you
work — `-v` prints every tone the engine heard, so you can see *why* it did or
didn't match. Work down each list; the easy fixes are first.

### It doesn't detect the alarm (false negatives)

1. **Re-learn from a cleaner recording.** A louder, less noisy clip with a few
   clean repeats fixes most problems. `acoustic-engine learn` again.
2. **Check the frequency.** Run `test -v` and look at the `f=` values of the
   tones it heard. If they sit outside your profile's `frequency` range, widen
   the range (e.g. ±150 Hz) — alarms drift with temperature and battery level.
3. **Loosen the durations.** Real beeps vary; widen `duration` ranges,
   especially if the engine is splitting or merging tones.
4. **Lower `confirmation_cycles`** to `1` while debugging, so you only need one
   cycle to fire.
5. **Fast pattern?** If the alarm has sub-100 ms beeps/gaps, add the
   `resolution` block above (or pass `--high-res` to `test`).
6. Still nothing? Reach for the engine sensitivity knobs in the
   [Tuning guide](tuning_guide.md) (e.g. lower `min_magnitude` for a quiet alarm).

### It fires on the wrong sounds (false positives)

1. **Raise `confirmation_cycles`** to `2` or `3`. Requiring the rhythm to repeat
   is the single most effective filter against random noise.
2. **Tighten the frequency range** so speech/music/clatter outside the alarm's
   band is ignored.
3. **Tighten the durations** to match the real beep more closely.
4. Persistent background noise? See `min_sharpness` and `noise_floor_factor` in
   the [Tuning guide](tuning_guide.md).

### "It detected differently in the tuner vs. the engine"

The browser tuner and the engine should agree because the tuner's **Validate
with Real Engine** button runs the actual pipeline (`acoustic-engine serve`). If
they diverge, trust the engine result and adjust the profile to match it.
