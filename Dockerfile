FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# libportaudio2 is the PortAudio *runtime* sounddevice loads — no compile step,
# unlike PyAudio's portaudio19-dev. gcc/python3-dev kept as a safety net for any
# source-only transitive dependency.
RUN apt-get update && apt-get install -y \
    gcc \
    python3-dev \
    libportaudio2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy everything first — editable install needs the source tree
COPY . .

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -e ".[dev,tuner,mqtt]"

ENV ACOUSTIC_CONFIG=""

# Default to running detection (honors ACOUSTIC_CONFIG). Override the command
# for other subcommands, e.g. `docker run <img> acoustic-engine serve --host 0.0.0.0`.
CMD ["acoustic-engine", "run"]
