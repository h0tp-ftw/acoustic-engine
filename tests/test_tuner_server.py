"""Tuner server profile-storage endpoints (no audio hardware needed)."""

import pytest

pytest.importorskip("fastapi")  # needs the 'tuner' extra

from fastapi.testclient import TestClient  # noqa: E402

SMOKE_YAML = """
name: Test Smoke
confirmation_cycles: 2
segments:
  - type: tone
    frequency: {min: 2900, max: 3200}
    duration: {min: 0.4, max: 0.6}
  - type: silence
    duration: {min: 0.1, max: 0.3}
"""


def _client(tmp_path, monkeypatch):
    # _profiles_dir() reads this env per request, so no module reload is needed.
    monkeypatch.setenv("ACOUSTIC_PROFILES_DIR", str(tmp_path))
    from acoustic_engine.tuner.validate import app

    return TestClient(app)


def test_save_list_get_delete(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)

    assert client.get("/profiles").json() == {"profiles": []}

    resp = client.post("/profiles", json={"name": "Test Smoke", "yaml": SMOKE_YAML})
    assert resp.status_code == 200
    assert resp.json()["saved"] == "Test_Smoke"

    assert client.get("/profiles").json() == {"profiles": ["Test_Smoke"]}

    got = client.get("/profiles/Test_Smoke").json()
    assert got["name"] == "Test_Smoke"
    assert "Test Smoke" in got["yaml"]

    assert client.delete("/profiles/Test_Smoke").status_code == 200
    assert client.get("/profiles").json() == {"profiles": []}


def test_save_rejects_invalid_profile(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    # A tone with no frequency range can never match -> ProfileError -> 400.
    bad = "name: Bad\nsegments:\n  - type: tone\n    duration: {min: 0.1, max: 0.2}\n"
    resp = client.post("/profiles", json={"name": "Bad", "yaml": bad})
    assert resp.status_code == 400


def test_get_missing_profile_404(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    assert client.get("/profiles/nope").status_code == 404


def test_health(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    assert client.get("/health").json() == {"status": "ok"}


def test_index_injects_ingress_base(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    resp = client.get("/", headers={"X-Ingress-Path": "/api/hassio_ingress/TOKEN"})
    if resp.status_code == 200:  # UI is bundled in this checkout
        assert '<base href="/api/hassio_ingress/TOKEN/">' in resp.text
    else:
        assert resp.status_code == 404  # UI not built -> API-only
