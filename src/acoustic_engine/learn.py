"""Autopilot: turn a recording of an alarm into a working profile.

This closes the "record -> profile -> detect" loop on the device itself, so
you don't need the browser tuner (or any DSP knowledge) to get started:

    acoustic-engine learn alarm.wav --name "My Dryer"

The recording is run through the real DSP front-end (the same SpectralMonitor
and EventGenerator the engine uses), the dominant tones are extracted, and the
first repeating cycle is inferred into tone/silence segments with sensible
tolerances. The result is a starting point — verify and tweak it with
`acoustic-engine test`.
"""

import logging
import wave
from pathlib import Path
from typing import List, Tuple, Union

import numpy as np

from .analysis.generator import EventGenerator
from .config import DEFAULT_CHUNK_SIZE
from .errors import AcousticEngineError
from .events import ToneEvent
from .models import AlarmProfile, Range, Segment
from .processing.dsp import SpectralMonitor

logger = logging.getLogger(__name__)

# A gap is treated as a between-cycle boundary only if it stands clearly apart
# from the within-cycle gaps; this avoids truncating a single burst.
_INTERCYCLE_RATIO = 2.0
# Drop tone events quieter than this fraction of the loudest tone (harmonics,
# noise) before inferring the pattern.
_MAGNITUDE_KEEP = 0.35
# Extraction resolution. Deliberately finer than the engine defaults
# (0.1s / 0.15s) so fast patterns like a CO T4 (0.1s chirps with 0.1s gaps)
# are not merged into one tone. Small enough to keep the chirps separate, large
# enough to bridge tiny intra-tone dips in a clean recording.
_LEARN_MIN_TONE = 0.03
_LEARN_DROPOUT = 0.05


def _load_wav_int16_mono(path: Union[str, Path]) -> Tuple[np.ndarray, int]:
    """Load a 16/32-bit PCM WAV as a mono int16 array. Raises on other formats."""
    try:
        with wave.open(str(path), "rb") as wf:
            sample_rate = wf.getframerate()
            n_channels = wf.getnchannels()
            sample_width = wf.getsampwidth()
            raw = wf.readframes(wf.getnframes())
    except wave.Error as e:
        raise AcousticEngineError(
            f"Could not read '{path}' as a WAV file ({e}). Convert it to 16-bit PCM "
            "WAV first, e.g.: ffmpeg -i input.mp3 -ac 1 -ar 44100 output.wav"
        ) from None

    if sample_width == 2:
        audio = np.frombuffer(raw, dtype=np.int16)
    elif sample_width == 4:
        audio = (np.frombuffer(raw, dtype=np.int32) / 2147483648.0 * 32768).astype(np.int16)
    else:
        raise AcousticEngineError(
            f"Unsupported WAV sample width ({sample_width * 8}-bit). Use 16-bit PCM."
        )

    if n_channels > 1:
        audio = audio.reshape(-1, n_channels).mean(axis=1).astype(np.int16)
    return audio, sample_rate


def _normalize(audio: np.ndarray) -> np.ndarray:
    """Scale to ~90% full scale so the absolute peak threshold is reliably met."""
    peak = int(np.max(np.abs(audio.astype(np.int32)))) if audio.size else 0
    if peak == 0:
        return audio
    return (audio.astype(np.float32) * (0.9 * 32767.0 / peak)).astype(np.int16)


def extract_tone_events(
    audio: np.ndarray, sample_rate: int, chunk_size: int = DEFAULT_CHUNK_SIZE
) -> List[ToneEvent]:
    """Run the real DSP front-end and return the tone events found in `audio`.

    No FrequencyFilter is applied (there is no profile yet), so every dominant
    tone is captured. Mirrors the loop the tuner's validation API uses.
    """
    dsp = SpectralMonitor(sample_rate, chunk_size)
    generator = EventGenerator(
        sample_rate,
        chunk_size,
        min_tone_duration=_LEARN_MIN_TONE,
        dropout_tolerance=_LEARN_DROPOUT,
    )

    events: List[ToneEvent] = []
    for i in range(0, len(audio) - chunk_size, chunk_size):
        chunk = audio[i : i + chunk_size]
        timestamp = i / sample_rate
        peaks = dsp.process(chunk)
        events.extend(e for e in generator.process(peaks, timestamp) if isinstance(e, ToneEvent))

    # Flush any tone still open at the end of the recording.
    final_time = len(audio) / sample_rate + 1.0
    events.extend(e for e in generator.process([], final_time) if isinstance(e, ToneEvent))

    events.sort(key=lambda e: e.timestamp)
    return events


def _collapse(events: List[ToneEvent]) -> List[ToneEvent]:
    """Drop quiet events and collapse temporally-overlapping ones (harmonics).

    When two tones overlap in time (a fundamental and its harmonic), keep the
    louder one. Leaves distinct sequential tones untouched.
    """
    if not events:
        return []

    max_mag = max(e.magnitude for e in events)
    strong = [e for e in events if e.magnitude >= _MAGNITUDE_KEEP * max_mag]

    collapsed: List[ToneEvent] = []
    for ev in sorted(strong, key=lambda e: e.timestamp):
        if collapsed:
            prev = collapsed[-1]
            if ev.timestamp < prev.timestamp + prev.duration:  # overlap
                if ev.magnitude > prev.magnitude:
                    collapsed[-1] = ev
                continue
        collapsed.append(ev)
    return collapsed


