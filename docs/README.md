# Documentation

Start here and go as deep as you need.

| If you want to… | Read |
| :-- | :-- |
| **Get something detecting in 10 minutes** | [Getting Started](getting-started.md) |
| Look up a command or flag | [CLI Reference](cli.md) |
| Understand or tweak a profile, or fix detection problems | [Profiles & Troubleshooting](profiles.md) |
| Run it as a service / in Docker | [Deployment](../deploy/README.md) |
| Reach for the advanced engine knobs | [Tuning Guide](tuning_guide.md) |
| Understand how the engine works inside | [Architecture](../ARCHITECTURE.md) |

## The 30-second version

```bash
pip install acoustic-engine            # + system PortAudio (see Getting Started)

acoustic-engine profiles               # what can I detect out of the box?
acoustic-engine run --preset smoke_t3  # detect a standard smoke alarm, zero config

acoustic-engine learn my_alarm.wav --name "My Dryer"   # turn a recording into a profile
acoustic-engine test --profile my_alarm.yaml --audio my_alarm.wav -v   # verify it
acoustic-engine run --profile my_alarm.yaml            # deploy it
```

## How to think about it

There are three tiers, and most sounds only need the first one:

1. **Presets** — ready-made profiles for standardized alarms. Zero config.
2. **`learn` + edit the shape** — record your sound, let the engine write the
   profile, then nudge frequencies/durations in plain YAML if needed. No signal
   processing knowledge required.
3. **Advanced tuning** — a couple of dozen engine knobs for hard environments.
   You will rarely come here; when you do, the [Tuning Guide](tuning_guide.md)
   maps symptoms to settings.
