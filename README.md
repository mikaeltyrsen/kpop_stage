# K-pop Stage Controller

A lightweight Flask application designed for a Raspberry Pi-powered music video “stage.” The Pi exposes a Wi-Fi network and serves a control panel over HTTPS on the standard web ports (`443` with automatic redirects from `80`). Anyone connected can choose a music video to play on the HDMI-connected display. When idle, a default loop video keeps playing in full screen.

## Features

- 📺 Full screen playback of local video files using `mpv` (recommended) or another player binary.
- 🔁 Automatic fallback to a default looping video when no selection is active.
- 🌐 Mobile-friendly web UI showing poster artwork and titles for each configured video.
- 🔌 Simple JSON configuration (`videos.json`) so you can add, remove, or rename entries without touching the code.

## Project layout

```
.
├── app.py                # Flask web server + playback controller
├── videos.json           # Configure your default loop and video list
├── media/
│   ├── README.md         # Instructions for adding your own media files
│   └── videos/           # Drop individual video files here
├── static/
│   ├── app.js            # Front-end logic
│   ├── style.css         # UI styling
│   └── posters/          # Poster artwork for each video
└── templates/index.html  # Control interface
```

## Prerequisites

- Raspberry Pi OS (Bullseye or newer recommended)
- Python 3.9+
- [`mpv`](https://mpv.io/) media player (install with `sudo apt install mpv`). You can substitute a different player by setting the `VIDEO_PLAYER_CMD` environment variable before launching the app.

## Setup

1. **Clone the repository on your Pi**

   ```bash
   git clone https://github.com/yourname/kpop_stage.git
   cd kpop_stage
   ```

2. **Create and activate a virtual environment (optional but recommended)**

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

3. **Install dependencies**

   ```bash
   pip install -r requirements.txt
   ```

4. **Add your media**

   - Copy your looping idle clip to `media/default_loop.mp4` (the repository leaves this file out so you can provide your own).
   - Copy your music videos into `media/videos/` (or adjust the paths in `videos.json`).
   - Add poster images in `static/posters/`.

5. **Edit `videos.json`**

   Update the file to reference your video filenames, posters, and display names:

   ```json
   {
     "default_video": "default_loop.mp4",
     "videos": [
       {
         "id": "pink_venom",
         "name": "BLACKPINK – Pink Venom",
         "file": "videos/pink_venom.mp4",
         "poster": "/static/posters/pink_venom.jpg"
       }
     ]
   }
   ```

   The `id` must be unique—it’s used by the web client when requesting playback.

6. **Run the server**

   ```bash
   python app.py
   ```

   The app launches the default loop and exposes the control page at `https://<pi-ip-address>/` (HTTP requests to port `80` are redirected automatically).

### HTTPS configuration

The application enables HTTPS by default using the Let's Encrypt certificate paths:

- Certificate: `/etc/letsencrypt/live/player.demonhunters.show/fullchain.pem`
- Private key: `/etc/letsencrypt/live/player.demonhunters.show/privkey.pem`

Override the defaults by exporting `TLS_CERT_PATH` and/or `TLS_KEY_PATH` before launching the app. You can also customise the listening ports (`HTTP_PORT`, `HTTPS_PORT`) or disable automatic redirects by setting `FORCE_HTTPS=0`.

## DMX output

The controller can drive DMX fixtures either through [OLA](https://www.openlighting.org/ola/) or by writing directly to a USB-to-RS485 adapter such as an FT232RL+SP485 based cable.

- **Using OLA (recommended):** Install the OLA daemon *and* the Python bindings on your Raspberry Pi. On Raspberry Pi OS you can run `sudo apt install ola ola-python`, or install the bindings in your virtualenv with `pip install python-ola`. Configure OLA to expose your USB or network DMX interface and the app will stream frames automatically. The app targets OLA universe `0` by default; set `DMX_UNIVERSE` in the environment if you need to use a different universe number.
- **Direct USB cable support:** If you are using a simple FTDI USB-to-DMX interface, install `pyserial` and set the `DMX_SERIAL_PORT` environment variable before starting the app.  You can also provide a USB serial number via `DMX_SERIAL_NUMBER` and the app will locate the matching adapter automatically:

  ```bash
  pip install pyserial
  # Option A: provide the device path directly
  export DMX_SERIAL_PORT=/dev/ttyUSB0

  # Option B: allow the app to discover the port using the adapter serial number
  export DMX_SERIAL_NUMBER=BG00TZ1P
  python app.py
  ```

  The serial sender defaults to DMX512 timing (250000 baud, 8N2). You can fine tune the break and mark-after-break durations with `DMX_BREAK_DURATION` and `DMX_MARK_AFTER_BREAK` environment variables if your hardware requires different timings. Leave `DMX_SERIAL_PORT` unset if you want to rely solely on OLA for output.
- **Startup scene for testing:** On startup the app immediately sets channels 1, 2, and 3 to full (255) so you can confirm that DMX output is flowing even before a show plays. Customise this behaviour with the `DMX_STARTUP_LEVELS` environment variable, using a comma-separated list of `CHANNEL=VALUE` assignments (for example `DMX_STARTUP_LEVELS="1=128,2=64,3=255"`). Set the variable to `off` (or leave it blank) to disable the automatic scene.

## Systemd service (optional)

To start the controller automatically on boot, create `/etc/systemd/system/kpop-stage.service`:

```ini
[Unit]
Description=K-pop Stage Controller
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/home/pi/kpop_stage
Environment="VIDEO_PLAYER_CMD=mpv"
ExecStart=/home/pi/kpop_stage/.venv/bin/python /home/pi/kpop_stage/app.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Then enable it:

```bash
sudo systemctl enable --now kpop-stage.service
```

## Development notes

- Media assets (videos, posters) are intentionally excluded so you can provide your own files without bloating the repository.
- The playback controller assumes the media player binary accepts `--fs` and `--loop` flags like `mpv` does. Adjust `VIDEO_PLAYER_CMD` if you use a different player.
- The Flask app reads `videos.json` once on startup. Restart the app to pick up configuration changes.

## License

MIT
