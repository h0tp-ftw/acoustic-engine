"""API endpoints for the Acoustic Engine Tuner."""

import io
import wave
import numpy as np
import yaml
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import List, Dict, Any, Optional
from pydantic import BaseModel

from acoustic_engine.processing.dsp import SpectralMonitor
from acoustic_engine.analysis.generator import EventGenerator
from acoustic_engine.analysis.windowed_matcher import WindowedMatcher
from acoustic_engine.models import AlarmProfile, Segment, Range
from acoustic_engine.events import ToneEvent

router = APIRouter()

class ProfileSegment(BaseModel):
    type: str # "tone" or "silence"
    freq_min: Optional[float] = None
    freq_max: Optional[float] = None
    duration_min: float
    duration_max: float

class ProfileSchema(BaseModel):
    name: str
    confirmation_cycles: int
    segments: List[ProfileSegment]

def load_audio(data: bytes) -> tuple[np.ndarray, int]:
    """Load WAV data into a numpy array."""
    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            if wav.getsampwidth() != 2:
                # We could support others, but let's stick to 16-bit for now
                pass
            
            sample_rate = wav.getframerate()
            n_frames = wav.getnframes()
            audio_bytes = wav.readframes(n_frames)
            audio_data = np.frombuffer(audio_bytes, dtype=np.int16)
            
            # If stereo, take first channel
            if wav.getnchannels() > 1:
                audio_data = audio_data.reshape(-1, wav.getnchannels())[:, 0]
                
            return audio_data, sample_rate
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid audio format: {str(e)}")

@router.post("/analyze")
async def analyze_audio(file: UploadFile = File(...)):
    """Analyze audio and propose a profile."""
    content = await file.read()
    audio, sample_rate = load_audio(content)
    
    # Run the actual engine components
    chunk_size = 2048
    monitor = SpectralMonitor(sample_rate=sample_rate, chunk_size=chunk_size)
    generator = EventGenerator(sample_rate=sample_rate, chunk_size=chunk_size)
    
    all_tones = []
    
    # Process in chunks
    for i in range(0, len(audio), chunk_size):
        chunk = audio[i:i+chunk_size]
        if len(chunk) < chunk_size:
            continue
            
        peaks = monitor.process(chunk)
        timestamp = i / sample_rate
        tones = generator.process(peaks, timestamp)
        all_tones.extend(tones)
    
    # Simple heuristic to grouping beeps into segments
    # This is a placeholder for a more sophisticated "pattern learner" 
    # which we can refine later as requested.
    
    if not all_tones:
        return {"segments": [], "message": "No tones detected"}

    # Convert detected tones to segments
    proposed_segments = []
    
    # First, let's find the average frequency and duration
    avg_freq = sum(t.frequency for t in all_tones) / len(all_tones)
    
    # Determine the gaps (silence) between tones
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
            silence_duration = all_tones[i+1].start_time - tone.end_time
            if silence_duration > 0.05:
                proposed_segments.append({
                    "type": "silence",
                    "duration_min": round(max(0.05, silence_duration - 0.1), 2),
                    "duration_max": round(silence_duration + 0.1, 2)
                })

    return {
        "name": "Detected_Alarm",
        "confirmation_cycles": 2,
        "segments": proposed_segments,
        "audio_info": {
            "sample_rate": sample_rate,
            "duration": len(audio) / sample_rate
        }
    }

@router.post("/verify")
async def verify_profile(
    file: UploadFile = File(...), 
    profile_json: str = Form(...)
):
    """Run the engine with the provided profile on the audio."""
    import json
    profile_data = json.loads(profile_json)
    
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
    
    content = await file.read()
    audio, sample_rate = load_audio(content)
    
    chunk_size = 2048 # Should match profile if possible
    monitor = SpectralMonitor(sample_rate=sample_rate, chunk_size=chunk_size)
    matcher = WindowedMatcher(profiles=[profile])
    generator = EventGenerator(sample_rate=sample_rate, chunk_size=chunk_size)
    
    matches = []
    def on_match(event):
        matches.append({
            "timestamp": event.timestamp,
            "cycle_count": event.cycle_count
        })
    
    # Process
    for i in range(0, len(audio), chunk_size):
        chunk = audio[i:i+chunk_size]
        if len(chunk) < chunk_size:
            continue
            
        peaks = monitor.process(chunk)
        timestamp = i / sample_rate
        tones = generator.process(peaks, timestamp)
        
        for tone in tones:
            match = matcher.process_event(tone)
            if match:
                on_match(match)
                
    return {
        "matches": matches,
        "total_matches": len(matches)
    }
