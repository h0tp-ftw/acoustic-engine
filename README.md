# 🔊 Acoustic Alarm Engine

[![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)](https://www.python.org/downloads/)
[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc/4.0/)

A robust, noise-resilient Python library for real-time acoustic pattern detection. Detect smoke alarms, CO detectors, appliance beeps, and other repetitive audio patterns with high accuracy.

## ✨ Features

| Feature                     | Description                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------ |
| **Windowed Event Analysis** | Noise-resilient sliding window pattern matching that ignores background interference |
| **Real-time FFT**           | Spectral peak detection with dynamic noise floor estimation                          |
| **YAML Profiles**           | Simple, human-readable alarm pattern definitions                                     |
| **Frequency Pre-filtering** | Efficient rejection of irrelevant frequencies early in the pipeline                  |
| **Noise Testing**           | Built-in audio mixer for specificity testing with synthetic noise                    |
| **Web Tuner**               | Visual editor for recording, analyzing, and designing alarm profiles                 |
| **Grandmaster Robustness**  | Advanced Reverb/Echo rejection and Frequency Drift tracking                          |

---

## 🏆 Robustness & Benchmarks

The Acoustic Alarm Engine is engineered for "Grandmaster" grade durability in real-world environments where simple detectors fail.

### **Elite Performance Metrics**

- **Extreme Noise Resilience**: Confirmed detection at **-15dB SNR** (White/Pink Noise) and robust performance against **Chaotic Spectral Noise**.
- **Spectral Subtraction**: New **Per-Bin Noise Profiling** allows the engine to "learn" and subtract stationary noise (fans, HVAC, motors), effectively making it invisible to the detector.
- **Dynamic Background Rejection**: Tested against "Cocktail Party" scenarios (speech babble + clattering dishes). The engine correctly identifies alarms even when the background noise level exceeds the alarm volume (**Negative SNR**).
- **Echo/Reverb Rejection**: Internal **Dip-Disconnect** logic allows the engine to "hear through" reverb decays of up to **50%**. Excellent for warehouses, tiled hallways, and large industrial spaces.
- **Frequency Drift Tracking**: Automatically follows "dying piezo" buzzers that sweep through frequencies (tested up to **200Hz drift**) without losing lock.
- **Alarm Collision Isolation**: Successfully isolates and detects a target T3 alarm even while a louder T4 distractor alarm is sounding in a different frequency lane.
- **Absolute Specificity**: Zero False Positives when tested against "imposter" timers with similar but incorrect rhythms (e.g., 0.3s beeps vs 0.5s targets).

### **Best Suited For:**

- 💨 **Smoke & CO Alarms**: Perfect for industry-standard T3 and T4 patterns.
- 🏠 **Smart Homes**: Survives loud TVs, music, and dinner parties.
- 👨‍🍳 **Busy Kitchens**: Ignores blenders, banging pots, and microwave beeps.
- 🏥 **Medical Equipment**: Resilient to the chaotic acoustic environments of hospitals.
- 🏭 **Industrial Warehouses**: Built-in echo rejection for high-reverb spaces.
- 🍳 **Appliance Monitoring**: Differentiates between ovens, microwaves, and dishwashers.

---

## 🧠 Comparison: DSP vs Neural Networks

Why use this engine instead of an AI-based sound classifier? While Neural Networks (NN) are powerful for general soundscapes, this DSP-based engine excels in **resource-constrained** and **high-precision** environments.

### **System Efficiency Comparison**

| Metric               | **Acoustic Alarm Engine (DSP)** | **Neural Network (Edge AI)** |
| -------------------- | ------------------------------- | ---------------------------- |
| **CPU Usage**        | < 5% (Single Core)              | 25-80% (Multi-core/NPU)      |
| **Memory Footprint** | ~50 MB                          | 200 MB - 1 GB+               |
| **Latency**          | 23ms - 92ms                     | 200ms - 1s                   |
| **GPU/NPU Req.**     | None (Pure CPU)                 | Recommended for real-time    |
| **Power Draw**       | Ultra-Low (IoT Friendly)        | Medium to High               |

### **Detection Philosophy**

| Capability           | **Acoustic Alarm Engine**        | **Neural Networks (CNN/RNN)** |
| -------------------- | -------------------------------- | ----------------------------- |
| **Determinism**      | 100% (Mathematical)              | Probabilistic (Statistical)   |
| **Data Required**    | None (Zero-shot configuration)   | Thousands of labeled samples  |
| **Explainability**   | Clear (Matches frequency/rhythm) | "Black Box" (Weights-based)   |
| **Noise Resilience** | Elite in high-frequency rumble   | Great at complex soundscapes  |
| **Failing Hardware** | Trackable (via 200Hz drift)      | Often viewed as "Unknown"     |

**The Verdict**: Use this engine for **specific, repetitive patterns** (alarms, beeps, machinery) where performance and reliability are critical. Use Neural Networks for **general semantic sounds** (shouting, glass breaking, dog barking) where the patterns are too irregular for mathematical modeling.

---

## 🚀 Quick Start

### Installation

```bash
pip install acoustic-alarm-engine
```

Or from source:

```bash
git clone https://github.com/yourusername/acoustic-alarm-engine.git
cd acoustic-alarm-engine
pip install -e .
```

### Basic Usage

```python
from acoustic_alarm_engine import Engine, AudioConfig
from acoustic_alarm_engine.profiles import load_profiles_from_yaml

# Load alarm profiles
profiles = load_profiles_from_yaml("profiles/smoke_alarm_t3.yaml")

# Create engine with callback
engine = Engine(
    profiles=profiles,
    audio_config=AudioConfig(sample_rate=44100, chunk_size=4096),
    on_detection=lambda name: print(f"🚨 ALARM: {name}")
)

# Start listening (blocking)
engine.start()
```

---

## 📋 Alarm Profiles

Define patterns in YAML:

```yaml
name: "SmokeAlarm_T3"
confirmation_cycles: 2 # Require 2 complete cycles before triggering

segments:
  # Beep 1
  - type: "tone"
    frequency: { min: 2900, max: 3200 }
    duration: { min: 0.4, max: 0.6 }

  # Short pause
  - type: "silence"
    duration: { min: 0.1, max: 0.3 }

  # Beep 2
  - type: "tone"
    frequency: { min: 2900, max: 3200 }
    duration: { min: 0.4, max: 0.6 }

  # Inter-cycle pause
  - type: "silence"
    duration: { min: 0.8, max: 1.5 }
```

### Optional Windowing Parameters

```yaml
window_duration: 10.0 # Seconds to analyze (auto-calculated if omitted)
eval_frequency: 0.5 # How often to evaluate windows
```

---

## 🧪 Testing Profiles

### With Audio Files

```bash
python -m acoustic_alarm_engine.tester \
  --profile profiles/smoke_alarm_t3.yaml \
  --audio recording.wav \
  -v
```

### Live Microphone

```bash
python -m acoustic_alarm_engine.tester \
  --profile profiles/ \
  --live \
  --duration 60
```

### With Noise Mixing (Specificity Testing)

```bash
python -m acoustic_alarm_engine.tester \
  --profile profiles/smoke_alarm_t3.yaml \
  --audio recording.wav \
  --noise 0.3 \
  --noise-type white
```

Noise types: `white`, `pink`, `brown`

---

## 🎛 Web Tuner

Visually record, analyze, and design alarm profiles:

```bash
python -m acoustic_alarm_engine.tuner
# Open http://localhost:8080
```

---

## 🏗 Architecture

The Acoustic Alarm Engine is built as a highly modular 4-stage processing pipeline, designed for deterministic performance and extreme reliability in difficult acoustic environments.

```mermaid
graph TD
    subgraph "Input Layer"
        MIC[🎤 Microphone] --> AL[AudioListener]
        FILE[📄 Audio File] --> PR[Manual Processing]
        SYN[⚡ Synthetic Data] --> PR
    end

    subgraph "Processing Layer (DSP)"
        AL --> SM[SpectralMonitor<br/>FFT + Peak Detection]
        PR --> SM
        SM --> FF[FrequencyFilter<br/>Noise Screener]
    end

    subgraph "Analysis Layer"
        FF --> EG[EventGenerator<br/>Peaks ➔ Tones]
        EG --> WM[WindowedMatcher<br/>Sliding Window Pattern Matching]
    end

    subgraph "Output Layer"
        WM --> CB[🚀 Callbacks / Detections]
    end

    subgraph "Configuration"
        YP[📄 YAML Profiles] --> WM
        CONFIG[⚙️ GlobalConfig] --> AL
        CONFIG --> SM
    end

    style MIC fill:#f9f,stroke:#333,stroke-width:2px
    style CB fill:#8f8,stroke:#333,stroke-width:2px
    style YP fill:#f96,stroke:#333,stroke-width:2px
```

### **1. Input Layer ([Detailed Docs](src/acoustic_alarm_engine/input/README.md))**

The engine is hardware-agnostic. While it includes a `PyAudio` implementation for live capture, it can process audio from any source (files, network streams, etc.) via the `process_chunk` interface.

### **2. Processing Layer ([Detailed Docs](src/acoustic_alarm_engine/processing/README.md))**

- **SpectralMonitor**: Performs Real-Time FFT and identifies peaks. It uses an **adaptive noise floor** to remain robust as ambient sound levels change.
- **FrequencyFilter**: Acts as a "firewall" that discards all audio frequencies not explicitly defined in your loaded profiles, preventing non-alarm sounds from wasting CPU cycles.

### **3. Analysis Layer ([Detailed Docs](src/acoustic_alarm_engine/analysis/README.md))**

- **EventGenerator**: Debounces spectral peaks, bridging transient dropouts and ensuring only "stable" tones are processed.
- **WindowedMatcher**: Uses a sliding window algorithm instead of a fragile state machine. This allows it to "see" a pattern even if it's surrounded by impulsive noise or if the recording started mid-beep.

See [ARCHITECTURE.md](ARCHITECTURE.md) for a deep dive into the implementation details.

---

## ⚙️ Configuration

The engine is highly configurable via a single YAML file or programmatically via `GlobalConfig`.

### **Universal Config Structure**

```yaml
system:
  log_level: "INFO" # DEBUG, INFO, WARNING, ERROR

audio:
  sample_rate: 44100 # Hz
  chunk_size: 1024 # FFT window size
  device_index: null # Specific mic index (null for default)

engine:
  min_magnitude: 10.0 # Sensitivity (lower = more sensitive)

  # Advanced Tuning
  min_sharpness: 1.5 # Rejects wide-band noise
  noise_floor_factor: 3.0 # Adaptive threshold multiplier
  frequency_tolerance: 50.0 # Hz drift tolerance
  dip_threshold: 0.6 # Instant dip disconnect (reverb rejection)

profiles:
  - include: "profiles/smoke_alarm_t3.yaml"
```

### **Advanced Parameter Reference**

| Category  | Parameter            | Default | Description                                                       |
| :-------- | :------------------- | :------ | :---------------------------------------------------------------- |
| **DSP**   | `min_sharpness`      | `1.5`   | Ratio a peak must be above its neighbors to be considered a tone. |
| **DSP**   | `noise_floor_factor` | `3.0`   | Multiplier for the median-based adaptive noise floor.             |
| **Gen**   | `dip_threshold`      | `0.6`   | Detects a sudden magnitude drop to "disconnect" reverb tails.     |
| **Gen**   | `freq_smoothing`     | `0.3`   | Alpha for EMA frequency tracking (higher = faster tracking).      |
| **Match** | `noise_skip_limit`   | `2`     | Number of non-matching events to ignore before breaking a cycle.  |
| **Match** | `duration_relax_low` | `0.8`   | Multiplier for the minimum duration of a segment.                 |

---

## 📖 API Reference

### Engine

```python
Engine(
    profiles: List[AlarmProfile],
    audio_config: Optional[AudioConfig] = None,
    on_detection: Optional[Callable[[str], None]] = None,
    on_match: Optional[Callable[[PatternMatchEvent], None]] = None,
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
    reset_timeout: float = 10.0,
    window_duration: Optional[float] = None,  # Auto-calculated if None
    eval_frequency: float = 0.5,
)
```

---

## 🛠 Development

```bash
# Install with dev dependencies
pip install -e ".[dev]"

# Run tests
pytest tests/ -v

# Run integration test
python test_windowed.py
```

---

## 📄 License

This project is licensed under the **Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)**.

- **Attribution**: You must give appropriate credit.
- **Non-Commercial**: You may not use the material for commercial purposes.

See [LICENSE](LICENSE) for the full text.
