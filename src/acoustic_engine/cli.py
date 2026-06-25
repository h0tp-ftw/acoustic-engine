"""Unified `acoustic-engine` command-line interface.

One front door for the whole project, so the common path is short and
discoverable instead of a set of `python -m acoustic_engine.<submodule>`
invocations:

    acoustic-engine run --preset smoke_t3          # detect, zero config
    acoustic-engine run --config config.yaml       # detect from a config file
    acoustic-engine learn --record --name "Dryer"  # mic -> profile YAML (live)
    acoustic-engine learn alarm.wav --name "Dryer" # recording file -> profile YAML
    acoustic-engine test --preset co_t4 --audio recording.wav -v
    acoustic-engine profiles                        # list built-in presets
    acoustic-engine serve --port 8787               # validation API for the tuner
"""

import argparse
import logging
import math
import sys
from typing import List, Optional, Tuple

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
        # CLI flags win over the config's actions block.
        on_detect = args.on_detect or next(
            (c.actions.on_detect for c in configs if c.actions.on_detect), None
        )
        webhook = args.webhook or next(
            (c.actions.webhook for c in configs if c.actions.webhook), None
        )
        runner.run_pipelines(
            pipelines, audio, mqtt_config, on_detect_cmd=on_detect, webhook_url=webhook
        )
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
    runner.run_pipelines(
        profiles,
        audio,
        mqtt_config=None,
        on_detect_cmd=args.on_detect,
        webhook_url=args.webhook,
    )
    return 0


# --------------------------------------------------------------------------- #
# learn
# --------------------------------------------------------------------------- #
# Timed capture default — long enough for several full alarm cycles, which the
# cycle inference in learn.py averages over. Interactive capture (Enter to stop)
# is bounded by _MAX_RECORD_SECONDS as a safety net.
_DEFAULT_RECORD_SECONDS = 12.0
_MAX_RECORD_SECONDS = 60.0


def _slug(name: str) -> str:
    """Filesystem-friendly stem from a profile name ('My Dryer' -> 'my_dryer')."""
    import re

    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return slug or "alarm"


def _save_wav(path: str, samples: "np.ndarray", sample_rate: int) -> None:  # noqa: F821
    """Write int16 mono samples as a 16-bit PCM WAV (re-readable by `learn`)."""
    import wave

    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(samples.astype("<i2").tobytes())


def _describe_profile(profile: AlarmProfile) -> str:
    """A human-readable, one-line-per-segment summary of an inferred pattern."""
    lines = ["Inferred pattern (sanity-check it, then hand-edit the YAML if needed):"]
    for seg in profile.segments:
        if seg.type == "tone" and seg.frequency:
            lines.append(
                f"  tone     {seg.frequency.min:>5.0f}-{seg.frequency.max:<5.0f} Hz "
                f"for {seg.duration.min:.2f}-{seg.duration.max:.2f}s"
            )
        else:
            lines.append(
                f"  silence  {'':>14}{seg.duration.min:.2f}-{seg.duration.max:.2f}s"
            )
    if profile.resolution:
        lines.append(
            f"  (high-res: min_tone={profile.resolution.min_tone_duration}s, "
            f"dropout={profile.resolution.dropout_tolerance}s)"
        )
    return "\n".join(lines)


def _record_for_learn(args: argparse.Namespace) -> "Tuple[np.ndarray, int]":  # noqa: F821
    """Capture live mic audio for `learn`, with a level meter and clear prompts.

    Returns (int16 mono samples, sample_rate). Raises AcousticEngineError with a
    friendly message when there is no capture backend, nothing was heard, or the
    signal was too quiet to learn from.
    """
    from .input.listener import audio_backend_help, list_input_devices

    audio = AudioSettings()
    if args.device is not None:
        audio.device_index = args.device
    if args.sample_rate:
        audio.sample_rate = args.sample_rate

    # Fail fast and clearly before prompting if there is nothing to record from.
    if not list_input_devices() and args.device is None:
        raise AcousticEngineError(audio_backend_help())

    print(f"Recording from {_device_label(audio.device_index)} ({audio.sample_rate} Hz).")

    # Interactive (press Enter to start/stop) only makes sense at a real terminal;
    # a fixed --seconds or a piped stdin falls back to a timed capture.
    interactive = args.seconds is None and sys.stdin.isatty()
    if interactive:
        print("Tip: let it run for several full alarm cycles so the pattern is clear.")
        try:
            input("Set off the alarm, then press Enter to start recording... ")
        except EOFError:
            interactive = False

    if interactive:
        print("Recording — press Enter to stop.\n")
        samples, peak = _run_capture(audio, stop_after=_MAX_RECORD_SECONDS, wait_for_enter=True)
    else:
        secs = args.seconds if args.seconds is not None else _DEFAULT_RECORD_SECONDS
        print(f"Recording for {secs:.0f}s — set off the alarm now.\n")
        samples, peak = _run_capture(audio, stop_after=secs)

    if samples is None:
        raise AcousticEngineError(audio_backend_help())
    if samples.size == 0:
        raise AcousticEngineError(
            "Captured no audio. List microphones with `acoustic-engine devices`, "
            "then retry with --device N."
        )

    peak_db = 20 * math.log10(peak) if peak > 1e-9 else -90.0
    if peak_db < -45:
        raise AcousticEngineError(
            f"I barely heard anything (peak {peak_db:.0f} dBFS). The mic may be muted "
            "or it's the wrong device. List devices with `acoustic-engine devices`, "
            "then retry with --device N."
        )

    print(f"Captured {samples.size / audio.sample_rate:.1f}s of audio (peak {peak_db:.0f} dBFS).\n")
    return samples, audio.sample_rate


