import json
import logging
import os
import shlex
import signal
import subprocess
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from flask import Flask, jsonify, render_template, request

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "videos.json"
MEDIA_DIR = BASE_DIR / "media"

MEDIA_DIR.mkdir(parents=True, exist_ok=True)
(MEDIA_DIR / "videos").mkdir(parents=True, exist_ok=True)

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
LOGGER = logging.getLogger("kpop_stage")


def load_video_config(config_path: Path) -> Dict[str, Any]:
    with config_path.open("r", encoding="utf-8") as fh:
        config = json.load(fh)

    if "default_video" not in config:
        raise ValueError("Configuration must include a 'default_video' entry")

    if "videos" not in config or not isinstance(config["videos"], list):
        raise ValueError("Configuration must include a list of videos under 'videos'")

    for entry in config["videos"]:
        if "id" not in entry or "file" not in entry or "name" not in entry:
            raise ValueError("Each video entry must include 'id', 'name', and 'file' keys")

    return config


def resolve_media_path(path_value: str) -> Path:
    path = Path(path_value)
    if not path.is_absolute():
        path = MEDIA_DIR / path
    return path.resolve()


class PlaybackController:
    def __init__(self, default_video: Path, player_command: Optional[List[str]] = None) -> None:
        self.default_video = default_video
        self._lock = threading.Lock()
        self._process: Optional[subprocess.Popen[bytes]] = None
        self._current: Optional[Path] = None

        if player_command:
            self._base_command = list(player_command)
        else:
            env_value = os.environ.get("VIDEO_PLAYER_CMD")
            if env_value:
                self._base_command = shlex.split(env_value)
            else:
                self._base_command = ["mpv", "--fs", "--no-terminal"]

    def start_default_loop(self) -> None:
        if not self.default_video.exists():
            raise FileNotFoundError(
                f"Default loop video not found: {self.default_video}. "
                "Update videos.json or copy the file into the media directory."
            )
        with self._lock:
            self._play_video_locked(self.default_video, loop=True)

    def play(self, video_path: Path) -> None:
        LOGGER.info("Starting playback: %s", video_path)
        with self._lock:
            self._stop_locked()
            self._play_video_locked(video_path, loop=False)

    def stop(self) -> None:
        with self._lock:
            self._stop_locked()

    def _stop_locked(self) -> None:
        if self._process and self._process.poll() is None:
            try:
                self._process.send_signal(signal.SIGINT)
                self._process.wait(timeout=3)
            except (OSError, subprocess.TimeoutExpired):
                self._process.kill()
        self._process = None
        self._current = None

    def _play_video_locked(self, video_path: Path, loop: bool) -> None:
        cmd = list(self._base_command)
        if loop:
            cmd.append("--loop")
        cmd.append(str(video_path))

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self._process = process
        self._current = video_path

        if not loop:
            threading.Thread(
                target=self._wait_and_restore_default,
                args=(process,),
                daemon=True,
            ).start()

    def _wait_and_restore_default(self, process: subprocess.Popen[bytes]) -> None:
        process.wait()
        with self._lock:
            if self._process is process:
                LOGGER.info("Playback finished. Returning to default loop.")
                self._play_video_locked(self.default_video, loop=True)


app = Flask(__name__, static_folder="static", template_folder="templates")
video_config = load_video_config(DATA_FILE)
DEFAULT_VIDEO_PATH = resolve_media_path(video_config["default_video"])
controller = PlaybackController(DEFAULT_VIDEO_PATH)


@app.route("/")
def index() -> str:
    return render_template("index.html")


@app.route("/api/videos")
def api_videos() -> Any:
    display_keys = {"id", "name", "poster", "description"}
    videos = []
    for entry in video_config["videos"]:
        video = {key: entry[key] for key in display_keys if key in entry}
        videos.append(video)
    return jsonify({"videos": videos})


@app.route("/api/play", methods=["POST"])
def api_play() -> Any:
    data = request.get_json(force=True, silent=True) or {}
    video_id = data.get("id")
    if not video_id:
        return jsonify({"error": "Missing 'id' in request body"}), 400

    video_entry = next((v for v in video_config["videos"] if v.get("id") == video_id), None)
    if not video_entry:
        return jsonify({"error": "Unknown video id"}), 404

    video_path = resolve_media_path(video_entry["file"])
    if not video_path.exists():
        return jsonify({"error": "Video file not found on server"}), 404

    try:
        controller.play(video_path)
    except FileNotFoundError:
        LOGGER.error('Video player command not found. Install mpv or set VIDEO_PLAYER_CMD.')
        return jsonify({"error": "Video player not available on server"}), 500
    except Exception:
        LOGGER.exception('Unable to start playback')
        return jsonify({"error": "Unable to start playback"}), 500

    return jsonify({"status": "playing", "id": video_id})


def main() -> None:
    controller.start_default_loop()
    app.run(host="0.0.0.0", port=5000)


if __name__ == "__main__":
    main()
