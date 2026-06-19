# 🎙 Input Module

The `input` module handles the low-level details of audio capture and hardware interfacing. It abstracts the raw audio stream into a clean, callback-based interface.

## 🛠 Components

### `AudioListener`

The primary component of this module. It manages the lifecycle of an audio stream using **sounddevice** (PortAudio is bundled in its macOS/Windows wheels; Linux needs `libportaudio2`). If sounddevice can't be loaded it falls back to **PyAudio** — both present the same callback-per-chunk interface, so the rest of the engine is backend-agnostic.

- **Threaded Capture**: Captures audio in a dedicated background thread to prevent processing jitter from causing audio dropouts.
- **Hardware Agnostic**: Supports selecting specific device indices or using the system default.
- **Robustness**: Tolerates transient buffer overruns without crashing the capture loop.

## 📋 usage

```python
from acoustic_engine.input.listener import AudioListener
from acoustic_engine.config import AudioSettings

def my_callback(audio_chunk):
    # audio_chunk is a numpy array of int16 samples
    print(f"Captured {len(audio_chunk)} samples")

settings = AudioSettings(sample_rate=44100, chunk_size=1024)
listener = AudioListener(settings, on_audio_chunk=my_callback)

if listener.setup():
    listener.start() # This blocks while running
```

## ⚙️ Key Features

- **Format**: Captures 16-bit PCM Mono audio at the configured sample rate.
- **Backend selection**: Picks sounddevice (preferred) or PyAudio at `setup()` time, with a clear install hint if neither is available.
- **Diagnostics**: The module-level `list_input_devices()` helper enumerates input devices (used by `acoustic-engine devices` and `doctor`).

## 🔌 Decoupling

While the `Engine` uses `AudioListener` for live capture, the two are fully decoupled. You can pass audio chunks to the engine from any source (files, network) using `engine.process_chunk()`, bypassing this module entirely if needed.
