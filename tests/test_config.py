"""Tests for configuration loading and validation."""

from acoustic_engine.config import GlobalConfig, MQTTConfig


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
