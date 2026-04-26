# Deployment Guide: Acoustic Engine

This guide covers advanced deployment strategies, configuration details, and API integration for the Acoustic Engine.

---

## 1. Deployment Modes

The engine supports three primary modes of operation, depending on your hardware constraints and detection requirements.

### A. Standard Mode (Single Engine)

**Best for:** Simple devices detecting a single alarm type or multiple alarms with similar acoustic properties.

- **Architecture**: One `Engine` instance processing audio.
- **Pros**: Lowest CPU/Memory footprint.
- **Cons**: All profiles must share the same sensitivity and timing settings.

```python
from acoustic_engine import Engine
from acoustic_engine.profiles import load_profiles_from_yaml

profiles = load_profiles_from_yaml("profiles/smoke_alarm.yaml")
engine = Engine(profiles=profiles)
engine.start()
```

### B. Parallel Mode (Isolated Pipelines)

**Best for:** Detecting dissimilar alarms simultaneously (e.g., a fast, quiet Medical Beep AND a slow, loud CO Alarm).

- **Architecture**: Multiple `Engine` instances running in parallel, sharing a single audio input.
- **Pros**: Total isolation between profiles. Each gets optimized resolution settings.
- **Cons**: Slightly higher memory usage (~30MB per additional pipeline).

```python
from acoustic_engine.parallel_engine import ParallelEngine

smoke_profile = ...
co_profile = ...

runner = ParallelEngine(pipelines=[smoke_profile, co_profile])
runner.start()
```

### C. High-Resolution Mode

**Best for:** Very fast beeps (<50ms) or rapid-fire patterns (medical monitors, data chirps).

- **Mechanism**: Forces smaller FFT/buffer size (1024 samples vs 4096).
- **Trade-off**: Slightly higher CPU usage but achieves ~23ms temporal resolution.

```yaml
engine:
  chunk_size: 1024
  min_tone_duration: 0.02
  dropout_tolerance: 0.04
```

Or per-profile:

```yaml
resolution:
  min_tone_duration: 0.03
  dropout_tolerance: 0.03
```

---

## 2. Detailed Configuration Reference

The `GlobalConfig` is the single source of truth. It can be loaded from one or multiple YAML files.

### YAML Structure

```yaml
# 1. System Settings
system:
  log_level: "INFO"

# 2. Audio Capture
audio:
  sample_rate: 44100
  chunk_size: 1024
  device_index: null

# 3. Engine Tuning
engine:
  min_magnitude: 10.0
  min_sharpness: 1.5
  noise_floor_factor: 3.0
  frequency_tolerance: 50.0
  min_tone_duration: 0.05
  dropout_tolerance: 0.05

# 4. Alarm Profiles
profiles:
  - include: "profiles/smoke_alarm.yaml"
  - include: "profiles/co_sensor.yaml"
  - name: "Custom_Beep"
    confirmation_cycles: 2
    segments: [...]
```

### Performance Tuning

| Problem                                              | Adjustment                                                                                                                                                 |
| :--------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **False Negatives** (Alarm not detected)             | 1. Decrease `min_magnitude` (10.0 -> 5.0)<br>2. Increase `frequency_tolerance` (50 -> 100)<br>3. Increase `dropout_tolerance` (0.04 -> 0.1)               |
| **False Positives** (Detecting non-alarms)           | 1. Increase `min_sharpness` (1.5 -> 2.0)<br>2. Increase `confirmation_cycles` in profile (1 -> 2)<br>3. Tighten frequency ranges in profile               |
| **High CPU Usage**                                   | 1. Increase `chunk_size` (1024 -> 4096)<br>2. FrequencyFilter is enabled by default to ignore unused bands                                                |
| **Misses Fast Beeps**                                | 1. Set `chunk_size: 1024`<br>2. Decrease `min_tone_duration` to 0.02                                                                                      |

See [docs/tuning_guide.md](docs/tuning_guide.md) for scenario-based tuning recipes.

---

## 3. Python API Reference

### `Engine` Class

The core worker.

```python
class Engine:
    def __init__(
        self,
        profiles: List[AlarmProfile],
        audio_config: Optional[AudioSettings] = None,
        engine_config: Optional[EngineConfig] = None,
        on_detection: Optional[Callable[[str], None]] = None,
        on_match: Optional[Callable[[PatternMatchEvent], None]] = None
    ): ...
```

- `profiles`: List of patterns to look for.
- `engine_config`: If `None`, auto-computed from the profiles' strictest requirements.
- `on_detection`: Simple callback `func(name: str)`.
- `on_match`: Rich callback `func(event: PatternMatchEvent)`.

### `ParallelEngine` Class

Wrapper for multiple isolated pipelines.

```python
class ParallelEngine:
    def __init__(
        self,
        pipelines: List[Union[AlarmProfile, Tuple[AlarmProfile, EngineConfig]]],
        audio_config: Optional[AudioSettings] = None,
        ...
    ): ...
```

Automatically creates optimized `EngineConfig` for each profile (e.g., one High-Res, one Standard).

---

## 4. CLI Tools

### Production Runner

Run detection with one or more configuration files:

```bash
python -m acoustic_engine.runner --config configs/smoke_alarm.yaml
python -m acoustic_engine.runner --config configs/smoke_alarm.yaml --config configs/co_sensor.yaml
```

Smart negotiation selects the highest audio quality across configs. Total isolation between runners.

### Profile Tester

Test profiles against audio files or live input:

```bash
# Test against a file
python -m acoustic_engine.tester \
  --profile profiles/smoke_alarm.yaml \
  --audio recording.wav \
  -v

# Live microphone testing
python -m acoustic_engine.tester \
  --profile profiles/ \
  --live \
  --duration 60

# With noise injection for robustness testing
python -m acoustic_engine.tester \
  --profile profiles/smoke_alarm.yaml \
  --audio recording.wav \
  --noise 0.3 --noise-type white

# High-resolution mode for fast patterns
python -m acoustic_engine.tester \
  --profile profiles/co_sensor.yaml \
  --audio recording.wav \
  --high-res -v
```

### Validation API

HTTP endpoint for the browser-based tuner. Runs the real engine pipeline on uploaded audio + YAML:

```bash
python -m acoustic_engine.tuner.validate --port 8787
```

POST `/validate` with `audio` (file) and `profile_yaml` (form field). Returns JSON with tone events, detections, and pipeline parameters.

---

## 5. Best Practices for Production

1. **Hardware Selection**:
   - **Microphone**: MEMS microphones (I2S) are preferred over analog electret for digital consistency.
   - **Placement**: Don't bury the mic inside a plastic case without a port; consistent acoustic coupling is key.

2. **Environment Calibration**:
   - Log `max_magnitude` values in the target environment for 24 hours to determine the correct `min_magnitude` safety margin.
   - Use the tester with noise injection to verify robustness: `--noise 0.3 --noise-type pink`

3. **Watchdog Architecture**:
   - `Engine.start()` is blocking. Run it in a separate thread/process (or use `start_async()`).
   - The engine is stateless between restarts (except for active alarm cooldown).

4. **Profile Versioning**:
   - Store profiles in version control.
   - Run regression tests (`pytest tests/`) after modifying any profile parameters.
   - Use the browser tuner's "Validate with Real Engine" to verify changes visually before deploying.
