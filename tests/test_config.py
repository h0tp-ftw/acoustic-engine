"""Tests for configuration loading and validation."""

import pytest

from acoustic_engine.config import GlobalConfig
from acoustic_engine.errors import ConfigError

_PROFILE_A = """
name: AlarmA
segments:
  - type: tone
    frequency: {min: 3000, max: 3100}
    duration: {min: 0.4, max: 0.6}
"""

_PROFILE_B = """
name: AlarmB
segments:
  - type: tone
    frequency: {min: 1000, max: 1100}
    duration: {min: 0.2, max: 0.4}
"""


def _write_profiles(tmp_path):
    pdir = tmp_path / "profiles"
    pdir.mkdir()
    (pdir / "a.yaml").write_text(_PROFILE_A)
    (pdir / "b.yaml").write_text(_PROFILE_B)
    return pdir


def test_include_glob_loads_all_matches(tmp_path):
    _write_profiles(tmp_path)
    cfg = tmp_path / "config.yaml"
    cfg.write_text('profiles:\n  - include: "profiles/*.yaml"\n')

    config = GlobalConfig.load(cfg)
    names = sorted(p.name for p in config.profiles)
    assert names == ["AlarmA", "AlarmB"]


def test_include_directory_loads_all(tmp_path):
    _write_profiles(tmp_path)
    cfg = tmp_path / "config.yaml"
    cfg.write_text('profiles:\n  - include: "profiles"\n')

    config = GlobalConfig.load(cfg)
    assert len(config.profiles) == 2


def test_include_single_file(tmp_path):
    _write_profiles(tmp_path)
    cfg = tmp_path / "config.yaml"
    cfg.write_text('profiles:\n  - include: "profiles/a.yaml"\n')

    config = GlobalConfig.load(cfg)
    assert [p.name for p in config.profiles] == ["AlarmA"]


def test_include_no_match_raises(tmp_path):
    cfg = tmp_path / "config.yaml"
    cfg.write_text('profiles:\n  - include: "profiles/*.yaml"\n')

    with pytest.raises(ConfigError, match="matched no profile files"):
        GlobalConfig.load(cfg)


def test_engine_override_applies(tmp_path):
    cfg = tmp_path / "config.yaml"
    cfg.write_text(
        "engine:\n"
        "  min_magnitude: 7.5\n"
        "  max_peaks: 8\n"
        "profiles:\n" + _indent(_PROFILE_A)
    )
    config = GlobalConfig.load(cfg)
    assert config.engine.min_magnitude == 7.5
    assert config.engine.max_peaks == 8
    assert isinstance(config.engine.max_peaks, int)


def test_engine_override_unknown_key_raises(tmp_path):
    cfg = tmp_path / "config.yaml"
    cfg.write_text("engine:\n  min_magnatude: 7.5\nprofiles:\n" + _indent(_PROFILE_A))
    with pytest.raises(ConfigError, match="Unknown engine setting 'min_magnatude'"):
        GlobalConfig.load(cfg)


def _indent(profile_yaml: str) -> str:
    """Render a single-profile YAML string as one item of a 'profiles:' list."""
    body = profile_yaml.strip().splitlines()
    out = ["  - " + body[0]]
    out += ["    " + line for line in body[1:]]
    return "\n".join(out) + "\n"


def test_load_mqtt_config(tmp_path):
    config_yaml = """
system:
  log_level: "DEBUG"
audio:
  sample_rate: 48000
mqtt:
  enabled: true
  broker: "192.168.1.50"
  port: 1884
  topic: "test/alerts"
  username: "test_user"
  password: "test_password"
  client_id: "test_client"
profiles:
  - name: "TestAlarm"
    segments:
      - type: "tone"
        frequency: 3000
        duration: 0.5
"""
    config_file = tmp_path / "config.yaml"
    config_file.write_text(config_yaml)

    config = GlobalConfig.load(config_file)

    assert config.system.log_level == "DEBUG"
    assert config.audio.sample_rate == 48000
    assert config.mqtt.enabled is True
    assert config.mqtt.broker == "192.168.1.50"
    assert config.mqtt.port == 1884
    assert config.mqtt.topic == "test/alerts"
    assert config.mqtt.username == "test_user"
    assert config.mqtt.password == "test_password"
    assert config.mqtt.client_id == "test_client"
