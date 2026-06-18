# Deploying the Acoustic Engine

Three ways to run detection so it survives reboots and failures.

## 1. systemd (recommended for a Raspberry Pi / Linux device)

```bash
pip install "acoustic-engine[mqtt]"          # mqtt extra optional

sudo cp deploy/acoustic-engine.service /etc/systemd/system/
sudo mkdir -p /etc/acoustic-engine
sudo cp config.example.yaml /etc/acoustic-engine/config.yaml   # edit to taste

sudo systemctl daemon-reload
sudo systemctl enable --now acoustic-engine
journalctl -u acoustic-engine -f             # live logs / detections
```

Edit `User=` and the `ExecStart=` line in the unit file for your device. For a
zero-config start, point `ExecStart` at a preset instead of a config:

```ini
ExecStart=/usr/local/bin/acoustic-engine run --preset smoke_t3
```

## 2. Docker / Docker Compose

The image bundles the engine, the validation API, and the tests. The mic is
shared into the container via `/dev/snd`.

```bash
docker compose up engine        # run detection (uses config.example.yaml)
docker compose up validate      # validation API for the browser tuner, on :8787
docker compose run --rm tests   # run the test suite
```

To detect a different config, edit `ACOUSTIC_CONFIG` in `docker-compose.yml`,
or run a preset directly:

```bash
docker compose run --rm engine acoustic-engine run --preset co_t4
```

## 3. Foreground (development)

```bash
acoustic-engine run --preset smoke_t3
acoustic-engine run --config config.yaml
```

`acoustic-engine run` is blocking; stop it with Ctrl-C. With no arguments it
falls back to `$ACOUSTIC_CONFIG`, then `./config.yaml`.
