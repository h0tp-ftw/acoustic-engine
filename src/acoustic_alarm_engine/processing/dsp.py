"""Digital Signal Processing (DSP) layer for audio analysis."""

import logging
from dataclasses import dataclass
from typing import List

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class Peak:
    """A spectral peak detected in FFT analysis."""

    frequency: float
    magnitude: float
    bin_index: int


class SpectralMonitor:
    """Monitors audio chunks for spectral peaks.

    Performs windowed FFT analysis to identify significant frequency peaks
    that might correspond to alarm tones.
    """

    def __init__(self, sample_rate: int, chunk_size: int, min_magnitude: float = 0.05):
        """Initialize the spectral monitor.

        Args:
            sample_rate: Audio sample rate in Hz
            chunk_size: Number of samples per chunk
            min_magnitude: Minimum magnitude to consider a peak
        """
        self.sample_rate = sample_rate
        self.chunk_size = chunk_size
        self.freq_bins = np.fft.rfftfreq(chunk_size, 1.0 / sample_rate)
        self.window = np.hanning(chunk_size)

        # Configuration
        self.min_magnitude = min_magnitude
        self.min_sharpness = 1.5  # Peak required to be X times higher than neighbors

    def process(self, audio_chunk: np.ndarray) -> List[Peak]:
        """Process an audio chunk and return significant spectral peaks.

        Args:
            audio_chunk: Raw audio samples (int16)

        Returns:
            List of Peak objects sorted by magnitude (descending)
        """
        # Handle partial chunks
        if len(audio_chunk) != self.chunk_size:
            return []

        # Normalize and window
        float_chunk = audio_chunk.astype(np.float32) / 32768.0
        windowed = float_chunk * self.window

        # FFT
        fft_data = np.abs(np.fft.rfft(windowed))

        max_val = np.max(fft_data) if len(fft_data) > 0 else 0
        if max_val == 0:
            return []

        # Peak finding
        peaks: List[Peak] = []

        # Skip DC and Nyquist edge bins
        for i in range(2, len(fft_data) - 2):
            mag = fft_data[i]
            if mag < self.min_magnitude:
                continue

            # Check if local peak
            if mag > fft_data[i - 1] and mag > fft_data[i + 1]:
                # Sharpness check
                neighbors = (
                    fft_data[i - 2] + fft_data[i - 1] + fft_data[i + 1] + fft_data[i + 2]
                ) / 4.0
                if neighbors == 0:
                    neighbors = 1e-6

                if mag / neighbors > self.min_sharpness:
                    freq = self.freq_bins[i]
                    peaks.append(Peak(frequency=freq, magnitude=mag, bin_index=i))

        # Sort by magnitude descending, limit to top peaks
        peaks.sort(key=lambda x: x.magnitude, reverse=True)
        return peaks[:5]
