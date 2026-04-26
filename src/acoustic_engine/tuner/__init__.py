"""Tuner package for the Acoustic Engine.

The browser-based Profile Tuner lives in the standalone tuner/ React app
at the project root. This package provides the validation API that the
browser app calls to run profiles through the real engine pipeline.

Start the validation API:
    python -m acoustic_engine.tuner --port 8787

Or run the React tuner:
    cd tuner && npm run dev
"""