def cmd_learn(args: argparse.Namespace) -> int:
    from pathlib import Path

    from .learn import learn_profile_from_audio, learn_profile_from_file
    from .profiles import save_profile_to_yaml

    if args.record:
        samples, sample_rate = _record_for_learn(args)
        profile = learn_profile_from_audio(samples, sample_rate, name=args.name or "Recorded Alarm")
    elif args.audio:
        profile = learn_profile_from_file(args.audio, name=args.name)
    else:
        logger.error(
            "Nothing to learn from. Pass a recording (e.g. `acoustic-engine learn "
            "alarm.wav`) or capture one live with `acoustic-engine learn --record`."
        )
        return 1

    output = args.output
    if output is None:
        output = (
            f"{_slug(profile.name)}.yaml"
            if args.record
            else str(Path(args.audio).with_suffix(".yaml"))
        )
    save_profile_to_yaml(profile, output)

    # When recording live, keep the WAV next to the profile so it can be
    # re-tested and opened in the tuner — otherwise the recording is lost.
    audio_ref = args.audio
    if args.record:
        audio_ref = str(Path(output).with_suffix(".wav"))
        _save_wav(audio_ref, samples, sample_rate)

    print(f"Wrote profile '{profile.name}' ({len(profile.segments)} segments) to {output}")
    if args.record:
        print(f"Kept the recording at {audio_ref}")
    print()
    print(_describe_profile(profile))
    print()
    print("Verify it against the recording with:")
    print(f"  acoustic-engine test --profile {output} --audio {audio_ref} -v")
    print("Then run it live with:")
    print(f"  acoustic-engine run --profile {output}")
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
# devices — list microphones
# --------------------------------------------------------------------------- #
def cmd_devices(args: argparse.Namespace) -> int:
    from .input.listener import audio_backend_help, list_input_devices

    devices = list_input_devices()
    if not devices:
        print("No audio input devices found.\n")
        print(audio_backend_help())
        return 1

    print("Input devices (use the index with: acoustic-engine run --device N):\n")
    for d in devices:
        marker = "  (default)" if d["default"] else ""
        print(f"  [{d['index']}] {d['name']}{marker}")
        print(f"        {d['channels']} input channel(s) · backend: {d['backend']}")
    return 0


# --------------------------------------------------------------------------- #
# doctor — is the mic working? live level meter + dominant frequency
# --------------------------------------------------------------------------- #
def _draw_meter(rms: float) -> None:
    """Draw an in-place level bar from an RMS amplitude (0..1)."""
    bar_len = 30
    level = min(1.0, rms / 0.3)  # ~0.3 RMS is already very loud
    filled = int(level * bar_len)
    db = 20 * math.log10(rms) if rms > 1e-9 else -90.0
    bar = "#" * filled + "-" * (bar_len - filled)
    sys.stdout.write(f"\r  level |{bar}| {db:6.1f} dBFS ")
    sys.stdout.flush()


def _dominant_frequency(samples, sample_rate: int) -> Optional[float]:
    """Strongest sustained frequency (Hz) in a capture, ignoring DC/hum."""
    import numpy as np

    if len(samples) < 256:
        return None
    windowed = samples * np.hanning(len(samples))
    spectrum = np.abs(np.fft.rfft(windowed))
    freqs = np.fft.rfftfreq(len(samples), 1.0 / sample_rate)
    mask = freqs >= 80.0  # ignore DC and mains hum
    if not mask.any() or spectrum[mask].max() <= 0:
        return None
    return float(freqs[mask][int(np.argmax(spectrum[mask]))])


def _device_label(device_index: Optional[int]) -> str:
    """Human label for the chosen input device, falling back gracefully."""
    from .input.listener import list_input_devices

    devices = list_input_devices()
    chosen = next(
        (d for d in devices if device_index is not None and d["index"] == device_index),
        next((d for d in devices if d["default"]), devices[0] if devices else None),
    )
    return f"[{chosen['index']}] {chosen['name']}" if chosen else "default input device"


