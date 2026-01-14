"""Audio listener component for capturing audio input."""

import logging
import numpy as np
from typing import Callable, Optional
from dataclasses import dataclass

try:
    import pyaudio

    HAS_PYAUDIO = True
except ImportError:
    HAS_PYAUDIO = False

logger = logging.getLogger(__name__)


@dataclass
class AudioConfig:
    """Audio capture configuration.

    Attributes:
        sample_rate: Sample rate in Hz (default 44100)
        chunk_size: Samples per chunk (default 4096)
        channels: Number of audio channels (default 1 = mono)
        device_index: Specific audio device index, or None for default
    """

    sample_rate: int = 44100
    chunk_size: int = 4096
    channels: int = 1
    device_index: Optional[int] = None


class AudioListener:
    """Handles audio capture from microphone input.

    Provides a callback-based interface for receiving audio chunks.
    """

    def __init__(self, config: AudioConfig, on_audio_chunk: Callable[[np.ndarray], None]):
        """Initialize the audio listener.

        Args:
            config: Audio configuration settings
            on_audio_chunk: Callback function to receive audio chunks
        """
        if not HAS_PYAUDIO:
            raise ImportError(
                "PyAudio is required for audio capture. Install it with: pip install pyaudio"
            )

        self.config = config
        self.on_audio_chunk = on_audio_chunk
        self._pyaudio: Optional["pyaudio.PyAudio"] = None
        self._stream = None
        self._running = False

    def setup(self) -> bool:
        """Initialize PyAudio and open the audio stream.

        Returns:
            True if successful, False otherwise
        """
        try:
            logger.info("Initializing PyAudio...")
            self._pyaudio = pyaudio.PyAudio()
            self._list_devices()

            if self.config.device_index is not None:
                if not self._validate_device(self.config.device_index):
                    return False
                logger.info(f"Using audio device index: {self.config.device_index}")
            else:
                logger.info("Using default audio device")

            self._stream = self._pyaudio.open(
                format=pyaudio.paInt16,
                channels=self.config.channels,
                rate=self.config.sample_rate,
                input=True,
                input_device_index=self.config.device_index,
                frames_per_buffer=self.config.chunk_size,
            )
            logger.info("✅ Audio stream opened successfully")
            return True

        except Exception as e:
            logger.error(f"Failed to initialize audio: {e}")
            self._list_devices()
            return False

    def _validate_device(self, device_index: int) -> bool:
        """Validate that a device index is usable for input."""
        try:
            dev_info = self._pyaudio.get_device_info_by_host_api_device_index(0, device_index)
            if dev_info.get("maxInputChannels", 0) == 0:
                logger.error(f"Device index {device_index} has no input channels!")
                return False
            logger.info(
                f"Device: {dev_info.get('name')} (Inputs: {dev_info.get('maxInputChannels')})"
            )
            return True
        except Exception as e:
            logger.error(f"Invalid device index {device_index}: {e}")
            return False

    def _list_devices(self) -> None:
        """List all available audio input devices."""
        logger.info("-" * 40)
        logger.info("AVAILABLE AUDIO DEVICES:")
        try:
            if not self._pyaudio:
                return

            info = self._pyaudio.get_host_api_info_by_index(0)
            num_devices = info.get("deviceCount", 0)

            if num_devices == 0:
                logger.warning("No audio devices found!")
                return

            for i in range(num_devices):
                device_info = self._pyaudio.get_device_info_by_host_api_device_index(0, i)
                if device_info.get("maxInputChannels", 0) > 0:
                    logger.info(
                        f"  Index {i}: {device_info.get('name')} "
                        f"(Inputs: {device_info.get('maxInputChannels')})"
                    )
        except Exception as e:
            logger.error(f"Could not list devices: {e}")
        logger.info("-" * 40)

    def start(self) -> None:
        """Start the audio capture loop (blocking)."""
        if not self._stream:
            logger.error("Audio stream not initialized. Call setup() first.")
            return

        self._running = True
        logger.info("🎤 Listener started - capturing audio...")

        try:
            while self._running:
                audio_data = self._stream.read(self.config.chunk_size, exception_on_overflow=False)
                audio_chunk = np.frombuffer(audio_data, dtype=np.int16)
                self.on_audio_chunk(audio_chunk)

        except Exception as e:
            if self._running:
                logger.error(f"Error in audio capture loop: {e}", exc_info=True)

    def stop(self) -> None:
        """Stop the audio capture loop."""
        self._running = False
        logger.info("🛑 Listener stopping...")

    def cleanup(self) -> None:
        """Release audio resources."""
        logger.info("Cleaning up audio resources...")

        if self._stream:
            try:
                self._stream.stop_stream()
                self._stream.close()
            except Exception:
                pass
            self._stream = None

        if self._pyaudio:
            try:
                self._pyaudio.terminate()
            except Exception:
                pass
            self._pyaudio = None

        logger.info("Audio cleanup complete")
