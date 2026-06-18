"""Built-in alarm profiles for common, standardized sounds.

These are ready-to-use profiles for the most common detection targets, so the
top use cases need zero tuning::

    from acoustic_engine.presets import load_preset, list_presets

    profile = load_preset("smoke_t3")

They are also available from the CLI::

    acoustic-engine run --preset smoke_t3
    acoustic-engine profiles            # list everything available
"""

from importlib import resources
from typing import List

from ..models import AlarmProfile
from ..profiles import load_profiles_from_yaml

_SUFFIX = ".yaml"


def list_presets() -> List[str]:
    """Return the names of all built-in presets, sorted."""
    names = [
        entry.name[: -len(_SUFFIX)]
        for entry in resources.files(__name__).iterdir()
        if entry.name.endswith(_SUFFIX)
    ]
    return sorted(names)


def load_preset(name: str) -> AlarmProfile:
    """Load a built-in preset profile by name (e.g. ``"smoke_t3"``).

    Args:
        name: Preset name, with or without the ``.yaml`` suffix.

    Returns:
        The AlarmProfile defined by the preset.

    Raises:
        KeyError: If no preset with that name exists. The message lists the
            available presets.
    """
    key = name[: -len(_SUFFIX)] if name.endswith(_SUFFIX) else name
    resource = resources.files(__name__) / f"{key}{_SUFFIX}"
    if not resource.is_file():
        available = ", ".join(list_presets()) or "(none)"
        raise KeyError(f"Unknown preset '{name}'. Available presets: {available}.")

    with resources.as_file(resource) as path:
        return load_profiles_from_yaml(path)[0]