def _round(x: float, lo: float = 0.0) -> float:
    return round(max(x, lo), 2)


def _tone_segment(frequency: float, duration: float) -> Segment:
    tol = max(50.0, frequency * 0.04)
    return Segment(
        type="tone",
        frequency=Range(min=round(frequency - tol), max=round(frequency + tol)),
        duration=Range(min=_round(duration * 0.6, 0.03), max=_round(duration * 1.4, 0.06)),
    )


def _silence_segment(gap: float) -> Segment:
    return Segment(
        type="silence",
        duration=Range(min=_round(gap * 0.6, 0.02), max=_round(gap * 1.5, 0.05)),
    )


def _intercycle_threshold(gaps: List[float]) -> float:
    """A gap above this separates cycles. Infinity means a single burst."""
    if not gaps:
        return float("inf")
    median = float(np.median(gaps))
    longest = max(gaps)
    if longest < _INTERCYCLE_RATIO * max(median, 1e-3):
        return float("inf")  # gaps are uniform -> one burst, no cycle boundary
    return (median * longest) ** 0.5  # geometric mean sits between the two clusters


def _split_bursts(
    events: List[ToneEvent], gaps: List[float], threshold: float
) -> List[Tuple[List[ToneEvent], float, List[float]]]:
    """Split events into bursts (cycles) at gaps >= threshold.

    Returns (tones, trailing_gap_or_None, within_gaps) per burst.
    """
    bursts: List[Tuple[List[ToneEvent], float, List[float]]] = []
    cur = [events[0]]
    cur_within: List[float] = []
    for i, g in enumerate(gaps):
        if g >= threshold:
            bursts.append((cur, g, cur_within))
            cur, cur_within = [events[i + 1]], []
        else:
            cur.append(events[i + 1])
            cur_within.append(g)
    bursts.append((cur, None, cur_within))
    return bursts


def infer_segments(events: List[ToneEvent]) -> List[Segment]:
    """Infer one representative cycle of tone/silence segments from tone events.

    Splits the recording into repeated bursts and averages the most common
    cycle across all of them, so a noisy first cycle (DSP warm-up) doesn't
    define the pattern.
    """
    if not events:
        raise AcousticEngineError(
            "No tones were detected in the recording. It may be too quiet, too "
            "noisy, or not a repetitive tonal alarm. Try a cleaner, louder recording."
        )
    if len(events) == 1:
        return [_tone_segment(events[0].frequency, events[0].duration), _silence_segment(1.0)]

    gaps = [max(0.0, b.timestamp - (a.timestamp + a.duration)) for a, b in zip(events, events[1:])]
    bursts = _split_bursts(events, gaps, _intercycle_threshold(gaps))

    # Pick the cycle length with the most coverage (count x length); fragments
    # from a corrupted first cycle lose to the real, repeated pattern.
    counts: dict = {}
    for tones, _, _ in bursts:
        counts[len(tones)] = counts.get(len(tones), 0) + 1
    modal_len = max(counts, key=lambda length: length * counts[length])
    template = [b for b in bursts if len(b[0]) == modal_len]

    segments: List[Segment] = []
    for j in range(modal_len):
        freq = float(np.mean([b[0][j].frequency for b in template]))
        dur = float(np.mean([b[0][j].duration for b in template]))
        segments.append(_tone_segment(freq, dur))
        if j < modal_len - 1:
            within = [b[2][j] for b in template if len(b[2]) > j]
            segments.append(_silence_segment(float(np.mean(within)) if within else 0.1))

    trailing = [b[1] for b in template if b[1] is not None]
    segments.append(_silence_segment(float(np.mean(trailing)) if trailing else 1.0))
    return segments


def learn_profile_from_audio(
    audio: np.ndarray, sample_rate: int, name: str = "Learned Alarm"
) -> AlarmProfile:
    """Infer an AlarmProfile from a mono int16 audio array."""
    events = extract_tone_events(_normalize(audio), sample_rate)
    collapsed = _collapse(events)
    logger.info("Extracted %d tone events (%d after collapse)", len(events), len(collapsed))
    segments = infer_segments(collapsed)

    tones = sum(1 for s in segments if s.type == "tone")
    logger.info("Inferred a %d-tone cycle", tones)

    # validate_profile runs inside AlarmProfile construction paths used by the
    # loaders; build directly here and rely on the engine to validate on load.
    return AlarmProfile(name=name, segments=segments, confirmation_cycles=2)


def learn_profile_from_file(path: Union[str, Path], name: str = None) -> AlarmProfile:
    """Infer an AlarmProfile from a recording on disk (WAV)."""
    audio, sample_rate = _load_wav_int16_mono(path)
    if name is None:
        name = Path(path).stem.replace("_", " ").title()
    return learn_profile_from_audio(audio, sample_rate, name=name)
