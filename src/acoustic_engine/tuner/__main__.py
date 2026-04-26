"""Entry point: python -m acoustic_engine.tuner

Launches the validation API server that the browser-based Profile Tuner
calls to run profiles through the real engine pipeline.
"""

from .validate import main

if __name__ == "__main__":
    main()
