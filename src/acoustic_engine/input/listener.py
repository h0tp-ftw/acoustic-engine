"""Audio capture for live microphone input.

Prefers `sounddevice` and falls back to `PyAudio` if it can't be loaded. Both
backends expose the same "call a function with each int16 chunk" interface, so
the rest of the engine (Engine, ParallelEngine) is backend-agnostic.

Why sounddevice first: its Windows and macOS wheels bundle the PortAudio
library, so `pip install` is enough — no Homebrew, no apt. On Linux it loads the
system `libportaudio2` runtime (a tiny package, usually already present), which
is far lighter than PyAudio's need for the `portaudio19-dev` headers and a C
compiler at install time.
"""

import logging
from typing import Callable, List, Optional

import numpy as np

from ..config import AudioSettings

logger = logging.getLogger(__name__)


# Kept for backward compatibility; AudioSettings is the canonical name.
AudioConfig = AudioSettings


def _try_import_sounddevice():
    """Import sounddevice, or return None (reason logged at debug level).

    sounddevice loads the PortAudio shared library *at import time* and raises
    ``OSError`` (not ``ImportError``) when it is missing, so both are caught.
    """
    try:
        import sounddevice as sd

        return sd
    except (ImportError, OSError) as exc:
        logger.debug("sounddevice unavailable: %s", exc)
        return None


def _try_import_pyaudio():
    """Import PyAudio, or return None (reason logged at debug level)."""
    try:
        import pyaudio

        return pyaudio
    except ImportError as exc:
        logger.debug("pyaudio unavailable: %s", exc)
        return None


def audio_backend_help() -> str:
    """Install hint shown when no capture backend can be loaded."""
    return (
        "No working audio backend found. Install one with:\n"
        "  pip install sounddevice        # Linux also needs: sudo apt install libportaudio2\n"
        "  pip install 'acoustic-engine[pyaudio]'   # legacy PyAudio backend\n"
        "Then list your microphones with:  acoustic-engine devices"
    )


def list_input_devices() -> List[dict]:
    """List input-capable audio devices via whichever backend is available.

    Returns a list of ``{index, name, channels, default, backend}`` dicts
    (empty if no backend or no input devices are available). Used by the
    ``devices`` and ``doctor`` CLI commands.
    """
    sd = _try_import_sounddevice()
    if sd is not None:
        try:
            devices = sd.query_devices()
            try:
                default_in = sd.default.device[0]
            except Exception:
                default_in = None
            result = [
                {
                    "index": index,
                    "name": dev.get("name", "?"),
                    "channels": int(dev.get("max_input_channels", 0)),
                    "default": index == default_in,
                    "backend": "sounddevice",
                }
                for index, dev in enumerate(devices)
                if dev.get("max_input_channels", 0) > 0
            ]
            if result:
                return result
        except Exception as exc:  # pragma: no cover - hardware dependent
            logger.debug("sounddevice could not list devices: %s", exc)

    pyaudio = _try_import_pyaudio()
    if pyaudio is not None:  # pragma: no cover - hardware dependent
        pa = pyaudio.PyAudio()
        try:
            try:
                default_in = pa.get_default_input_device_info().get("index")
            except Exception:
                default_in = None
            result = []
            for index in range(pa.get_device_count()):
                info = pa.get_device_info_by_index(index)
                if info.get("maxInputChannels", 0) > 0:
                    result.append(
                        {
                            "index": index,
                            "name": info.get("name", "?"),
                            "channels": int(info.get("maxInputChannels", 0)),
                            "default": index == default_in,
                            "backend": "pyaudio",
                        }
                    )
            return result
        finally:
            pa.terminate()

    return []


