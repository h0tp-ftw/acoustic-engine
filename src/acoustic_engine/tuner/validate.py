"""Validation API: runs the real engine pipeline against uploaded audio + profile YAML.

Exposes a single POST endpoint that the React tuner calls to get ground-truth
detection results from the actual SpectralMonitor → FrequencyFilter →
EventGenerator → WindowedMatcher pipeline.

Start with:
    python -m acoustic_engine.tuner.validate [--port 8787]

Or import and mount on an existing FastAPI app:
    from acoustic_engine.tuner.validate import app
"""

import argparse
import io
import wave
from typing import List

import numpy as np
import yaml
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from acoustic_engine.analysis.generator import EventGenerator
from acoustic_engine.analysis.windowed_matcher import WindowedMatcher
from acoustic_engine.config import DEFAULT_DROPOUT_TOLERANCE, DEFAULT_MIN_TONE_DURATION
from acoustic_engine.events import ToneEvent
from acoustic_engine.models import AlarmProfile, Range, ResolutionConfig, Segment
from acoustic_engine.processing.dsp import SpectralMonitor
from acoustic_engine.processing.filter import FrequencyFilter

app = FastAPI(title="Acoustic Engine Validator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def parse_profile_from_yaml(yaml_text: str) -> AlarmProfile:
    data = yaml.safe_load(yaml_text)

    segments = []
    for seg_data in data.get("segments", []):
        seg_type = seg_data.get("type", "tone")
        frequency = None
        if seg_type == "tone" and "frequency" in seg_data:
            freq_data = seg_data["frequency"]
            if isinstance(freq_data, dict):
                frequency = Range(float(freq_data.get("min", 0)), float(freq_data.get("max", 20000)))
            else:
                freq = float(freq_data)
                frequency = Range(freq * 0.95, freq * 1.05)

        dur_data = seg_data.get("duration", {"min": 0.1, "max": 1.0})
        if isinstance(dur_data, dict):
            duration = Range(float(dur_data.get("min", 0.1)), float(dur_data.get("max", 1.0)))
        else:
            dur = float(dur_data)
            duration = Range(dur * 0.8, dur * 1.2)

        segments.append(Segment(
            type=seg_type,
            frequency=frequency,
            duration=duration,
            min_magnitude=float(seg_data.get("min_magnitude", 0.05)),
        ))

    resolution = None
    if "resolution" in data:
        res_data = data["resolution"]
        resolution = ResolutionConfig(
            min_tone_duration=float(res_data.get("min_tone_duration", DEFAULT_MIN_TONE_DURATION)),
            dropout_tolerance=float(res_data.get("dropout_tolerance", DEFAULT_DROPOUT_TOLERANCE)),
        )

    return AlarmProfile(
        name=data.get("name", "Uploaded"),
        segments=segments,
        confirmation_cycles=int(data.get("confirmation_cycles", 1)),
        reset_timeout=float(data.get("reset_timeout", 10.0)),
        window_duration=data.get("window_duration"),
        eval_frequency=float(data.get("eval_frequency", 0.5)),
        resolution=resolution,
    )


def load_audio_bytes(audio_bytes: bytes) -> tuple:
    """Load audio from bytes. Tries WAV first, then PyAV."""
    try:
        with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
            sample_rate = wf.getframerate()
            n_frames = wf.getnframes()
            n_channels = wf.getnchannels()
            sample_width = wf.getsampwidth()
            raw = wf.readframes(n_frames)

        if sample_width == 2:
            audio = np.frombuffer(raw, dtype=np.int16)
        elif sample_width == 4:
            audio = np.frombuffer(raw, dtype=np.int32)
            audio = (audio / 2147483648.0 * 32768).astype(np.int16)
        else:
            raise ValueError(f"Unsupported sample width: {sample_width}")

        if n_channels == 2:
            audio = audio.reshape(-1, 2).mean(axis=1).astype(np.int16)

        return audio, sample_rate
    except Exception:
        pass

    try:
        import av
        container = av.open(io.BytesIO(audio_bytes))
        audio_stream = next(s for s in container.streams if s.type == 'audio')
        resampler = av.AudioResampler(format='s16', layout='mono', rate=audio_stream.rate)
        samples = []
        for frame in container.decode(audio_stream):
            for resampled in resampler.resample(frame):
                samples.append(resampled.to_ndarray().reshape(-1))
        if not samples:
            raise ValueError("No audio frames decoded")
        return np.concatenate(samples), audio_stream.rate
    except Exception as e:
        raise ValueError(f"Could not decode audio: {e}")


def run_engine_pipeline(
    audio: np.ndarray,
    sample_rate: int,
    profile: AlarmProfile,
) -> dict:
    """Run the real detection pipeline and return structured results."""
    # Determine resolution from profile or defaults
    min_tone_dur = DEFAULT_MIN_TONE_DURATION
    dropout_tol = DEFAULT_DROPOUT_TOLERANCE
    if profile.resolution:
        min_tone_dur = profile.resolution.min_tone_duration
        dropout_tol = profile.resolution.dropout_tolerance

    chunk_size = 1024

    dsp = SpectralMonitor(sample_rate, chunk_size)
    freq_filter = FrequencyFilter([profile])
    generator = EventGenerator(
        sample_rate, chunk_size,
        min_tone_duration=min_tone_dur,
        dropout_tolerance=dropout_tol,
    )
    matcher = WindowedMatcher([profile])

    tone_events: List[dict] = []
    detections: List[dict] = []

    for i in range(0, len(audio) - chunk_size, chunk_size):
        chunk = audio[i:i + chunk_size]
        timestamp = i / sample_rate

        peaks = dsp.process(chunk)
        filtered_peaks = freq_filter.filter_peaks(peaks)
        events = generator.process(filtered_peaks, timestamp)

        for event in events:
            if isinstance(event, ToneEvent):
                tone_events.append({
                    "timestamp": round(event.timestamp, 4),
                    "duration": round(event.duration, 4),
                    "frequency": round(event.frequency, 1),
                    "magnitude": round(event.magnitude, 2),
                })
                matcher.add_event(event)

        matches = matcher.evaluate(timestamp)
        for match in matches:
            detections.append({
                "timestamp": round(match.timestamp, 4),
                "duration": round(match.duration, 4),
                "profile_name": match.profile_name,
                "cycle_count": match.cycle_count,
            })

    # Flush remaining events from the generator by processing empty time
    final_time = len(audio) / sample_rate + 1.0
    remaining = generator.process([], final_time)
    for event in remaining:
        if isinstance(event, ToneEvent):
            tone_events.append({
                "timestamp": round(event.timestamp, 4),
                "duration": round(event.duration, 4),
                "frequency": round(event.frequency, 1),
                "magnitude": round(event.magnitude, 2),
            })
            matcher.add_event(event)

    final_matches = matcher.evaluate(final_time)
    for match in final_matches:
        detections.append({
            "timestamp": round(match.timestamp, 4),
            "duration": round(match.duration, 4),
            "profile_name": match.profile_name,
            "cycle_count": match.cycle_count,
        })

    return {
        "tone_events": tone_events,
        "detections": detections,
        "duration": round(len(audio) / sample_rate, 3),
        "sample_rate": sample_rate,
        "pipeline": {
            "chunk_size": chunk_size,
            "min_tone_duration": min_tone_dur,
            "dropout_tolerance": dropout_tol,
            "freq_filter_ranges": [
                {"min": r[0], "max": r[1]} for r in freq_filter.freq_ranges
            ],
        },
    }


@app.post("/validate")
async def validate(
    audio: UploadFile = File(...),
    profile_yaml: str = Form(...),
):
    try:
        audio_bytes = await audio.read()
        audio_data, sample_rate = load_audio_bytes(audio_bytes)
        profile = parse_profile_from_yaml(profile_yaml)
        results = run_engine_pipeline(audio_data, sample_rate, profile)
        return JSONResponse(content=results)
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=400)


@app.get("/health")
async def health():
    return {"status": "ok"}


def main():
    # Parse args first so `--help` works even if the server deps are missing.
    parser = argparse.ArgumentParser(description="Acoustic Engine Validation API")
    parser.add_argument("-p", "--port", type=int, default=8787)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    try:
        import uvicorn
    except ImportError:
        raise SystemExit(
            "The validation server needs the 'tuner' extra. Install it with:\n"
            "  pip install 'acoustic-engine[tuner]'"
        ) from None

    print(f"Validation API starting on http://{args.host}:{args.port}")
    print("  POST /validate  — upload audio + profile YAML")
    print("  GET  /health    — health check")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
