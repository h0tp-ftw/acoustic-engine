# Recording an alarm into a profile

This is the **second tier** of the project: when no built-in [preset](../README.md#cli-tools)
matches your sound, you don't hand-write a profile from scratch — you let the
engine *hear* the alarm and write the profile for you, then nudge it if needed.

You do **not** need any signal-processing knowledge for this. The only skill is
getting a clean recording, which this guide covers in detail.

> **TL;DR** — set off the alarm near your mic and run:
> ```bash
> acoustic-engine learn --record --name "My Dryer"
> ```
> Press Enter to stop. You get `my_dryer.yaml` (the profile) and `my_dryer.wav`
> (the recording, kept for re-testing). Verify it, tweak if needed, deploy.

---

## The loop

```
  record  ─►  learn  ─►  verify  ─►  (tweak)  ─►  run
   mic         YAML       test        edit YAML     detect
```

Every step is one command. You'll usually go straight through; the *tweak* loop
is only for sounds the auto-inference doesn't nail on the first pass.

| Step | Command |
| :-- | :-- |
| **Record + learn** | `acoustic-engine learn --record --name "My Dryer"` |
| **Verify** | `acoustic-engine test --profile my_dryer.yaml --audio my_dryer.wav -v` |
| **Tweak** (optional) | edit `my_dryer.yaml` — just Hz and seconds ([Profiles guide](profiles.md)) |
| **Run** | `acoustic-engine run --profile my_dryer.yaml` |

---

## Before you record: check the mic

Confirm the engine can hear, and find the right input, before you try to learn
anything:

```bash
acoustic-engine devices     # list input devices; note the index you want
acoustic-engine doctor      # 5s live level meter + "your mic works" verdict
```

If `doctor` barely hears anything, the mic is muted or you're on the wrong
device — retry with `acoustic-engine doctor --device N` using an index from
`devices`. The same `--device N` works for `learn --record`.

See the [CLI reference](cli.md#devices--list-microphones) for both commands.

---

## `learn --record` in depth

```
acoustic-engine learn --record [--device N] [--seconds SEC]
                      [--sample-rate HZ] [--name NAME] [-o OUTPUT]
```

### Two ways to capture

**Interactive (the default at a terminal).** With no `--seconds`, `learn`
prompts you to press Enter to start, shows a live level meter while it records,
and stops when you press Enter again (or after a 60 s safety cap). Use this when
you're at the machine and want to control exactly what gets captured:

```bash
acoustic-engine learn --record --name "My Dryer"
```
```
Recording from [1] USB Audio (44100 Hz).
Tip: let it run for several full alarm cycles so the pattern is clear.
Set off the alarm, then press Enter to start recording... ⏎
Recording — press Enter to stop.
  level |######################--------| -11.4 dBFS
```

**Timed (`--seconds`).** Captures for a fixed number of seconds, no prompts.
Use this in scripts, over a flaky SSH session, or when you've already got the
alarm going and just want a clean window:

```bash
acoustic-engine learn --record --seconds 15 --name "My Dryer"
```

> If standard input isn't a terminal (e.g. a piped or headless run) and you
> didn't pass `--seconds`, `learn` falls back to a **12-second** timed capture
> automatically, so it never hangs waiting for an Enter that can't come.

### Options

| Option | Default | What it does |
| :-- | :-- | :-- |
| `-r, --record` | — | Capture from the mic instead of reading a file. |
| `--device N` | system default | Input device index (from `acoustic-engine devices`). |
| `--seconds SEC` | interactive / 12 s | Fixed-duration capture; omit for press-Enter-to-stop. |
| `--sample-rate HZ` | `44100` | Capture rate. 44.1 kHz suits alarms up to ~20 kHz; rarely change it. |
| `--name NAME` | `Recorded Alarm` | Profile name; also used to name the output files. |
| `-o, --output FILE` | `<slug-of-name>.yaml` | Where to write the profile YAML. |

### What you get

Two files, side by side:

```
Wrote profile 'My Dryer' (6 segments) to my_dryer.yaml
Kept the recording at my_dryer.wav

Inferred pattern (sanity-check it, then hand-edit the YAML if needed):
  tone      2960-3240  Hz for 0.42-0.58s
  silence                 0.30-0.75s
  tone      2960-3240  Hz for 0.42-0.58s
  silence                 0.30-0.75s
  tone      2960-3240  Hz for 0.42-0.58s
  silence                 1.20-3.00s
Verify it against the recording with:
  acoustic-engine test --profile my_dryer.yaml --audio my_dryer.wav -v
Then run it live with:
  acoustic-engine run --profile my_dryer.yaml
```

- **`my_dryer.yaml`** — the profile, ready to use.
- **`my_dryer.wav`** — the exact audio it learned from. It's kept on purpose so
  you can re-`test`, re-`learn`, or open it in the [browser tuner](#re-using-the-recording)
  later **without setting the alarm off again**. (Learning from a file does not
  copy the WAV — it's already on disk.)

The output filename comes from `--name`: `"My Dryer"` → `my_dryer.yaml`. Override
the path with `-o`, e.g. `-o profiles/dryer.yaml` (the WAV follows it:
`profiles/dryer.wav`).

---

## How to record well

Garbage in, garbage out — a clean capture is 90% of a good profile. Aim for:

| Aim for | Why |
| :-- | :-- |
| **Several full cycles** (10–20 s of a slow alarm) | The inference finds the *repeating* unit by comparing cycles. One cycle gives it nothing to average; many give a stable pattern. |
| **A strong, clean level** — meter bars well filled, peak roughly **−20 to −6 dBFS** | Too quiet (below ~−45 dBFS) is rejected outright; near 0 dBFS clips and distorts the pitch. |
| **The alarm dominating the room** | Move the mic closer / the alarm louder. The engine keys on the loudest tones; background TV or speech competing with the alarm muddies the pattern. |
| **Steady background** | A fan or hum is fine (the engine adapts to steady noise); a slamming door or clatter mid-recording can inject phantom tones. |

What to avoid: recording from across the room, talking over it, MP3/Bluetooth
recordings that have been heavily compressed (they smear the pitch), and stopping
after a single beep.

If the first try is poor, **just record again** — it's the fastest fix, and
cheaper than editing YAML by hand.

---

## Reading the inferred pattern

The summary printed after learning is one line per segment of **one cycle**:

```
  tone      2960-3240  Hz for 0.42-0.58s     ← a beep: this pitch band, this long
  silence                 0.30-0.75s         ← the gap after it
  ...
  silence                 1.20-3.00s         ← the long gap before the cycle repeats
```

Sanity-check three things against what you hear:

1. **Tone count.** Does the number of `tone` lines match the beeps you hear per
   cycle? (3 beeps → 3 `tone` lines.) Too few means beeps got merged; too many
   means noise leaked in or one beep got split.
2. **Frequencies.** A household smoke alarm is ~3 kHz; a microwave/dishwasher
   chime is often ~2 kHz. Wildly different numbers suggest it locked onto a
   harmonic or background sound.
3. **Durations.** Roughly match the beep length and gaps you hear.

If all three look right, you're almost certainly done — verify and ship. If not,
see [Troubleshooting](#troubleshooting) below.

---

## Verifying

Always confirm the learned profile actually detects its own recording:

```bash
acoustic-engine test --profile my_dryer.yaml --audio my_dryer.wav -v
```

`-v` (verbose) prints **every tone the engine heard** with its frequency (`f=`),
so when something doesn't match you can see *why*. A `✓ PASS` means the rhythm
was found the required number of times. See [`test`](cli.md#test--check-a-profile-against-audio)
for all options (including `--noise` to stress-test against background noise).

---

## Tweaking by hand

The profile is plain YAML — frequencies in Hz, durations in seconds. You never
touch signal processing to adjust it. The two highest-leverage edits:

```yaml
- type: tone
  frequency: { min: 2900, max: 3300 }   # widen if the alarm drifts (battery/temperature)
  duration:  { min: 0.30, max: 0.70 }   # widen if beeps vary in length
```

and the false-positive guard:

```yaml
confirmation_cycles: 2   # require the whole rhythm twice — the best noise filter
```

The full field reference, the single-value shorthand (`frequency: 3000` →
±5%), and a symptom-by-symptom troubleshooting list live in the
**[Profiles & Troubleshooting guide](profiles.md)**.

---

## Re-using the recording

Because the WAV is kept, you can iterate without re-recording:

```bash
# Try a tighter profile and re-check it against the same audio
acoustic-engine test --profile my_dryer.yaml --audio my_dryer.wav -v

# Re-learn with a different name / output
acoustic-engine learn my_dryer.wav --name "Dryer v2" -o dryer_v2.yaml
```

You can also open the WAV and the profile together in the **browser tuner** for a
visual view of where they agree or diverge. Start the validation API and load
both in the React app:

```bash
acoustic-engine serve --port 8787        # needs: pip install "acoustic-engine[tuner]"
```

See the tuner section of the [main README](../README.md#profile-tuner-browser-app).

---

## Learning from a file instead

`learn` works the same on a WAV you recorded elsewhere — handy when the alarm is
somewhere your detector machine isn't, so you capture on a phone and learn on the
Pi:

```bash
acoustic-engine learn my_alarm.wav --name "My Dryer"      # -> my_alarm.yaml
```

The input must be a **16-bit PCM WAV**. Convert anything else first:

```bash
# Record on Linux directly to the right format (Ctrl-C to stop)
arecord -f S16_LE -r 44100 -c 1 my_alarm.wav

# Convert a phone recording / MP3 / M4A
ffmpeg -i clip.mp3 -ac 1 -ar 44100 my_alarm.wav
```

The same recording-quality advice applies: a few clean cycles, loud and close,
minimal background.

---

## How `learn` works (the short version)

You don't need this to use `learn`, but it explains *why* the troubleshooting
fixes work. The recording runs through the **real engine front-end** — the same
DSP that does live detection — and then:

1. **Extracts tones.** An FFT per ~23 ms chunk finds the dominant pitches; short
   blips and dropouts are debounced into clean tone events.
2. **Drops the weak and the duplicate.** Tones quieter than ~35% of the loudest
   are discarded (noise), and overlapping tones (a fundamental and its harmonic
   ringing together) are collapsed to the louder one.
3. **Finds the repeating cycle.** It splits the events into bursts at the long
   gaps, then picks the cycle length that best explains the recording — so a
   noisy first cycle (mic warm-up) loses to the real, repeated pattern.
4. **Averages a representative cycle** and writes tone/silence segments with
   sensible tolerance baked in (roughly ±4% or ±50 Hz on pitch, and ~0.6×–1.5×
   on durations), plus `confirmation_cycles: 2`.
5. **Adds a high-resolution block automatically** when the pattern has sub-~120 ms
   features (e.g. a CO **T4**'s 0.1 s chirps), so fast beeps aren't blurred into
   one tone. You'll see a `(high-res: …)` line in the summary when this happens.

It is a **heuristic starting point**, not magic — which is exactly why the
verify-and-tweak steps exist.

---

## Troubleshooting

| Symptom (from `learn`) | Cause | Fix |
| :-- | :-- | :-- |
| `No working audio backend found` | No capture library/PortAudio | Install per the message: `pip install sounddevice` (Linux: `sudo apt install libportaudio2`). Then `acoustic-engine devices`. |
| `I barely heard anything (peak … dBFS)` | Mic muted, wrong device, or too far | Pick the right input: `acoustic-engine devices` → `learn --record --device N`. Move closer / raise the alarm. |
| `Captured no audio` | Device opened but delivered nothing | Try another `--device N`; check OS mic permissions. |
| `No tones were detected in the recording` | Too quiet/noisy, or not a repetitive tonal alarm | Re-record louder and closer with several clean cycles. Melodic chimes may need a hand-written profile. |
| **Wrong number of tones** (beeps merged or split) | Fast pattern blurred, or noise leaked in | Re-record cleaner. For genuinely fast alarms, confirm the summary shows a `(high-res: …)` line; if not, add a [`resolution` block](profiles.md#high-resolution-patterns). |
| **Frequencies look wrong** (e.g. double the expected pitch) | Locked onto a harmonic or a background sound | Re-record with the alarm dominating; or just widen/correct the `frequency` range in the YAML. |
| **Verifies fine but misses in the room** | Real-world drift and noise | Widen `frequency`/`duration`, lower `confirmation_cycles` to 1 while debugging. Persistent noise → the [Tuning guide](tuning_guide.md). |
| **Fires on the wrong sounds** | Pattern too loose | Raise `confirmation_cycles` to 2–3 and tighten `frequency`. See [Profiles troubleshooting](profiles.md#it-fires-on-the-wrong-sounds-false-positives). |

When a sound is genuinely outside what the auto-inference handles (ringtone-style
melodies, alarms with no steady repeating rhythm), write the profile by hand —
the [Profiles guide](profiles.md) shows the shape, and it's just a list of
frequencies and durations.

---

## Worked examples

**A slow, simple alarm (dryer / smoke-style T3 — 3 beeps, then a long gap):**

```bash
acoustic-engine learn --record --name "Dryer"
# stop after ~15 s (4–5 cycles)
acoustic-engine test --profile dryer.yaml --audio dryer.wav -v
acoustic-engine run --profile dryer.yaml
```

**A fast alarm (CO detector / T4 — four 0.1 s chirps):** identical commands; the
summary will include a `(high-res: …)` line and the chirps stay separate. If a
timed capture is easier than catching the burst by hand:

```bash
acoustic-engine learn --record --seconds 20 --name "CO Alarm"
```

**Capture elsewhere, learn on the Pi:** record on a phone, AirDrop/scp the file
over, convert, and learn:

```bash
ffmpeg -i voice-memo.m4a -ac 1 -ar 44100 alarm.wav
acoustic-engine learn alarm.wav --name "Garage Alarm"
```

---

## Where to next

- **[Getting Started](getting-started.md)** — the full zero-to-running walkthrough.
- **[Profiles & Troubleshooting](profiles.md)** — edit the YAML shape; fix detection.
- **[CLI Reference](cli.md)** — every command and flag.
- **[Tuning Guide](tuning_guide.md)** — the advanced engine knobs, for hard rooms only.
