import json
import logging
import os
import shlex
import shutil
import signal
import socket
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Union

from flask import (
    Flask,
    abort,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
)

from dmx import DMXShowManager, create_manager

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "videos.json"
MEDIA_DIR = BASE_DIR / "media"
DMX_TEMPLATE_DIR = BASE_DIR / "dmx_templates"
DMX_BUILDER_DIR = BASE_DIR / "DMX Template Builder"
CHANNEL_PRESETS_FILE = BASE_DIR / "channel_presets.json"

MEDIA_DIR.mkdir(parents=True, exist_ok=True)
(MEDIA_DIR / "videos").mkdir(parents=True, exist_ok=True)
DMX_TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
DMX_BUILDER_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
LOGGER = logging.getLogger("kpop_stage")


def _generate_channel_preset_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def _clamp(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


def sanitize_channel_value(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    value_id = raw.get("id")
    if not isinstance(value_id, str) or not value_id:
        value_id = _generate_channel_preset_id("value")
    name = raw.get("name") if isinstance(raw.get("name"), str) else ""
    try:
        numeric_value = int(raw.get("value", 0))
    except (TypeError, ValueError):
        numeric_value = 0
    clamped = _clamp(numeric_value, 0, 255)
    return {"id": value_id, "name": name, "value": clamped}


def sanitize_channel_preset(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    preset_id = raw.get("id")
    if not isinstance(preset_id, str) or not preset_id:
        preset_id = _generate_channel_preset_id("preset")
    name = raw.get("name") if isinstance(raw.get("name"), str) else ""
    try:
        channel_value = int(raw.get("channel", 1))
    except (TypeError, ValueError):
        channel_value = 1
    channel = _clamp(channel_value, 1, 512)
    values_raw = raw.get("values")
    values: Iterable[Dict[str, Any]]
    if isinstance(values_raw, list):
        values = filter(None, (sanitize_channel_value(entry) for entry in values_raw))
    else:
        values = []
    return {"id": preset_id, "name": name, "channel": channel, "values": list(values)}


def load_channel_presets_from_disk() -> List[Dict[str, Any]]:
    if not CHANNEL_PRESETS_FILE.exists():
        return []
    try:
        with CHANNEL_PRESETS_FILE.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        LOGGER.exception("Unable to read channel presets file")
        return []

    if isinstance(data, dict):
        raw_presets = data.get("presets", [])
    else:
        raw_presets = data

    if not isinstance(raw_presets, list):
        LOGGER.warning("Channel presets file did not contain a list of presets")
        return []

    sanitized: List[Dict[str, Any]] = []
    for entry in raw_presets:
        preset = sanitize_channel_preset(entry)
        if preset:
            sanitized.append(preset)
    return sanitized


def save_channel_presets_to_disk(presets: Iterable[Dict[str, Any]]) -> None:
    sanitized: List[Dict[str, Any]] = []
    for entry in presets:
        preset = sanitize_channel_preset(entry)
        if preset:
            sanitized.append(preset)

    try:
        with CHANNEL_PRESETS_FILE.open("w", encoding="utf-8") as fh:
            json.dump({"presets": sanitized}, fh, indent=2)
    except OSError:
        LOGGER.exception("Unable to write channel presets file")
        raise


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


def _mpv_flag_is_true(value: Union[str, int, float, bool, None]) -> bool:
    """Interpret common mpv truthy/falsey responses.

    mpv's IPC interface sometimes returns string values like "yes"/"no" rather
    than canonical booleans.  Treat those (and numeric strings) sensibly so the
    playback controller doesn't mistake "no" for a truthy value.
    """

    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"", "0", "false", "no", "off"}:
            return False
        if normalized in {"1", "true", "yes", "on"}:
            return True
        try:
            return float(normalized) != 0.0
        except ValueError:
            return bool(normalized)
    return bool(value)


class PlaybackController:
    def __init__(
        self,
        default_video: Path,
        player_command: Optional[List[str]] = None,
        on_video_start: Optional[Callable[[Path], None]] = None,
        on_default_start: Optional[Callable[[Path], None]] = None,
    ) -> None:
        self.default_video = default_video
        self._lock = threading.Lock()
        self._process: Optional[subprocess.Popen[bytes]] = None
        self._current: Optional[Path] = None
        self._ipc_path = str(BASE_DIR / "mpv-ipc.sock")
        self._idle_monitor_thread: Optional[threading.Thread] = None
        self._idle_monitor_stop: Optional[threading.Event] = None
        self._on_video_start = on_video_start
        self._on_default_start = on_default_start
        self._default_missing_message = (
            f"Default loop video not found: {self.default_video}. "
            "Update videos.json or copy the file into the media directory."
        )

        if player_command:
            self._base_command = list(player_command)
        else:
            env_value = os.environ.get("VIDEO_PLAYER_CMD")
            if env_value:
                self._base_command = shlex.split(env_value)
            else:
                self._base_command = ["mpv", "--fs", "--no-terminal"]

        player_binary = self._base_command[0]
        resolved_binary = shutil.which(player_binary)
        if resolved_binary:
            self._base_command[0] = resolved_binary
            self._player_available = True
        else:
            LOGGER.warning(
                "Video player command '%s' not found on PATH. Install it or set VIDEO_PLAYER_CMD.",
                player_binary,
            )
            self._player_available = False

    @property
    def default_missing_message(self) -> str:
        return self._default_missing_message

    def start_default_loop(self) -> None:
        with self._lock:
            self._start_default_locked()

    def play(self, video_path: Path) -> None:
        LOGGER.info("Starting playback: %s", video_path)
        with self._lock:
            self._play_video_locked(video_path, loop=False)

    def stop(self) -> None:
        with self._lock:
            self._start_default_locked()

    def _play_video_locked(self, video_path: Path, loop: bool) -> None:
        if not self._player_available:
            raise FileNotFoundError(
                "Video player command not found. Install mpv or configure VIDEO_PLAYER_CMD."
            )

        if loop and not video_path.exists():
            raise FileNotFoundError(self._default_missing_message)
        if not video_path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")

        self._ensure_player_running()
        try:
            self._send_ipc_command("loadfile", str(video_path), "replace")
            loop_value = "inf" if loop else "no"
            self._send_ipc_command("set_property", "loop-file", loop_value)
            # Ensure playback resumes even if mpv left the file paused at EOF.
            self._send_ipc_command("set_property", "pause", "no")
        except OSError as exc:
            LOGGER.exception("Unable to communicate with mpv over IPC")
            self._reset_player_state()
            raise RuntimeError("Unable to control mpv player") from exc

        self._current = video_path
        if loop:
            self._cancel_idle_monitor_locked()
            if self._on_default_start:
                try:
                    self._on_default_start(video_path)
                except Exception:  # pragma: no cover - defensive logging
                    LOGGER.exception("Default start callback failed")
        else:
            self._start_idle_monitor_locked()
            if self._on_video_start:
                try:
                    self._on_video_start(video_path)
                except Exception:  # pragma: no cover - defensive logging
                    LOGGER.exception("Video start callback failed")

    def _start_default_locked(self) -> None:
        if not self.default_video.exists():
            raise FileNotFoundError(self._default_missing_message)

        if (
            self._process
            and self._process.poll() is None
            and self._current == self.default_video
        ):
            return

        self._play_video_locked(self.default_video, loop=True)

    def _ensure_player_running(self) -> None:
        if self._process and self._process.poll() is None:
            return

        if not self._player_available:
            raise FileNotFoundError(
                "Video player command not found. Install mpv or configure VIDEO_PLAYER_CMD."
            )

        ipc_path = Path(self._ipc_path)
        if ipc_path.exists():
            try:
                ipc_path.unlink()
            except OSError:
                pass

        cmd = list(self._base_command)
        cmd.extend(
            [
                "--idle=yes",
                "--force-window=yes",
                "--keep-open=yes",
                f"--input-ipc-server={self._ipc_path}",
            ]
        )

        try:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except FileNotFoundError as exc:
            self._player_available = False
            raise FileNotFoundError(
                "Video player command not found. Install mpv or configure VIDEO_PLAYER_CMD."
            ) from exc

        self._process = process
        self._wait_for_ipc_ready()

    def _wait_for_ipc_ready(self, timeout: float = 5.0) -> None:
        if not self._process:
            return

        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self._process.poll() is not None:
                raise RuntimeError("mpv exited while starting up")
            try:
                response = self._send_ipc_command("get_property", "pause")
            except OSError:
                time.sleep(0.1)
                continue

            if response.get("error") == "success":
                return

        raise RuntimeError("Timed out waiting for mpv IPC to become ready")

    def _send_ipc_command(self, *command: str) -> Dict[str, Any]:
        payload = json.dumps({"command": list(command)}).encode("utf-8") + b"\n"

        with socket.socket(socket.AF_UNIX) as sock:
            sock.connect(self._ipc_path)
            sock.sendall(payload)
            data = b""
            while not data.endswith(b"\n"):
                chunk = sock.recv(4096)
                if not chunk:
                    break
                data += chunk

        if not data:
            return {"error": "empty"}
        try:
            return json.loads(data.decode("utf-8"))
        except json.JSONDecodeError:
            return {"error": "invalid"}

    def _get_property_locked(self, name: str) -> Any:
        try:
            response = self._send_ipc_command("get_property", name)
        except OSError:
            return None

        if response.get("error") == "success":
            return response.get("data")
        return None

    @staticmethod
    def _coerce_float(value: Any) -> Optional[float]:
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                return None
        return None

    def query_state(self) -> Dict[str, Any]:
        with self._lock:
            current = self._current
            is_default = current is None or current == self.default_video
            process_running = self._process is not None and self._process.poll() is None

            volume_value: Optional[float] = None
            position_value: Optional[float] = None
            duration_value: Optional[float] = None
            paused_value: Optional[bool] = None

            if process_running:
                volume_raw = self._get_property_locked("volume")
                position_raw = self._get_property_locked("time-pos")
                duration_raw = self._get_property_locked("duration")
                pause_raw = self._get_property_locked("pause")

                volume_value = self._coerce_float(volume_raw)
                position_value = self._coerce_float(position_raw)
                duration_value = self._coerce_float(duration_raw)
                if pause_raw is not None:
                    paused_value = _mpv_flag_is_true(pause_raw)

            return {
                "current": str(current) if current else None,
                "is_default": is_default,
                "is_running": process_running,
                "volume": volume_value,
                "position": position_value,
                "duration": duration_value,
                "paused": paused_value,
            }

    def set_volume(self, volume: Union[int, float]) -> float:
        clamped = max(0.0, min(100.0, float(volume)))
        with self._lock:
            if not (self._process and self._process.poll() is None):
                self._ensure_player_running()

            try:
                self._send_ipc_command("set_property", "volume", str(clamped))
            except OSError as exc:
                LOGGER.exception("Unable to communicate with mpv while setting volume")
                self._reset_player_state()
                raise RuntimeError("Unable to control mpv player") from exc

            current_volume = self._get_property_locked("volume")

        coerced = self._coerce_float(current_volume)
        return clamped if coerced is None else coerced

    def _cancel_idle_monitor_locked(self) -> None:
        if self._idle_monitor_stop:
            self._idle_monitor_stop.set()
            self._idle_monitor_stop = None
        self._idle_monitor_thread = None

    def _start_idle_monitor_locked(self) -> None:
        self._cancel_idle_monitor_locked()
        stop_event = threading.Event()
        self._idle_monitor_stop = stop_event
        thread = threading.Thread(
            target=self._monitor_idle_and_restore_default,
            args=(stop_event,),
            daemon=True,
        )
        self._idle_monitor_thread = thread
        thread.start()

    def _monitor_idle_and_restore_default(self, stop_event: threading.Event) -> None:
        start_time = time.monotonic()
        has_started_playing = False

        while not stop_event.is_set():
            time.sleep(0.5)
            try:
                idle_response = self._send_ipc_command("get_property", "idle-active")
            except OSError:
                return

            idle = idle_response.get("error") == "success" and _mpv_flag_is_true(
                idle_response.get("data")
            )

            if not has_started_playing:
                # mpv reports eof-reached=True for a short window after a file ends,
                # even immediately after loading a new file.  Ignore idle/eof until
                # we've confirmed that playback actually started so we don't bounce
                # straight back to the default loop when replaying a song.
                if not idle:
                    has_started_playing = True
                elif time.monotonic() - start_time < 5.0:
                    continue
                else:
                    with self._lock:
                        if stop_event.is_set():
                            return
                        self._play_video_locked(self.default_video, loop=True)
                    return

            eof_reached = False
            if not idle:
                eof_response = self._send_ipc_command("get_property", "eof-reached")
                eof_reached = _mpv_flag_is_true(eof_response.get("data")) if (
                    eof_response.get("error") == "success"
                ) else False

            if idle or eof_reached:
                with self._lock:
                    if stop_event.is_set():
                        return
                    self._play_video_locked(self.default_video, loop=True)
                return

    def _reset_player_state(self) -> None:
        if self._process and self._process.poll() is None:
            try:
                self._process.send_signal(signal.SIGINT)
                self._process.wait(timeout=3)
            except (OSError, subprocess.TimeoutExpired):
                self._process.kill()

        self._process = None
        self._current = None
        self._cancel_idle_monitor_locked()


app = Flask(__name__, static_folder="static", template_folder="templates")
video_config = load_video_config(DATA_FILE)
DEFAULT_VIDEO_PATH = resolve_media_path(video_config["default_video"])
DMX_UNIVERSE = int(os.environ.get("DMX_UNIVERSE", "0"))

dmx_manager: DMXShowManager = create_manager(DMX_TEMPLATE_DIR, universe=DMX_UNIVERSE)
controller = PlaybackController(
    DEFAULT_VIDEO_PATH,
    on_default_start=lambda _: dmx_manager.stop_show(),
)


def get_video_entry(video_id: str) -> Optional[Dict[str, Any]]:
    return next((v for v in video_config["videos"] if v.get("id") == video_id), None)


def get_video_entry_by_path(video_path: Path) -> Optional[Dict[str, Any]]:
    for entry in video_config["videos"]:
        file_value = entry.get("file")
        if not file_value:
            continue
        if resolve_media_path(file_value) == video_path:
            return entry
    return None


@app.route("/")
def index() -> str:
    return render_template("index.html")


@app.route("/media/<path:filename>")
def media_file(filename: str):
    target = (MEDIA_DIR / filename).resolve()
    try:
        target.relative_to(MEDIA_DIR)
    except ValueError:
        abort(404)
    if not target.exists() or not target.is_file():
        abort(404)
    return send_from_directory(MEDIA_DIR, filename)


@app.route("/dmx-template-builder")
def dmx_template_builder_root() -> Any:
    return redirect("/dmx-template-builder/")


@app.route("/dmx-template-builder/")
def dmx_template_builder() -> Any:
    index_path = DMX_BUILDER_DIR / "index.html"
    if not index_path.exists():
        abort(404)
    return send_from_directory(DMX_BUILDER_DIR, "index.html")


@app.route("/dmx-template-builder/<path:filename>")
def dmx_template_builder_assets(filename: str):
    target = (DMX_BUILDER_DIR / filename).resolve()
    try:
        target.relative_to(DMX_BUILDER_DIR)
    except ValueError:
        abort(404)
    if not target.exists():
        abort(404)
    return send_from_directory(DMX_BUILDER_DIR, filename)


@app.route("/api/channel-presets", methods=["GET"])
def api_get_channel_presets() -> Any:
    presets = load_channel_presets_from_disk()
    return jsonify({"presets": presets})


@app.route("/api/channel-presets", methods=["PUT"])
def api_put_channel_presets() -> Any:
    data = request.get_json(silent=True)  # type: ignore[no-untyped-call]
    if data is None:
        return jsonify({"error": "Request body must be JSON"}), 400

    if isinstance(data, list):
        raw_presets = data
    else:
        raw_presets = data.get("presets")

    if not isinstance(raw_presets, list):
        return jsonify({"error": "Request must include a list of presets"}), 400

    try:
        save_channel_presets_to_disk(raw_presets)
    except OSError:
        return jsonify({"error": "Unable to save channel presets"}), 500

    presets = load_channel_presets_from_disk()
    return jsonify({"presets": presets})


@app.route("/api/videos")
def api_videos() -> Any:
    display_keys = {"id", "name", "poster", "description", "dmx_template", "file"}
    videos = []
    for entry in video_config["videos"]:
        video = {key: entry[key] for key in display_keys if key in entry}
        file_value = entry.get("file")
        if file_value:
            video["video_url"] = f"/media/{file_value}"
        videos.append(video)
    return jsonify({"videos": videos})


@app.route("/api/play", methods=["POST"])
def api_play() -> Any:
    data = request.get_json(force=True, silent=True) or {}
    video_id = data.get("id")
    if not video_id:
        return jsonify({"error": "Missing 'id' in request body"}), 400

    video_entry = get_video_entry(video_id)
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

    try:
        dmx_manager.start_show_for_video(video_entry)
    except Exception:
        LOGGER.exception("Unable to start DMX show for video %s", video_entry.get("name"))

    return jsonify({"status": "playing", "id": video_id})


@app.route("/api/stop", methods=["POST"])
def api_stop() -> Any:
    try:
        controller.stop()
    except FileNotFoundError:
        LOGGER.error(controller.default_missing_message)
        return (
            jsonify({"error": "Default loop video missing on server"}),
            500,
        )
    except Exception:
        LOGGER.exception("Unable to stop playback")
        return jsonify({"error": "Unable to stop playback"}), 500

    dmx_manager.stop_show()

    return jsonify({"status": "default_loop"})


@app.route("/api/status")
def api_status() -> Any:
    state = controller.query_state()
    mode = "default_loop" if state.get("is_default") else "video"

    video_info: Optional[Dict[str, Any]] = None
    current_value = state.get("current")
    if mode == "video" and isinstance(current_value, str):
        try:
            current_path = Path(current_value)
        except (TypeError, ValueError):
            current_path = None
        if current_path:
            entry = get_video_entry_by_path(current_path)
            if entry:
                video_info = {
                    "id": entry.get("id"),
                    "name": entry.get("name"),
                    "poster": entry.get("poster"),
                }

    payload: Dict[str, Any] = {
        "mode": mode,
        "volume": state.get("volume"),
        "position": state.get("position"),
        "duration": state.get("duration"),
        "paused": state.get("paused"),
        "video": video_info,
    }

    return jsonify(payload)


@app.route("/api/volume", methods=["POST"])
def api_volume() -> Any:
    data = request.get_json(force=True, silent=True) or {}
    if "volume" not in data:
        return jsonify({"error": "Missing 'volume' in request body"}), 400

    try:
        requested_volume = float(data["volume"])
    except (TypeError, ValueError):
        return jsonify({"error": "Volume must be a number"}), 400

    try:
        new_volume = controller.set_volume(requested_volume)
    except FileNotFoundError:
        LOGGER.error(controller.default_missing_message)
        return jsonify({"error": "Default loop video missing on server"}), 500
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 500
    except Exception:
        LOGGER.exception("Unable to set playback volume")
        return jsonify({"error": "Unable to set playback volume"}), 500

    return jsonify({"status": "ok", "volume": new_volume})


@app.route("/api/dmx/templates/<video_id>", methods=["GET", "POST"])
def api_dmx_template(video_id: str) -> Any:
    video_entry = get_video_entry(video_id)
    if not video_entry:
        return jsonify({"error": "Unknown video id"}), 404

    template_path = dmx_manager.template_path_for_video(video_entry)

    if request.method == "GET":
        try:
            actions = dmx_manager.load_show_for_video(video_entry)
        except RuntimeError as exc:
            return jsonify({"error": str(exc)}), 500

        try:
            relative_path = template_path.relative_to(BASE_DIR)
            template_str = str(relative_path)
        except ValueError:
            template_str = str(template_path)

        response = {
            "video": {
                "id": video_entry.get("id"),
                "name": video_entry.get("name"),
                "dmx_template": template_str,
                "file": video_entry.get("file"),
                "video_url": f"/media/{video_entry['file']}"
                if video_entry.get("file")
                else None,
            },
            "template_exists": template_path.exists(),
            "actions": dmx_manager.serialize_actions(actions),
        }
        return jsonify(response)

    data = request.get_json(force=True, silent=True) or {}
    actions_payload = data.get("actions")
    if not isinstance(actions_payload, list):
        return jsonify({"error": "Request body must include an 'actions' list"}), 400

    try:
        dmx_manager.save_actions(template_path, actions_payload)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        LOGGER.exception("Unable to save DMX template %s", template_path)
        return jsonify({"error": "Unable to save DMX template"}), 500

    return jsonify({"status": "saved"})


@app.route("/api/dmx/preview", methods=["POST", "DELETE"])
def api_dmx_preview() -> Any:
    if request.method == "DELETE":
        dmx_manager.stop_show()
        return jsonify({"status": "stopped"})

    data = request.get_json(force=True, silent=True) or {}
    actions_payload = data.get("actions")
    if not isinstance(actions_payload, list):
        return jsonify({"error": "Missing 'actions' list in request body"}), 400

    start_time = data.get("start_time", 0.0)

    try:
        dmx_manager.start_preview(actions_payload, start_time=start_time)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:  # pragma: no cover - defensive logging
        LOGGER.exception("Unable to start preview mode")
        return jsonify({"error": "Unable to start preview mode"}), 500

    return jsonify({"status": "previewing"})


def main() -> None:
    try:
        controller.start_default_loop()
    except FileNotFoundError:
        LOGGER.error(
            "Video player command not found. Install mpv or set VIDEO_PLAYER_CMD to a valid player."
        )
    app.run(host="0.0.0.0", port=5000)


if __name__ == "__main__":
    main()
