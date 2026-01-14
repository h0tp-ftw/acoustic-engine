# Acoustic Alarm Engine

A standalone Python library for detecting acoustic alarm patterns using real-time audio analysis. Identify smoke alarms, CO detectors, washing machine beeps, and other repetitive audio patterns.

## Features

- 🎵 **Real-time FFT Analysis** - Spectral peak detection with configurable thresholds
- 🔍 **Pattern Matching** - State machine-based sequence matching for alarm patterns
- 📋 **YAML Configuration** - Define alarm profiles in simple YAML format
- 🌐 **Web Tuner** - Visual editor for creating and testing alarm profiles
- 🔌 **Callback API** - Easy integration with your own applications

## Installation

```bash
pip install acoustic-alarm-engine
```

Or install from source:

```bash
git clone https://github.com/yourusername/acoustic-alarm-engine.git
cd acoustic-alarm-engine
pip install -e .
```

## Quick Start

```python
from acoustic_alarm_engine import Engine, AudioConfig
from acoustic_alarm_engine.profiles import load_profiles_from_yaml

# Load alarm profiles
profiles = load_profiles_from_yaml("profiles/smoke_alarm.yaml")

# Create engine
engine = Engine(
    profiles=profiles,
    audio_config=AudioConfig(sample_rate=44100, chunk_size=4096),
    on_detection=lambda profile_name: print(f"🚨 ALARM DETECTED: {profile_name}")
)

# Start listening
engine.start()
```

## Defining Alarm Profiles

Create YAML files to define alarm patterns:

```yaml
name: "SmokeAlarm_T3"
confirmation_cycles: 2
segments:
  - type: "tone"
    frequency:
      min: 2900
      max: 3100
    duration:
      min: 0.4
      max: 0.6
  - type: "silence"
    duration:
      min: 0.1
      max: 0.3
  - type: "tone"
    frequency:
      min: 2900
      max: 3100
    duration:
      min: 0.4
      max: 0.6
  - type: "silence"
    duration:
      min: 0.8
      max: 1.2
```

## Web Tuner

Launch the visual tuner to record, analyze, and design alarm profiles:

```bash
python -m acoustic_alarm_engine.tuner
```

Then open http://localhost:8080 in your browser.

## Architecture

```
[Audio Input] → [DSP/FFT] → [Event Generator] → [Sequence Matcher] → [Detection Callback]
```

- **DSP Layer** - Windowed FFT with peak detection
- **Event Generator** - Converts peaks to Tone/Silence events with debouncing
- **Sequence Matcher** - State machine matching events against alarm profiles

## API Reference

### Engine

```python
Engine(
    profiles: List[AlarmProfile],
    audio_config: AudioConfig,
    on_detection: Callable[[str], None]
)
```

### AudioConfig

```python
AudioConfig(
    sample_rate: int = 44100,
    chunk_size: int = 4096,
    channels: int = 1,
    device_index: Optional[int] = None
)
```

### AlarmProfile

```python
AlarmProfile(
    name: str,
    segments: List[Segment],
    confirmation_cycles: int = 1,
    reset_timeout: float = 10.0
)
```

## Development

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Run the tuner
python -m acoustic_alarm_engine.tuner
```

## License

MIT License - See LICENSE file for details.