def _run_capture(
    audio: AudioSettings,
    stop_after: Optional[float] = None,
    wait_for_enter: bool = False,
) -> "Tuple[Optional[np.ndarray], float]":  # noqa: F821
    """Capture mic audio with a live level meter; return (samples, peak_rms).

    Stops when `stop_after` seconds elapse, the user presses Enter (when
    `wait_for_enter`), or Ctrl-C — whichever comes first. Returns (None, 0.0) if
    no capture backend could be opened, or an empty array if nothing was heard.
    Shared by `doctor` (timed) and `learn --record` (interactive or timed).
    """
    import threading

    import numpy as np

    from .input.listener import AudioListener

    chunks: List[np.ndarray] = []
    peak_rms = [0.0]

    def on_chunk(chunk: np.ndarray) -> None:
        if len(chunk) == 0:
            return
        chunks.append(chunk)
        rms = float(np.sqrt(np.mean((chunk.astype(np.float32) / 32768.0) ** 2)))
        peak_rms[0] = max(peak_rms[0], rms)
        _draw_meter(rms)

    listener = AudioListener(audio, on_chunk)
    if not listener.setup():
        return None, 0.0

    timer = threading.Timer(stop_after, listener.stop) if stop_after is not None else None
    if timer is not None:
        timer.daemon = True
        timer.start()

    if wait_for_enter:

        def _wait_enter() -> None:
            try:
                input()
            except EOFError:
                return
            listener.stop()

        threading.Thread(target=_wait_enter, daemon=True).start()

    try:
        listener.start()
    except KeyboardInterrupt:
        listener.stop()
    finally:
        if timer is not None:
            timer.cancel()
        listener.cleanup()
    print()  # finish the meter line

    if not chunks:
        return np.array([], dtype=np.int16), peak_rms[0]
    return np.concatenate(chunks).astype(np.int16), peak_rms[0]


def cmd_doctor(args: argparse.Namespace) -> int:
    import numpy as np

    from .input.listener import audio_backend_help, list_input_devices

    audio = AudioSettings()
    if args.device is not None:
        audio.device_index = args.device

    if not list_input_devices() and args.device is None:
        print(audio_backend_help())
        return 1

    seconds = args.seconds
    print(f"Mic check on {_device_label(audio.device_index)} ({audio.sample_rate} Hz).")
    print(f"Listening for {seconds:.0f}s — make some noise (clap, whistle, or set off the alarm).\n")

    samples_i16, peak_rms = _run_capture(audio, stop_after=seconds)
    if samples_i16 is None:
        print(audio_backend_help())
        return 1
    if samples_i16.size == 0:
        print("\nCaptured no audio. Try a specific device: acoustic-engine devices")
        return 1

    samples = samples_i16.astype(np.float32)
    peak_db = 20 * math.log10(peak_rms) if peak_rms > 1e-9 else -90.0
    dominant = _dominant_frequency(samples, audio.sample_rate)

    print()
    if peak_db < -45:
        print("⚠  I barely heard anything.")
        print("   The mic may be muted or it's the wrong device.")
        print("   List devices with `acoustic-engine devices`, then retry with --device N.")
        return 1

    print("✓  Your microphone works.")
    print(f"   Peak level: {peak_db:.0f} dBFS")
    if dominant:
        print(f"   Loudest tone: ~{dominant:.0f} Hz")
    print("\nNext: capture an alarm into a profile —  acoustic-engine learn --record")
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
    p_run.add_argument(
        "--on-detect",
        metavar="CMD",
        help="Shell command to run on each detection. {name}/{timestamp} are "
        "substituted; $ALARM_NAME/$ALARM_TIMESTAMP are also set.",
    )
    p_run.add_argument(
        "--webhook",
        metavar="URL",
        help="POST a JSON {event,profile_name,timestamp} to this URL on each detection.",
    )
    p_run.set_defaults(func=cmd_run)

    # learn
    p_learn = sub.add_parser(
        "learn", help="Build a profile YAML from a recording (a WAV file or the live mic)."
    )
    p_learn.add_argument(
        "audio",
        nargs="?",
        default=None,
        help="Path to a recording of the alarm (WAV). Omit when using --record.",
    )
    p_learn.add_argument(
        "-r",
        "--record",
        action="store_true",
        help="Record from the microphone instead of reading a file.",
    )
    p_learn.add_argument("--device", type=int, help="Input device index (mic) for --record.")
    p_learn.add_argument(
        "--sample-rate", type=int, help="Capture sample rate in Hz for --record."
    )
    p_learn.add_argument(
        "--seconds",
        type=float,
        default=None,
        help="With --record, capture for a fixed number of seconds "
        "(default: press Enter to start and stop).",
    )
    p_learn.add_argument("--name", default=None, help="Name for the learned profile.")
    p_learn.add_argument("-o", "--output", default=None, help="Output YAML path.")
    p_learn.set_defaults(func=cmd_learn)

    # profiles
    p_profiles = sub.add_parser("profiles", help="List built-in presets.")
    p_profiles.set_defaults(func=cmd_profiles)

    # devices
    p_devices = sub.add_parser("devices", help="List microphones (input devices).")
    p_devices.set_defaults(func=cmd_devices)

    # doctor
    p_doctor = sub.add_parser(
        "doctor", help="Check the mic works: live level meter + dominant frequency."
    )
    p_doctor.add_argument("--device", type=int, help="Input device index to test.")
    p_doctor.add_argument(
        "--seconds", type=float, default=5.0, help="How long to listen (default 5)."
    )
    p_doctor.set_defaults(func=cmd_doctor)

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
