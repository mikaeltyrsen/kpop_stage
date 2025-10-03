# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

K-pop Stage Controller is a Raspberry Pi-powered Flask application that serves as a music video stage controller. It provides a web interface for playing K-pop music videos on an HDMI display with synchronized DMX lighting control. The application features automatic fallback to a default loop video when idle and supports mobile-friendly video selection with poster artwork.

## Development Commands

### Running the Application
```bash
# Basic development server
python app.py

# With custom video player (default is mpv)
VIDEO_PLAYER_CMD="vlc --fullscreen" python app.py
```

### Testing
```bash
# Run all tests
pytest

# Run specific test file
pytest tests/test_channel_presets_api.py

# Run tests with coverage
pytest --cov=. --cov-report=html

# Run single test function
pytest tests/test_mpv_flag.py::test_mpv_flag_handles_boolean_inputs
```

### Dependencies
```bash
# Install production dependencies
pip install -r requirements.txt

# Install testing dependencies
pip install pytest pytest-cov

# For Raspberry Pi DMX hardware support
sudo apt install mpv
pip install python-ola
```

## Architecture Overview

### Core Components

**Flask Application (`app.py`)**
- Main web server and API endpoints
- Video playback control via `PlaybackController` class
- Channel presets API for DMX configuration
- File upload handling for media and DMX templates

**DMX System (`dmx.py`)**
- `DMXOutput`: Hardware abstraction for DMX lighting control
- `DMXShowManager`: Orchestrates lighting cues synchronized with video playback
- `DMXAction`: Represents timed lighting commands with fade support
- Falls back to logging-only mode when python-ola is not available

**PlaybackController Class**
- Manages mpv media player via IPC (Unix socket communication)
- Handles automatic idle detection and fallback to default loop
- Supports custom video player commands via `VIDEO_PLAYER_CMD` environment variable
- Uses `_mpv_flag_is_true()` helper for interpreting mpv's boolean responses

### Data Flow

1. User selects video via web interface (`/static/app.js`)
2. Flask app loads corresponding DMX template from `dmx_templates/`
3. `PlaybackController` starts video playback via mpv IPC
4. `DMXShowManager` runs synchronized lighting cues
5. Idle monitor detects video end and returns to default loop

### Configuration Files

**`videos.json`**: Video catalog with DMX template associations
```json
{
  "default_video": "default_loop.mp4",
  "videos": [
    {
      "id": "unique_id",
      "name": "Display Name",
      "file": "videos/filename.mp4",
      "poster": "/static/posters/poster.jpg",
      "dmx_template": "template_file.json"
    }
  ]
}
```

**DMX Templates** (`dmx_templates/*.json`): Time-synchronized lighting cues
```json
{
  "actions": [
    {
      "time": "00:01:23",
      "channel": 23,
      "value": 255,
      "fade": 1.0
    }
  ]
}
```

**Channel Presets** (`channel_presets.json`): Reusable DMX channel configurations
- Managed via `/api/channel-presets` REST API
- Auto-sanitizes values to DMX ranges (channels 1-512, values 0-255)

### File Structure
```
media/
├── default_loop.mp4        # Idle loop video
└── videos/                 # Music video files
static/
├── app.js                  # Frontend logic
├── style.css               # UI styling  
└── posters/                # Video poster artwork
templates/index.html        # Main UI template
dmx_templates/              # Lighting cue files
DMX Template Builder/       # Standalone DMX template editor
tests/                      # Test suite
```

## Development Patterns

### Testing Philosophy
- Tests use `pytest.importorskip()` to gracefully handle optional dependencies
- DMX system includes mock classes (`DummyOutput`, `DummyRunner`) for testing without hardware
- API tests use Flask's test client with temporary file fixtures

### Error Handling
- `PlaybackController` includes comprehensive error handling for mpv communication failures
- DMX system gracefully degrades to logging-only mode when hardware unavailable
- File operations include proper exception handling with logging

### Threading Model
- `DMXOutput` runs continuous sender thread at 30fps
- `PlaybackController` uses idle monitoring thread for automatic video transitions
- All shared state protected with threading locks

## Hardware Dependencies

**Required for Full Functionality:**
- `mpv` media player (or alternative via `VIDEO_PLAYER_CMD`)
- `python-ola` for DMX lighting control (optional, degrades gracefully)

**Raspberry Pi Considerations:**
- Application designed for Pi deployment with systemd service configuration
- Network configuration assumes Pi creates WiFi hotspot on port 666
- DMX hardware typically connected via USB interface

## API Endpoints

- `GET/PUT /api/channel-presets`: Channel preset management
- `POST /play`: Start video playback
- `POST /stop`: Stop playback and return to default loop
- `POST /upload`: Media and DMX template file uploads

## Development Notes

- Config changes in `videos.json` require application restart
- DMX templates support timecode format `HH:MM:SS[.mmm]`
- Media files intentionally excluded from repository to reduce size
- Frontend uses vanilla JavaScript with mobile-responsive design