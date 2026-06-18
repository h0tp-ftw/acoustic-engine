"""Unified `acoustic-engine` command-line interface.

One front door for the whole project, so the common path is short and
discoverable instead of a set of `python -m acoustic_engine.<submodule>`
invocations:

    acoustic-engine run --preset smoke_t3          # detect, zero config
    acoustic-engine run --config config.yaml       # detect from a config file
    acoustic-engine learn alarm.wav --name "Dryer" # recording -> profile YAML
    acoustic-engine test --preset co_t4 --audio recording.wav -v
    acoustic-engine profiles                        # list built-in presets
    acoustic-engine serve --port 8787               # validation API for the tuner
"""

import argparse
import logging
import sys
from typing import List, Optional

from . import __version__
from .config import AudioSettings
from .errors import AcousticEngineError
from .models import AlarmProfile
from .presets import list_presets, load_preset
from .profiles import load_profiles_from_yaml

logger = logging.getLogger("acoustic-engine")


# --------------------------------------------------------------------------- #
# run
# --------------------------------------------------------------------------- #
def _gather_adhoc_profiles(args: argparse.Namespace) -> List[AlarmProfile]:
    """Collect profiles named via --preset / --profile (not --config)."""
    profiles: List[AlarmProfile] = []
    for name in args.preset or []:
        profiles.append(load_preset(name))
    for path in args.profile or []:
        profiles.extend(load_profiles_from_yaml(path))
    return profiles


def cmd_run(args: argparse.Namespace) -> int:
    # Imported lazily so `acoustic-engine profiles`/`learn` don't pull the
    # audio stack (PyAudio) unless detection is actually requested.
    from . import runner

    config_paths = list(args.config) if args.config else []
    # With no explicit source, fall back to ACOUSTIC_CONFIG / ./config.yaml,
    # so `acoustic-engine run` is a drop-in superset of the old runner.
    if not config_paths and not args.preset and not args.profile:
        config_paths = runner._resolve_config_paths(None)

    if config_paths:
        configs = runner.load_configs(config_paths)
        if not configs:
            logger.error("No valid configurations loaded.")
            return 1
        pipelines, audio = runner.build_pipelines(configs, config_paths)
        # Allow mixing a config with extra ad-hoc presets/profiles.
        pipelines = list(pipelines) + list(_gather_adhoc_profiles(args))
        mqtt_config = next((c.mqtt for c in configs if c.mqtt and c.mqtt.enabled), None)
        runner.run_pipelines(pipelines, audio, mqtt_config)
        return 0

    profiles = _gather_adhoc_profiles(args)
    if not profiles:
        logger.error(
            "Nothing to run. Provide --preset NAME, --profile FILE, or --config FILE. "
            "See available presets with: acoustic-engine profiles"
        )
        return 1

    audio = AudioSettings()
    if args.sample_rate:
        audio.sample_rate = args.sample_rate
    if args.device is not None:
        audio.device_index = args.device

    logger.info("Listening for: %s", ", ".join(p.name for p in profiles))
    runner.run_pipelines(profiles, audio, mqtt_config=None)
    return 0


# --------------------------------------------------------------------------- #
# learn
# --------------------------------------------------------------------------- #
def cmd_learn(args: argparse.Namespace) -> int:
    from .learn import learn_profile_from_file

    output = args.output
    if output is None:
        # Default next to the recording: alarm.wav -> alarm.yaml
        from pathlib import Path

        output = str(Path(args.audio).with_suffix(".yaml"))

    profile = learn_profile_from_file(args.audio, name=args.name)
    from .profiles import save_profile_to_yaml

    save_profile_to_yaml(profile, output)
    print(f"Wrote profile '{profile.name}' ({len(profile.segments)} segments) to {output}")
    print("Verify it against the recording with:")
    print(f"  acoustic-engine test --profile {output} --audio {args.audio} -v")
    return 0


# --------------------------------------------------------------------------- #
# profiles (list presets)
# --------------------------------------------------------------------------- #
def _freq_span(profile: AlarmProfile) -> str:
    tones = [s for s in profile.segments if s.type == "tone" and s.frequency]
    if not tones:
        return "—"
    lo = min(s.frequency.min for s in tones)
    hi = max(s.frequency.max for s in tones)
    return f"{lo:.0f}-{hi:.0f} Hz"


def cmd_profiles(args: argparse.Namespace) -> int:
    names = list_presets()
    if not names:
        print("No built-in presets found.")
        return 0
    print("Built-in presets (use with: acoustic-engine run --preset NAME):\n")
    for name in names:
        profile = load_preset(name)
        tones = sum(1 for s in profile.segments if s.type == "tone")
        print(f"  {name:<12} {profile.name}")
        print(f"  {'':<12} {tones} tones, {_freq_span(profile)}, {profile.confirmation_cycles} cycle(s)")
    return 0


