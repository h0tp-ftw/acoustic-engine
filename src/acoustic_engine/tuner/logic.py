"""Logic layer for the Acoustic Engine Tuner.

Handles audio loading, spectral analysis, and pattern matching logic
independently of the GUI.
"""

import io
import wave
import traceback
import numpy as np
from typing import List, Dict, Any, Optional
from dataclasses import dataclass

from acoustic_engine.processing.dsp import SpectralMonitor, Peak
from acoustic_engine.analysis.generator import EventGenerator
from acoustic_engine.analysis.windowed_matcher import WindowedMatcher
from acoustic_engine.models import AlarmProfile, Segment, Range
from acoustic_engine.events import ToneEvent
from rich.console import Console

# Internal diagnostics
console = Console()

@dataclass
class AnalysisResult:
    """Consolidated results from an audio analysis run."""
    name: str
    confirmation_cycles: int
    segments: List[Dict[str, Any]]
    audio_info: Dict[str, Any]
    tones: List[ToneEvent]

class TunerLogic:
    """Orchestrates the acoustic engine components for tuning and verification."""

    def __init__(self, sample_rate: int = 16000, chunk_size: int = 2048):
        self.sample_rate = sample_rate
        self.chunk_size = chunk_size

    def load_audio(self, data: bytes) -> tuple[np.ndarray, int]:
        """Load audio data into a numpy array using PyAV.
        
        Handles M4A, MP3, WAV, and more without external binaries.
        """
        if not data:
            raise ValueError("No audio data received (empty input)")

        # Diagnostic: hex dump first 16 bytes
        try:
            header = data[:16].hex(' ')
            console.print(f"[dim]Audio pipeline received {len(data)} bytes | Header: {header}[/dim]")
        except Exception:
            pass

        try:
            import av
            
            # Setup container and stream
            container = av.open(io.BytesIO(data))
            audio_stream = next(s for s in container.streams if s.type == 'audio')
            
            # Setup resampler for 16-bit mono (standardizes all inputs)
            resampler = av.AudioResampler(
                format='s16',
                layout='mono',
                rate=audio_stream.rate
            )
            
            samples = []
            for frame in container.decode(audio_stream):
                # Resample and convert to s16 mono
                resampled_frames = resampler.resample(frame)
                for resampled_frame in resampled_frames:
                    # Convert frame to numpy array
                    samples.append(resampled_frame.to_ndarray().reshape(-1))
            
            if not samples:
                raise ValueError("No audio frames decoded")
                
            audio_data = np.concatenate(samples)
            sample_rate = audio_stream.rate
            
            return audio_data, sample_rate
            
        except StopIteration:
            raise ValueError("No audio stream found in file")
        except Exception as e:
            # Fallback to standard wave for simple WAVs if AV fails (rare)
            try:
                with wave.open(io.BytesIO(data), "rb") as wav:
                    sample_rate = wav.getframerate()
                    n_frames = wav.getnframes()
                    audio_bytes = wav.readframes(n_frames)
                    audio_data = np.frombuffer(audio_bytes, dtype=np.int16)
                    
                    if wav.getnchannels() > 1:
                        audio_data = audio_data.reshape(-1, wav.getnchannels())[:, 0]
                        
                    return audio_data, sample_rate
            except Exception:
                raise ValueError(f"Unsupported or corrupted audio format. (Internal Error: {str(e)})")

    def get_audio_wav_bytes(self, audio_data: np.ndarray, sample_rate: int) -> bytes:
        """Convert numpy audio data back to a WAV-encoded byte stream for playback."""
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)  # 16-bit
            wav.setframerate(sample_rate)
            wav.writeframes(audio_data.tobytes())
        return buf.getvalue()

    def get_fft_at_time(self, audio_data: np.ndarray, sample_rate: int, time: float) -> tuple[np.ndarray, np.ndarray]:
        """Calculate the magnitude spectrum (FFT) for a window around a specific time."""
        AUDIO_FFT_WINDOW = 4096
        center_sample = int(time * sample_rate)
        start = max(0, center_sample - AUDIO_FFT_WINDOW // 2)
        end = min(len(audio_data), start + AUDIO_FFT_WINDOW)
        
        chunk = audio_data[start:end]
        if len(chunk) < AUDIO_FFT_WINDOW:
            padding = np.zeros(AUDIO_FFT_WINDOW - len(chunk))
            chunk = np.concatenate([chunk, padding])
            
        # Apply Hanning window
        windowed = chunk * np.hanning(AUDIO_FFT_WINDOW)
        fft_complex = np.fft.rfft(windowed)
        magnitudes = np.abs(fft_complex)
        # Convert to dB
        magnitudes = 20 * np.log10(magnitudes + 1e-10)
        
        freq_bins = np.fft.rfftfreq(AUDIO_FFT_WINDOW, 1 / sample_rate)
        return freq_bins, magnitudes

    def analyze_audio(self, audio_data: np.ndarray, sample_rate: int) -> AnalysisResult:
        """Analyze audio and propose a profile."""
        generator = EventGenerator(sample_rate=sample_rate, chunk_size=self.chunk_size)
        
        all_tones = []
        
        # Process in chunks
        for i in range(0, len(audio_data), self.chunk_size):
            chunk = audio_data[i:i+self.chunk_size]
            if len(chunk) < self.chunk_size:
                continue
                
            peaks = monitor.process(chunk)
            timestamp = i / sample_rate
            tones = generator.process(peaks, timestamp)
            all_tones.extend(tones)
        
        if not all_tones:
            return AnalysisResult(
                name="Empty_Profile",
                confirmation_cycles=1,
                segments=[],
                audio_info={"duration": len(audio_data) / sample_rate},
                tones=[]
            )

        # Convert detected tones to segments
        proposed_segments = []
        for i in range(len(all_tones)):
            tone = all_tones[i]
            proposed_segments.append({
                "type": "tone",
                "freq_min": round(tone.frequency - 50, -1),
                "freq_max": round(tone.frequency + 50, -1),
                "duration_min": round(max(0.1, tone.duration - 0.1), 2),
                "duration_max": round(tone.duration + 0.1, 2)
            })
            
            # Add silence if there's a gap to the next tone
            if i < len(all_tones) - 1:
                # ToneEvent uses 'timestamp' for start and 'duration' for length
                next_tone = all_tones[i+1]
                silence_duration = next_tone.timestamp - (tone.timestamp + tone.duration)
                if silence_duration > 0.05:
                    proposed_segments.append({
                        "type": "silence",
                        "duration_min": round(max(0.05, silence_duration - 0.1), 2),
                        "duration_max": round(silence_duration + 0.1, 2)
                    })

        return AnalysisResult(
            name="Detected_Alarm",
            confirmation_cycles=2,
            segments=proposed_segments,
            audio_info={
                "sample_rate": sample_rate,
                "duration": len(audio_data) / sample_rate
            },
            tones=all_tones
        )

    def verify_profile(self, audio_data: np.ndarray, sample_rate: int, profile_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Run the engine with the provided profile on the audio."""
        # Construct AlarmProfile
        segments = []
        for s in profile_data["segments"]:
            segments.append(Segment(
                type=s["type"],
                frequency=Range(s["freq_min"], s["freq_max"]) if s.get("freq_min") else None,
                duration=Range(s["duration_min"], s["duration_max"])
            ))
            
        profile = AlarmProfile(
            name=profile_data["name"],
            segments=segments,
            confirmation_cycles=profile_data.get("confirmation_cycles", 1)
        )
        
        monitor = SpectralMonitor(sample_rate=sample_rate, chunk_size=self.chunk_size)
        matcher = WindowedMatcher(profiles=[profile])
        generator = EventGenerator(sample_rate=sample_rate, chunk_size=self.chunk_size)
        
        matches = []
        
        # Process
        for i in range(0, len(audio_data), self.chunk_size):
            chunk = audio_data[i:i+self.chunk_size]
            if len(chunk) < self.chunk_size:
                continue
                
            peaks = monitor.process(chunk)
            timestamp = i / sample_rate
            tones = generator.process(peaks, timestamp)
            
            for tone in tones:
                match = matcher.process_event(tone)
                if match:
                    matches.append({
                        "timestamp": match.timestamp,
                        "cycle_count": match.cycle_count
                    })
                    
        return matches
