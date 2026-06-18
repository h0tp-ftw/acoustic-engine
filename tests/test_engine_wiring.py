"""Tests for engine/config wiring: live reset_timeout, from_config, unified defaults."""

from acoustic_engine.config import DEFAULT_CHUNK_SIZE, AudioSettings, GlobalConfig
from acoustic_engine.engine import Engine
from acoustic_engine.models import AlarmProfile, Range, Segment
from acoustic_engine.parallel_engine import ParallelEngine

_CONFIG_YAML = """
profiles:
  - name: SmokeA
    reset_timeout: 4.0
    segments:
      - type: tone
        frequency: {min: 3000, max: 3100}
        duration: {min: 0.4, max: 0.6}
  - name: BeepB
    reset_timeout: 12.0
    segments:
      - type: tone
        frequency: {min: 1000, max: 1100}
        duration: {min: 0.2, max: 0.4}
"""


def _profile(name, reset_timeout):
    return AlarmProfile(
        name=name,
        segments=[Segment(type="tone", frequency=Range(3000, 3100), duration=Range(0.4, 0.6))],
        reset_timeout=reset_timeout,
    )


def test_cooldown_uses_profile_reset_timeout():
    """The cooldown is driven by each profile's reset_timeout, not a hardcoded 10s."""
    engine = Engine(profiles=[_profile("Fast", 2.5), _profile("Slow", 30.0)])
    assert engine._cooldowns == {"Fast": 2.5, "Slow": 30.0}


def test_default_chunk_size_is_consistent(tmp_path):
    """AudioSettings() and a config with no audio section must agree (no 1024 vs 4096 trap)."""
    cfg = tmp_path / "c.yaml"
    cfg.write_text(_CONFIG_YAML)
    loaded = GlobalConfig.load(cfg)
    assert AudioSettings().chunk_size == DEFAULT_CHUNK_SIZE
    assert loaded.audio.chunk_size == DEFAULT_CHUNK_SIZE


def test_parallel_engine_from_config_does_not_crash(tmp_path):
    """ParallelEngine.from_config previously passed profiles= to a pipelines= ctor and crashed."""
    cfg = tmp_path / "c.yaml"
    cfg.write_text(_CONFIG_YAML)
    config = GlobalConfig.load(cfg)

    engine = ParallelEngine.from_config(config)
    assert len(engine.engines) == 2
    assert {e.profiles[0].name for e in engine.engines} == {"SmokeA", "BeepB"}