class AudioListener:
    """Captures audio from the microphone and relays it chunk-by-chunk.

    Picks a backend at ``setup()`` time (sounddevice preferred, PyAudio
    fallback) and presents one blocking ``start()`` loop that calls
    ``on_audio_chunk`` with a mono int16 numpy array per chunk.
    """

    def __init__(self, config: AudioSettings, on_audio_chunk: Callable[[np.ndarray], None]):
        """Initialize the audio listener.

        Args:
            config: AudioSettings with sample rate, chunk size, device, channels.
            on_audio_chunk: Called for every captured chunk with a single
                argument — a numpy array of int16 mono samples.
        """
        self.config = config
        self.on_audio_chunk = on_audio_chunk
        self._running = False
        self.backend: Optional[str] = None

        # sounddevice state
        self._sd = None
        self._sd_stream = None
        # pyaudio state
        self._pa = None
        self._pa_stream = None

    def setup(self) -> bool:
        """Open an input stream, trying sounddevice then PyAudio.

        Returns:
            True if a stream was opened, False otherwise (with a help message
            logged telling the user how to install a backend).
        """
        if self._setup_sounddevice() or self._setup_pyaudio():
            return True
        logger.error(audio_backend_help())
        return False

    def _setup_sounddevice(self) -> bool:
        sd = _try_import_sounddevice()
        if sd is None:
            return False
        try:
            stream = sd.InputStream(
                samplerate=self.config.sample_rate,
                blocksize=self.config.chunk_size,
                device=self.config.device_index,
                channels=self.config.channels,
                dtype="int16",
            )
            stream.start()
        except Exception as exc:
            logger.warning("sounddevice could not open an input stream (%s); trying PyAudio.", exc)
            return False

        self._sd = sd
        self._sd_stream = stream
        self.backend = "sounddevice"
        try:
            name = sd.query_devices(self.config.device_index, "input")["name"]
        except Exception:
            name = "default input device"
        logger.info("🎤 Audio backend: sounddevice — %s", name)
        return True

    def _setup_pyaudio(self) -> bool:
        pyaudio = _try_import_pyaudio()
        if pyaudio is None:
            return False
        try:
            pa = pyaudio.PyAudio()
            stream = pa.open(
                format=pyaudio.paInt16,
                channels=self.config.channels,
                rate=self.config.sample_rate,
                input=True,
                input_device_index=self.config.device_index,
                frames_per_buffer=self.config.chunk_size,
            )
        except Exception as exc:
            logger.error("PyAudio could not open an input stream: %s", exc)
            return False

        self._pa = pa
        self._pa_stream = stream
        self.backend = "pyaudio"
        logger.info("🎤 Audio backend: PyAudio")
        return True

    def _read_chunk(self) -> np.ndarray:
        """Read one chunk as a mono int16 array from the active backend."""
        if self.backend == "sounddevice":
            frames, _overflowed = self._sd_stream.read(self.config.chunk_size)
            mono = frames[:, 0] if frames.ndim > 1 else frames
            return np.ascontiguousarray(mono, dtype=np.int16)

        # PyAudio: exception_on_overflow=False survives transient buffer overruns
        data = self._pa_stream.read(self.config.chunk_size, exception_on_overflow=False)
        return np.frombuffer(data, dtype=np.int16)

    def start(self) -> None:
        """Capture audio in a blocking loop until stop() is called."""
        if not self.backend:
            logger.error("Audio stream not initialized. Call setup() first.")
            return

        self._running = True
        logger.info("🎤 Listener started - capturing audio...")

        try:
            while self._running:
                self.on_audio_chunk(self._read_chunk())
        except Exception as exc:
            if self._running:
                logger.error("Error in audio capture loop: %s", exc, exc_info=True)

    def stop(self) -> None:
        """Signal the capture loop to exit cleanly."""
        self._running = False
        logger.info("🛑 Listener stopping...")

    def cleanup(self) -> None:
        """Close the stream and release backend resources."""
        if self._sd_stream is not None:
            try:
                self._sd_stream.stop()
                self._sd_stream.close()
            except Exception:
                pass
            self._sd_stream = None
        self._sd = None

        if self._pa_stream is not None:
            try:
                self._pa_stream.stop_stream()
                self._pa_stream.close()
            except Exception:
                pass
            self._pa_stream = None
        if self._pa is not None:
            try:
                self._pa.terminate()
            except Exception:
                pass
            self._pa = None

        self.backend = None
