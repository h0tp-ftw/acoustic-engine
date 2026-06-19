"""Tests for the detection-action hooks and the doctor/devices helpers.

All hardware-free: the action dispatch and the doctor's signal analysis are
exercised with synthetic data and loopback servers, no microphone required.
"""

import http.server
import json
import queue
import threading
import time

import numpy as np

from acoustic_engine import cli, runner
from acoustic_engine.config import GlobalConfig
from acoustic_engine.input.listener import list_input_devices


def test_fire_command_runs_and_substitutes(tmp_path):
    """--on-detect runs the command with {name} and $ALARM_NAME available."""
    sentinel = tmp_path / "fired.txt"
    runner._fire_command(
        f'echo "{{name}} $ALARM_NAME" > "{sentinel}"',
        "SmokeAlarm",
        "2026-06-19T00:00:00Z",
    )
    # Popen is async; poll briefly for the side effect.
    for _ in range(100):
        if sentinel.exists() and sentinel.read_text().strip():
            break
        time.sleep(0.02)
    assert sentinel.exists()
    assert sentinel.read_text().strip() == "SmokeAlarm SmokeAlarm"


def test_fire_webhook_posts_json():
    """--webhook POSTs a JSON detection payload to the URL."""
    received: "queue.Queue[dict]" = queue.Queue()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802 - http.server API
            length = int(self.headers.get("Content-Length", 0))
            received.put(json.loads(self.rfile.read(length)))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *args):  # silence the test server
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        runner._fire_webhook(
            f"http://127.0.0.1:{port}/hook",
            {"event": "detected", "profile_name": "CO_Alarm", "timestamp": "t"},
        )
        payload = received.get(timeout=5)
    finally:
        server.shutdown()

    assert payload["event"] == "detected"
    assert payload["profile_name"] == "CO_Alarm"


def test_actions_block_parsed_from_config(tmp_path):
    """An `actions:` block in a config YAML lands on GlobalConfig.actions."""
    cfg = tmp_path / "config.yaml"
    cfg.write_text(
        """
profiles:
  - name: "Test"
    confirmation_cycles: 2
    segments:
      - type: "tone"
        frequency: {min: 3000, max: 3300}
        duration: {min: 0.4, max: 0.6}
      - type: "silence"
        duration: {min: 0.3, max: 0.7}
actions:
  on_detect: "notify-send {name}"
  webhook: "http://localhost:9999/hook"
"""
    )
    config = GlobalConfig.load(cfg)
    assert config.actions.on_detect == "notify-send {name}"
    assert config.actions.webhook == "http://localhost:9999/hook"


def test_actions_default_empty(tmp_path):
    """No actions block => both fields default to None."""
    cfg = tmp_path / "config.yaml"
    cfg.write_text(
        """
profiles:
  - name: "Test"
    segments:
      - type: "tone"
        frequency: {min: 3000, max: 3300}
        duration: {min: 0.4, max: 0.6}
"""
    )
    config = GlobalConfig.load(cfg)
    assert config.actions.on_detect is None
    assert config.actions.webhook is None


def test_dominant_frequency_finds_synthetic_tone():
    """doctor's analysis recovers a known pure tone within FFT resolution."""
    sample_rate = 44100
    t = np.arange(int(sample_rate * 0.5)) / sample_rate
    tone = (0.5 * np.sin(2 * np.pi * 3100.0 * t) * 32767).astype(np.float32)
    freq = cli._dominant_frequency(tone, sample_rate)
    assert freq is not None
    assert abs(freq - 3100.0) < 30.0


def test_dominant_frequency_ignores_silence():
    """Too few / silent samples return None rather than raising."""
    assert cli._dominant_frequency(np.zeros(10, dtype=np.float32), 44100) is None


def test_draw_meter_does_not_raise():
    """The level meter handles silence (log of ~0) and loud input."""
    cli._draw_meter(0.0)
    cli._draw_meter(0.5)


def test_list_input_devices_returns_list():
    """Device enumeration never raises, even with no backend/hardware."""
    devices = list_input_devices()
    assert isinstance(devices, list)
