import argparse
import copy
import datetime
import json
import logging
import os
import sys
from typing import List, Tuple

from .config import EngineConfig, GlobalConfig
from .models import AlarmProfile
from .parallel_engine import ParallelEngine

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler()],
)
logger = logging.getLogger("runner")


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

    # 1. Determine configuration sources
    config_paths = args.config

    # If no flags, check environment variable
    if not config_paths:
        env_cfg = os.getenv("ACOUSTIC_CONFIG")
        if env_cfg:
            logger.info(f"Using configuration from environment (ACOUSTIC_CONFIG): {env_cfg}")
            config_paths = [env_cfg]

    # If still no source, check for default config.yaml
    if not config_paths:
        if os.path.exists("config.yaml"):
            logger.info("Using default configuration file (config.yaml)")
            config_paths = ["config.yaml"]

    if not config_paths:
        logger.error("No configuration sources found. Use --config, ACOUSTIC_CONFIG, or provide a config.yaml")
        sys.exit(1)

    # 1. Load all configurations
    configs: List[GlobalConfig] = []
    for config_path in config_paths:
        try:
            logger.info(f"Loading config: {config_path}")
            cfg = GlobalConfig.load(config_path)
            configs.append(cfg)
        except Exception as e:
            logger.error(f"Failed to load {config_path}: {e}")
            sys.exit(1)

    if not configs:
        logger.error("No valid configurations loaded.")
        sys.exit(1)

    # 2. Smart Negotiation for Audio Settings
    # Find the configuration with the highest sample rate
    # We prioritize sample rate for quality.
    best_audio_config = configs[0].audio

    for cfg in configs[1:]:
        if cfg.audio.sample_rate > best_audio_config.sample_rate:
            best_audio_config = cfg.audio
            logger.info(
                f"Upgrading Global Audio Context to {best_audio_config.sample_rate}Hz (found in config)"
            )

    logger.info("=" * 50)
    logger.info(
        f"GLOBAL AUDIO CONTEXT: {best_audio_config.sample_rate}Hz, {best_audio_config.chunk_size} samples"
    )
    logger.info("=" * 50)

    # 3. Build Parallel Pipelines
    pipelines: List[Tuple[AlarmProfile, EngineConfig]] = []

    for i, cfg in enumerate(configs):
        original_source = config_paths[i]

        # Keep each file's tuned engine settings, but align its audio geometry
        # (sample_rate, chunk_size) to the shared global context chosen above.
        base_engine_config = cfg.engine

        if base_engine_config.sample_rate != best_audio_config.sample_rate:
            logger.warning(
                f"[{original_source}] Overriding sample_rate {base_engine_config.sample_rate} -> {best_audio_config.sample_rate}"
            )
            base_engine_config.sample_rate = best_audio_config.sample_rate

        if base_engine_config.chunk_size != best_audio_config.chunk_size:
            logger.warning(
                f"[{original_source}] Overriding chunk_size {base_engine_config.chunk_size} -> {best_audio_config.chunk_size}"
            )
            base_engine_config.chunk_size = best_audio_config.chunk_size

        # One pipeline per profile; each gets its own copy of the file's engine
        # config so later per-pipeline tweaks can't bleed across profiles.
        for profile in cfg.profiles:
            final_config = copy.copy(base_engine_config)
            pipelines.append((profile, final_config))
            logger.info(
                f"  + Added Pipeline: {profile.name} (Sensitivity: {final_config.min_magnitude})"
            )

    # 4. Check MQTT Config and Initialize
    mqtt_config = None
    for cfg in configs:
        if cfg.mqtt and cfg.mqtt.enabled:
            mqtt_config = cfg.mqtt
            break

    mqtt_client = None
    if mqtt_config:
        try:
            import paho.mqtt.client as mqtt

            # Setup MQTT client (compatible with paho-mqtt v1 and v2)
            try:
                mqtt_client = mqtt.Client(
                    callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                    client_id=mqtt_config.client_id,
                )
            except AttributeError:
                mqtt_client = mqtt.Client(client_id=mqtt_config.client_id)

            if mqtt_config.username and mqtt_config.password:
                mqtt_client.username_pw_set(mqtt_config.username, mqtt_config.password)

            logger.info(f"Connecting to MQTT broker at {mqtt_config.broker}:{mqtt_config.port}...")
            mqtt_client.connect(mqtt_config.broker, mqtt_config.port, keepalive=60)
            mqtt_client.loop_start()
            logger.info("MQTT connection established.")
        except Exception as e:
            logger.error(f"Failed to initialize MQTT client: {e}")
            mqtt_client = None

    def handle_detection(name):
        logger.info(f"🚨 DETECTED: {name}")
        if mqtt_client:
            try:
                payload = json.dumps(
                    {
                        "event": "detected",
                        "profile_name": name,
                        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                    }
                )
                mqtt_client.publish(mqtt_config.topic, payload)
            except Exception as e:
                logger.error(f"Failed to publish MQTT detection message: {e}")

    def handle_match(match):
        logger.info(f"match details: {match.profile_name} cycle={match.cycle_count}")
        if mqtt_client:
            try:
                payload = json.dumps(
                    {
                        "event": "matched",
                        "profile_name": match.profile_name,
                        "cycle_count": match.cycle_count,
                        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                    }
                )
                mqtt_client.publish(mqtt_config.topic, payload)
            except Exception as e:
                logger.error(f"Failed to publish MQTT match message: {e}")

    # 5. Start Parallel Engine
    engine = ParallelEngine(
        pipelines=pipelines,
        audio_config=best_audio_config,
        on_detection=handle_detection,
        on_match=handle_match,
    )

    try:
        engine.start()
    except KeyboardInterrupt:
        logger.info("Stopping...")
        engine.stop()
        if mqtt_client:
            logger.info("Disconnecting MQTT client...")
            mqtt_client.loop_stop()
            mqtt_client.disconnect()


if __name__ == "__main__":
    main()