# --------------------------------------------------------------------------- #
# test / serve — forward to the existing mature entry points
# --------------------------------------------------------------------------- #
def cmd_test(rest: List[str]) -> int:
    """Forward to the mature tester CLI, with `--preset NAME` sugar."""
    from .tester import cli as tester_cli

    forwarded = list(rest)
    if "--preset" in forwarded:
        i = forwarded.index("--preset")
        name = forwarded[i + 1] if i + 1 < len(forwarded) else None
        del forwarded[i : i + 2]
        if name:
            # Materialize the built-in preset to a temp YAML the tester can open.
            import tempfile

            from .profiles import save_profile_to_yaml

            profile = load_preset(name)
            tmp = tempfile.NamedTemporaryFile(
                "w", suffix=".yaml", prefix=f"{name}_", delete=False
            )
            tmp.close()
            save_profile_to_yaml(profile, tmp.name)
            forwarded = ["--profile", tmp.name] + forwarded

    sys.argv = ["acoustic-engine test", *forwarded]
    tester_cli()
    return 0


def cmd_serve(rest: List[str]) -> int:
    """Forward to the validation API server (needs the 'tuner' extra)."""
    if rest and rest[0] in ("-h", "--help"):
        print(
            "usage: acoustic-engine serve [--port PORT] [--host HOST]\n\n"
            "Run the validation API used by the browser tuner.\n"
            "Requires the 'tuner' extra:  pip install 'acoustic-engine[tuner]'"
        )
        return 0
    try:
        from .tuner.validate import main as serve_main
    except ImportError:
        logger.error(
            "The validation server needs the 'tuner' extra. "
            "Install it with: pip install 'acoustic-engine[tuner]'"
        )
        return 1

    sys.argv = ["acoustic-engine serve", *rest]
    serve_main()
    return 0


# --------------------------------------------------------------------------- #
# parser
# --------------------------------------------------------------------------- #
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="acoustic-engine",
        description="Real-time acoustic alarm pattern detection.",
    )
    parser.add_argument("--version", action="version", version=f"acoustic-engine {__version__}")
    sub = parser.add_subparsers(dest="command", metavar="<command>")

    # run
    p_run = sub.add_parser("run", help="Run detection (from presets, profiles, or a config).")
    p_run.add_argument("-c", "--config", action="append", help="Config YAML (repeatable).")
    p_run.add_argument(
        "-p", "--preset", action="append", help="Built-in preset name (repeatable)."
    )
    p_run.add_argument(
        "-f", "--profile", action="append", help="Profile YAML file (repeatable)."
    )
    p_run.add_argument("--device", type=int, help="Input device index (mic).")
    p_run.add_argument("--sample-rate", type=int, help="Capture sample rate in Hz.")
    p_run.set_defaults(func=cmd_run)

    # learn
    p_learn = sub.add_parser("learn", help="Build a profile YAML from a recording.")
    p_learn.add_argument("audio", help="Path to a recording of the alarm (WAV).")
    p_learn.add_argument("--name", default=None, help="Name for the learned profile.")
    p_learn.add_argument("-o", "--output", default=None, help="Output YAML path.")
    p_learn.set_defaults(func=cmd_learn)

    # profiles
    p_profiles = sub.add_parser("profiles", help="List built-in presets.")
    p_profiles.set_defaults(func=cmd_profiles)

    # test / serve are intercepted before argparse (see main) so their own
    # flags pass through untouched; declared here only for the help listing.
    sub.add_parser(
        "test", help="Test a profile/preset against audio (forwards to the tester).",
        add_help=False,
    )
    sub.add_parser(
        "serve", help="Run the validation API used by the browser tuner.",
        add_help=False,
    )

    return parser


def main(argv: Optional[List[str]] = None) -> int:
    argv = list(sys.argv[1:]) if argv is None else list(argv)

    # Intercept pass-through commands before argparse so their leading options
    # (e.g. `test --profile x`) aren't swallowed by the top-level parser.
    if argv and argv[0] in ("test", "serve"):
        try:
            return cmd_test(argv[1:]) if argv[0] == "test" else cmd_serve(argv[1:])
        except (AcousticEngineError, FileNotFoundError, KeyError) as e:
            logger.error(str(e))
            return 1

    parser = build_parser()
    args = parser.parse_args(argv)

    if not getattr(args, "command", None):
        parser.print_help()
        return 1

    try:
        return args.func(args)
    except (AcousticEngineError, FileNotFoundError, KeyError) as e:
        logger.error(str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
