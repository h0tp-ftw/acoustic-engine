"""Exception types for the acoustic engine.

These give users actionable, human-readable feedback when a profile or
configuration file is malformed, instead of the engine silently doing the
wrong thing (e.g. loading zero profiles or ignoring a typo'd setting).
"""


class AcousticEngineError(Exception):
    """Base class for all acoustic-engine errors."""


class ProfileError(AcousticEngineError, ValueError):
    """Raised when an alarm profile is structurally invalid.

    The message is written for a human editing YAML by hand, naming the
    profile and segment at fault and what to do about it.
    """


class ConfigError(AcousticEngineError, ValueError):
    """Raised when a global configuration file is malformed or unusable."""
