#!/usr/bin/env bash
# Build the React tuner (tuner/) and bundle it into the Python package so that
# `acoustic-engine serve` can host the UI. Re-run after changing anything under
# tuner/. The output (src/acoustic_engine/tuner/static/) is committed so that a
# plain `pip install acoustic-engine[tuner]` ships the UI — no Node at install.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

cd "$root/tuner"
npm install --no-audit --no-fund
npm run build

dest="$root/src/acoustic_engine/tuner/static"
rm -rf "$dest"
mkdir -p "$dest"
cp -r dist/. "$dest/"
echo "Bundled tuner UI -> $dest"
