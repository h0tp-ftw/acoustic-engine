"""Production runner: load configuration(s) and run the detection engine.

The body is factored into small reusable functions (`load_configs`,
`build_pipelines`, `init_mqtt`, `run_pipelines`) so the unified CLI in
`acoustic_engine.cli` can drive detection from presets and ad-hoc profiles
without duplicating the audio-negotiation and MQTT wiring.
"""

import argparse
import copy
import datetime
import json
import logging
import os
import sys
from typing import List, Optional, Sequence, Tuple, Union

from .config import AudioSettings, EngineConfig, GlobalConfig, MQTTConfig
from .models import AlarmProfile
from .parallel_engine import ParallelEngine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler()],
)
logger = logging.getLogger("runner")

# A pipeline is either a bare profile (ParallelEngine auto-configures it) or
# an explicit (profile, engine_config) pair.
Pipeline = Union[AlarmProfile, Tuple[AlarmProfile, EngineConfig]]


def load_configs(config_paths: Sequence[str]) -> List[GlobalConfig]:
    """Load every config file, exiting with a clear error on the first failure."""
    configs: List[GlobalConfig] = []
    for config_path in config_paths:
        try:
            logger.info(f"Loading config: {config_path}")
            configs.append(GlobalConfig.load(config_path))
        except Exception as e:
            logger.error(f"Failed to load {config_path}: {e}")
            sys.exit(1)
    return configs


def build_pipelines(
    configs: Sequence[GlobalConfig], sources: Sequence[str]
) -> Tuple[List[Pipeline], AudioSettings]:
    """Negotiate a shared audio context and build one pipeline per profile.

    The highest sample rate across all configs wins (quality first); each
    config's tuned engine settings are kept but their audio geometry is aligned
    to that shared context.
    """
    best_audio = configs[0].audio
    for cfg in configs[1:]:
        if cfg.audio.sample_rate > best_audio.sample_rate:
            best_audio = cfg.audio
            logger.info(f"Upgrading global audio context to {best_audio.sample_rate}Hz")

    logger.info("=" * 50)
    logger.info(
        f"GLOBAL AUDIO CONTEXT: {best_audio.sample_rate}Hz, {best_audio.chunk_size} samples"
    )
    logger.info("=" * 50)

    pipelines: List[Pipeline] = []
    for cfg, source in zip(configs, sources):
        base = cfg.engine
        if base.sample_rate != best_audio.sample_rate:
            logger.warning(
                f"[{source}] Overriding sample_rate {base.sample_rate} -> {best_audio.sample_rate}"
            )
            base.sample_rate = best_audio.sample_rate
        if base.chunk_size != best_audio.chunk_size:
            logger.warning(
                f"[{source}] Overriding chunk_size {base.chunk_size} -> {best_audio.chunk_size}"
            )
            base.chunk_size = best_audio.chunk_size

        for profile in cfg.profiles:
            # Each profile gets its own copy so later tweaks can't bleed across.
            pipelines.append((profile, copy.copy(base)))
            logger.info(f"  + Pipeline: {profile.name} (sensitivity {base.min_magnitude})")

    return pipelines, best_audio


def init_mqtt(mqtt_config: Optional[MQTTConfig]):
    """Connect to the MQTT broker if enabled. Returns a client or None."""
    if not mqtt_config or not mqtt_config.enabled:
        return None
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        logger.error(
            "MQTT is enabled but paho-mqtt is not installed. "
            "Install it with: pip install 'acoustic-engine[mqtt]'"
        )
        return None
    try:
        try:
            client = mqtt.Client(
                callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                client_id=mqtt_config.client_id,
            )
        except AttributeError:  # paho-mqtt v1 fallback
            client = mqtt.Client(client_id=mqtt_config.client_id)

        if mqtt_config.username and mqtt_config.password:
            client.username_pw_set(mqtt_config.username, mqtt_config.password)

        logger.info(f"Connecting to MQTT broker at {mqtt_config.broker}:{mqtt_config.port}...")
        client.connect(mqtt_config.broker, mqtt_config.port, keepalive=60)
        client.loop_start()
        logger.info("MQTT connection established.")
        return client
    except Exception as e:
        logger.error(f"Failed to initialize MQTT client: {e}")
        return None


