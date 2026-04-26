"""Tests for the validation API endpoint.

Uses FastAPI's TestClient to test the /validate endpoint without
starting a real server.
"""

import io
import math
import struct
import wave

import pytest
from fastapi.testclient import TestClient

from acoustic_engine.tuner.validate import app


@pytest.fixture
def client():
    return TestClient(app)


def make_wav(freq=3200, sample_rate=44100, beep_dur=0.5, silence_dur=0.5, beeps=3):
    """Generate a WAV with repeating beeps."""
    samples = []
    for b in range(beeps):
        for i in range(int(beep_dur * sample_rate)):
            t = (len(samples)) / sample_rate
            samples.append(int(0.8 * 32767 * math.sin(2 * math.pi * freq * t)))
        for _ in range(int(silence_dur * sample_rate)):
            samples.append(0)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(struct.pack(f"<{len(samples)}h", *samples))
    return buf.getvalue()


PROFILE_YAML = """\
name: "TestAlarm"
confirmation_cycles: 1
segments:
  - type: "tone"
    frequency: { min: 3100, max: 3300 }
    duration: { min: 0.3, max: 0.7 }
  - type: "silence"
    duration: { min: 0.3, max: 0.7 }
  - type: "tone"
    frequency: { min: 3100, max: 3300 }
    duration: { min: 0.3, max: 0.7 }
"""


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_validate_returns_tone_events(client):
    wav_bytes = make_wav(freq=3200, beeps=3)

    resp = client.post(
        "/validate",
        files={"audio": ("test.wav", wav_bytes, "audio/wav")},
        data={"profile_yaml": PROFILE_YAML},
    )
    assert resp.status_code == 200

    data = resp.json()
    assert "tone_events" in data
    assert "detections" in data
    assert "pipeline" in data
    assert data["sample_rate"] == 44100

    assert len(data["tone_events"]) >= 2, (
        f"Expected at least 2 tone events, got {len(data['tone_events'])}"
    )

    for evt in data["tone_events"]:
        assert 3100 <= evt["frequency"] <= 3300
        assert evt["duration"] > 0
        assert evt["timestamp"] >= 0


def test_validate_silence_returns_nothing(client):
    sr = 44100
    n = sr * 2
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(struct.pack(f"<{n}h", *([0] * n)))

    resp = client.post(
        "/validate",
        files={"audio": ("silence.wav", buf.getvalue(), "audio/wav")},
        data={"profile_yaml": PROFILE_YAML},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["tone_events"]) == 0
    assert len(data["detections"]) == 0


def test_validate_wrong_frequency_filtered(client):
    wav_bytes = make_wav(freq=1000, beeps=3)

    resp = client.post(
        "/validate",
        files={"audio": ("wrong_freq.wav", wav_bytes, "audio/wav")},
        data={"profile_yaml": PROFILE_YAML},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["tone_events"]) == 0


def test_validate_bad_yaml_returns_400(client):
    wav_bytes = make_wav()

    resp = client.post(
        "/validate",
        files={"audio": ("test.wav", wav_bytes, "audio/wav")},
        data={"profile_yaml": "not: valid: yaml: [[["},
    )
    assert resp.status_code == 400


def test_validate_pipeline_info(client):
    wav_bytes = make_wav(freq=3200, beeps=3)

    resp = client.post(
        "/validate",
        files={"audio": ("test.wav", wav_bytes, "audio/wav")},
        data={"profile_yaml": PROFILE_YAML},
    )
    data = resp.json()
    pipeline = data["pipeline"]

    assert pipeline["chunk_size"] == 1024
    assert len(pipeline["freq_filter_ranges"]) >= 1
    assert pipeline["freq_filter_ranges"][0]["min"] == 3100.0
    assert pipeline["freq_filter_ranges"][0]["max"] == 3300.0
