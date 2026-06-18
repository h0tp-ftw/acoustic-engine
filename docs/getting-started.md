# Getting Started

This walks you from zero to a working alarm detector in about ten minutes. You
do **not** need to understand any signal processing — that's the whole point.

By the end you'll have:

1. Heard the engine detect a standard alarm with no configuration.
2. Turned a recording of *your own* alarm into a detector automatically.
3. Run it for real and (optionally) kept it running across reboots.

---

## Install

```bash
# Latest (includes the CLI, presets, and `learn` — recommended for now)
pip install "git+https://github.com/h0tp-ftw/acoustic-engine.git"

# Or the stable PyPI release (needs 1.1+ for the commands in this guide)
pip install acoustic-engine
```

The engine captures audio with PyAudio, which needs the PortAudio system
library. If `pip install` complains about PortAudio:

| OS | Install PortAudio |
| :-- | :-- |
| Debian / Ubuntu / Raspberry Pi OS | `sudo apt install portaudio19-dev` |
| macOS (Homebrew) | `brew install portaudio` |
| Windows | nothing to do — the PyAudio wheel is self-contained |

Optional features are extras: `pip install "acoustic-engine[mqtt]"` (publish
detections to MQTT) and `pip install "acoustic-engine[tuner]"` (the browser
profile builder). You can combine them: `pip install "acoustic-engine[mqtt,tuner]"`.

Check it installed:

```bash
acoustic-engine --version
```

---

## Step 1 — See it work (no config, no recording)

The engine ships with ready-made profiles for the two standardized life-safety
alarms. List them:

```bash
acoustic-engine profiles
```

```
Built-in presets (use with: acoustic-engine run --preset NAME):

  co_t4        CO Alarm (T4)
               4 tones, 3000-3400 Hz, 2 cycle(s)
  smoke_t3     Smoke Alarm (T3)
               3 tones, 3000-3400 Hz, 2 cycle(s)
```

To prove it detects without needing a microphone yet, make a 16-second practice
clip of a T3 smoke alarm and test the preset against it. Save this as
`make_clip.py` and run `python make_clip.py`:

```python
import math, struct, wave

sr = 44100
def beep(dur, freq=3100.0):
    return [int(0.6 * 32767 * math.sin(2 * math.pi * freq * (i / sr))) for i in range(int(dur * sr))]
def silence(dur):
    return [0] * int(dur * sr)

# Three beeps + a long gap (a T3-style smoke alarm), repeated four times.
samples = []
for _ in range(4):
    samples += beep(0.5) + silence(0.5) + beep(0.5) + silence(0.5) + beep(0.5) + silence(1.5)

with wave.open("practice_alarm.wav", "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes(struct.pack(f"<{len(samples)}h", *samples))
print("Wrote practice_alarm.wav")
```

Now test the built-in preset against it:

```bash
acoustic-engine test --preset smoke_t3 --audio practice_alarm.wav
```

```
  Status: ✓ PASS
  Detections: 3
```

That's the engine's real detection pipeline confirming the alarm. To listen on
a live microphone instead, run (Ctrl-C to stop):

```bash
acoustic-engine run --preset smoke_t3
```

---

## Step 2 — Teach it *your* alarm

Most real alarms (your dishwasher, dryer, a specific medical monitor) aren't a
standard T3/T4. Instead of hand-writing a profile, record the sound once and let
the engine learn it.

**Record ~10–20 seconds** of the alarm as a WAV — a few repeats of the pattern,
as little background noise as possible. Any recorder works; on Linux you can use:

```bash
arecord -f S16_LE -r 44100 -c 1 my_alarm.wav   # Ctrl-C when done
```

(If your recording is an MP3/M4A, convert it: `ffmpeg -i clip.mp3 -ac 1 -ar 44100 my_alarm.wav`.)

**Learn a profile from it:**

```bash
acoustic-engine learn my_alarm.wav --name "My Dryer"
```

```
Wrote profile 'My Dryer' (6 segments) to my_alarm.yaml
Verify it against the recording with:
  acoustic-engine test --profile my_alarm.yaml --audio my_alarm.wav -v
```

The engine extracts the repeating tone/silence pattern and writes a ready-to-use
`my_alarm.yaml`. **Verify it** against the recording:

```bash
acoustic-engine test --profile my_alarm.yaml --audio my_alarm.wav -v
```

If it says `✓ PASS`, you're done — skip to Step 3.

If it doesn't detect, or it fires on the wrong sounds, you have two easy levers
before touching anything advanced:

- **Re-record** a cleaner, louder sample and `learn` again. Garbage in, garbage out.
- **Open `my_alarm.yaml` and widen the shape** — it's just frequencies (Hz) and
  durations (seconds). Bump a `frequency` range out by ±100 Hz, or a `duration`
  range a little wider. No DSP needed. See the [Profiles guide](profiles.md).

---

## Step 3 — Run it for real

Foreground (good for trying things out — Ctrl-C to stop):

```bash
acoustic-engine run --profile my_alarm.yaml
# or a preset, or several at once:
acoustic-engine run --preset smoke_t3 --preset co_t4
```

When an alarm is detected you'll see:

```
🚨 DETECTED: My Dryer
```

### Do something when it fires

To trigger automations (Home Assistant, Node-RED, a phone notification), publish
detections to MQTT. Create `config.yaml`:

```yaml
profiles:
  - include: "my_alarm.yaml"      # globs and directories work too

mqtt:
  enabled: true
  broker: "192.168.1.10"
  topic: "home/alarms"
```

```bash
pip install "acoustic-engine[mqtt]"
acoustic-engine run --config config.yaml
```

Each detection publishes `{"event": "detected", "profile_name": "...", "timestamp": "..."}`.

### Keep it running across reboots

On a Raspberry Pi or any Linux box, run it as a service. See
[deploy/README.md](../deploy/README.md) for a ready-to-use systemd unit and a
Docker Compose setup. The short version:

```bash
sudo cp deploy/acoustic-engine.service /etc/systemd/system/
sudo systemctl enable --now acoustic-engine
journalctl -u acoustic-engine -f      # watch detections live
```

---

## Where to go next

- **[Profiles guide](profiles.md)** — understand and tweak the YAML, plus a
  troubleshooting checklist for "it won't detect" and "false alarms".
- **[CLI reference](cli.md)** — every command and option.
- **[Deployment](../deploy/README.md)** — systemd, Docker, hardware tips.
- **[Tuning guide](tuning_guide.md)** — the advanced engine knobs, for the rare
  case the easy levers aren't enough.