def _utc_now_iso() -> str:
    # e.g. "2026-06-19T12:34:56.789Z" — matches the original payload format.
    return (
        datetime.datetime.now(datetime.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def run_pipelines(
    pipelines: Sequence[Pipeline],
    audio_config: AudioSettings,
    mqtt_config: Optional[MQTTConfig] = None,
) -> None:
    """Run detection for the given pipelines until interrupted (blocking).

    Wires up MQTT publishing (if configured) and console logging, then starts a
    ParallelEngine. Shared by the production runner and the CLI.
    """
    if not pipelines:
        logger.error("No profiles to run.")
        sys.exit(1)

    mqtt_client = init_mqtt(mqtt_config)

    def publish(payload: dict) -> None:
        if not mqtt_client:
            return
        try:
            mqtt_client.publish(mqtt_config.topic, json.dumps(payload))
        except Exception as e:
            logger.error(f"Failed to publish MQTT message: {e}")

    def handle_detection(name: str) -> None:
        logger.info(f"🚨 DETECTED: {name}")
        publish({"event": "detected", "profile_name": name, "timestamp": _utc_now_iso()})

    def handle_match(match) -> None:
        logger.info(f"match details: {match.profile_name} cycle={match.cycle_count}")
        publish(
            {
                "event": "matched",
                "profile_name": match.profile_name,
                "cycle_count": match.cycle_count,
                "timestamp": _utc_now_iso(),
            }
        )

    engine = ParallelEngine(
        pipelines=list(pipelines),
        audio_config=audio_config,
        on_detection=handle_detection,
        on_match=handle_match,
    )

    try:
        engine.start()
    except KeyboardInterrupt:
        logger.info("Stopping...")
        engine.stop()
    finally:
        if mqtt_client:
            logger.info("Disconnecting MQTT client...")
            mqtt_client.loop_stop()
            mqtt_client.disconnect()


def run_from_configs(config_paths: Sequence[str]) -> None:
    """Load config file(s) and run detection (the production `--config` path)."""
    configs = load_configs(config_paths)
    if not configs:
        logger.error("No valid configurations loaded.")
        sys.exit(1)

    pipelines, best_audio = build_pipelines(configs, config_paths)

    mqtt_config = next((c.mqtt for c in configs if c.mqtt and c.mqtt.enabled), None)
    run_pipelines(pipelines, best_audio, mqtt_config)


def _resolve_config_paths(cli_paths: Optional[Sequence[str]]) -> List[str]:
    """Resolve config sources: CLI flags, then ACOUSTIC_CONFIG, then ./config.yaml."""
    if cli_paths:
        return list(cli_paths)

    env_cfg = os.getenv("ACOUSTIC_CONFIG")
    if env_cfg:
        logger.info(f"Using configuration from environment (ACOUSTIC_CONFIG): {env_cfg}")
        return [env_cfg]

    if os.path.exists("config.yaml"):
        logger.info("Using default configuration file (config.yaml)")
        return ["config.yaml"]

    return []


def main():
    parser = argparse.ArgumentParser(description="Acoustic Alarm Engine Runner")
    parser.add_argument(
        "-c",
        "--config",
        action="append",
        required=False,
        help="Path to YAML configuration file. Can be specified multiple times.",
    )
    args = parser.parse_args()

    config_paths = _resolve_config_paths(args.config)
    if not config_paths:
        logger.error(
            "No configuration sources found. Use --config, ACOUSTIC_CONFIG, or provide a config.yaml"
        )
        sys.exit(1)

    run_from_configs(config_paths)


if __name__ == "__main__":
    main()
