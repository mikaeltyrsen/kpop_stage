import json
import logging
import math
import os
import random
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import uuid
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Set, Tuple, Union

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
from snow import SnowMachineController

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "videos.json"
MEDIA_DIR = BASE_DIR / "media"
DMX_TEMPLATE_DIR = BASE_DIR / "dmx_templates"
DMX_BUILDER_DIR = BASE_DIR / "DMX Template Builder"
CHANNEL_PRESETS_FILE = BASE_DIR / "channel_presets.json"
LIGHT_TEMPLATES_FILE = BASE_DIR / "light_templates.json"
COLOR_PRESETS_FILE = BASE_DIR / "color_presets.json"
RELAY_PRESETS_FILE = BASE_DIR / "relay_presets.json"
WARNING_VIDEO_PATH = MEDIA_DIR / "warning.mp4"
DEFAULT_LOOP_TEMPLATE_PATH = DMX_TEMPLATE_DIR / "default_loop_dmx.json"
SNOW_MACHINE_PRESET_ID = os.environ.get("SNOW_MACHINE_PRESET_ID", "relay_snow_machine")

MEDIA_DIR.mkdir(parents=True, exist_ok=True)
(MEDIA_DIR / "videos").mkdir(parents=True, exist_ok=True)
DMX_TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
DMX_BUILDER_DIR.mkdir(parents=True, exist_ok=True)
LIGHT_TEMPLATES_FILE.parent.mkdir(parents=True, exist_ok=True)
COLOR_PRESETS_FILE.parent.mkdir(parents=True, exist_ok=True)
RELAY_PRESETS_FILE.parent.mkdir(parents=True, exist_ok=True)

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
LOGGER = logging.getLogger("kpop_stage")

SYSTEM_ACTION_LOCK = threading.Lock()
DISABLE_SELF_RESTART = os.environ.get("DISABLE_SELF_RESTART", "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}


class UserRegistry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._users: Dict[str, Dict[str, Any]] = {}

    def register(self, *, is_admin: bool) -> Dict[str, Any]:
        key = uuid.uuid4().hex
        record = {
            "key": key,
            "admin": bool(is_admin),
            "registered_at": time.time(),
        }
        with self._lock:
            self._users[key] = record
        return record

    def get(self, key: Optional[str]) -> Optional[Dict[str, Any]]:
        if not key:
            return None
        with self._lock:
            return self._users.get(key)

    def is_admin(self, key: Optional[str]) -> bool:
        user = self.get(key)
        return bool(user and user.get("admin"))


class PlaybackSession:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._owner_key: Optional[str] = None
        self._video_id: Optional[str] = None
        self._started_at: Optional[float] = None

    def start(self, owner_key: str, video_id: str) -> None:
        with self._lock:
            self._owner_key = owner_key
            self._video_id = video_id
            self._started_at = time.time()

    def clear(self) -> None:
        with self._lock:
            self._owner_key = None
            self._video_id = None
            self._started_at = None

    def owner_key(self) -> Optional[str]:
        with self._lock:
            return self._owner_key

    def video_id(self) -> Optional[str]:
        with self._lock:
            return self._video_id

    def is_owner(self, key: Optional[str]) -> bool:
        if not key:
            return False
        with self._lock:
            return self._owner_key == key

    def has_active(self) -> bool:
        with self._lock:
            return self._owner_key is not None


@dataclass
class QueueEntry:
    id: str
    joined_at: float
    status: str = "waiting"
    activated_at: Optional[float] = None
    expires_at: Optional[float] = None
    user_key: Optional[str] = None
    removed_at: Optional[float] = None


class QueueManager:
    ACTIVE_STATES: Set[str] = {"waiting", "ready", "playing"}
    REMOVED_STATES: Set[str] = {"expired", "finished", "cancelled"}
    ESTIMATED_SECONDS_PER_USER = 180
    SELECTION_TIMEOUT = 30.0

    def __init__(self, registry: UserRegistry) -> None:
        self._lock = threading.Lock()
        self._entries: List[QueueEntry] = []
        self._entries_by_id: Dict[str, QueueEntry] = {}
        self._entry_by_user_key: Dict[str, str] = {}
        self._registry = registry
        self._active_entry_id: Optional[str] = None
        self._access_code = self._generate_code()
        self._admin_playing = False
        LOGGER.info("Access code set to %s", self._access_code)

    def _generate_code(self) -> str:
        return f"{random.randint(0, 99999):05d}"

    def current_code(self) -> str:
        with self._lock:
            return self._access_code

    def rotate_code(self) -> str:
        with self._lock:
            return self._rotate_code_locked()

    def _rotate_code_locked(self) -> str:
        self._access_code = self._generate_code()
        LOGGER.info("Access code set to %s", self._access_code)
        return self._access_code

    def _remove_entry_locked(self, entry: QueueEntry, status: str) -> None:
        if entry in self._entries:
            self._entries.remove(entry)
        entry.status = status
        entry.removed_at = time.time()
        if entry.user_key:
            self._entry_by_user_key.pop(entry.user_key, None)
        if self._active_entry_id == entry.id:
            self._active_entry_id = None

    def _cleanup_locked(self) -> None:
        for entry in list(self._entries):
            if entry.status in self.REMOVED_STATES:
                self._remove_entry_locked(entry, entry.status)

    def _ensure_active_entry_locked(self, now: float, *, is_playing: bool) -> Optional[QueueEntry]:
        self._cleanup_locked()

        if self._active_entry_id:
            active_entry = self._entries_by_id.get(self._active_entry_id)
            if active_entry and active_entry.status in {"ready", "playing"}:
                if (
                    active_entry.status == "ready"
                    and active_entry.expires_at is not None
                    and now >= active_entry.expires_at
                ):
                    self._remove_entry_locked(active_entry, "expired")
                else:
                    return active_entry
            else:
                self._active_entry_id = None

        if is_playing:
            return None

        for entry in self._entries:
            if entry.status == "waiting":
                entry.status = "ready"
                entry.activated_at = now
                entry.expires_at = now + self.SELECTION_TIMEOUT
                if not entry.user_key:
                    record = self._registry.register(is_admin=False)
                    entry.user_key = record["key"]
                    self._entry_by_user_key[entry.user_key] = entry.id
                self._active_entry_id = entry.id
                return entry
        return None

    def register_admin_play_start(self) -> None:
        with self._lock:
            self._admin_playing = True

    def clear_admin_play(self) -> None:
        with self._lock:
            self._admin_playing = False

    def _expire_ready_locked(self, now: float, *, is_playing: bool) -> None:
        if not self._active_entry_id:
            return
        active_entry = self._entries_by_id.get(self._active_entry_id)
        if not active_entry or active_entry.status != "ready":
            return
        if active_entry.expires_at is None:
            return
        if now < active_entry.expires_at:
            return
        self._remove_entry_locked(active_entry, "expired")
        self._ensure_active_entry_locked(now, is_playing=is_playing)

    def join(
        self,
        provided_code: str,
        *,
        existing_id: Optional[str],
        is_playing: bool,
    ) -> Tuple[QueueEntry, bool]:
        now = time.time()
        with self._lock:
            self._expire_ready_locked(now, is_playing=is_playing)
            entry: Optional[QueueEntry] = None
            if existing_id:
                entry = self._entries_by_id.get(existing_id)
                if entry and entry.status in self.ACTIVE_STATES:
                    self._ensure_active_entry_locked(now, is_playing=is_playing)
                    return entry, False

            if not provided_code or provided_code != self._access_code:
                raise ValueError("invalid_code")

            entry_id = uuid.uuid4().hex
            entry = QueueEntry(id=entry_id, joined_at=now)
            self._entries.append(entry)
            self._entries_by_id[entry_id] = entry
            created = True
            self._ensure_active_entry_locked(now, is_playing=is_playing)
            return entry, created

    def leave(self, entry_id: Optional[str]) -> bool:
        if not entry_id:
            return False
        with self._lock:
            entry = self._entries_by_id.get(entry_id)
            if not entry or entry.status not in self.ACTIVE_STATES:
                return False
            self._remove_entry_locked(entry, "cancelled")
            self._ensure_active_entry_locked(time.time(), is_playing=False)
            return True

    def mark_playing(self, user_key: str) -> bool:
        with self._lock:
            entry_id = self._entry_by_user_key.get(user_key)
            if not entry_id:
                return False
            entry = self._entries_by_id.get(entry_id)
            if not entry:
                return False
            if entry.status == "playing":
                return True
            if entry.status != "ready":
                return False
            entry.status = "playing"
            entry.expires_at = None
            entry.activated_at = time.time()
            self._active_entry_id = entry.id
            self._admin_playing = False
            return True

    def finish_active(self) -> None:
        with self._lock:
            now = time.time()
            self._admin_playing = False
            if not self._active_entry_id:
                self._rotate_code_locked()
                self._ensure_active_entry_locked(now, is_playing=False)
                return
            entry = self._entries_by_id.get(self._active_entry_id)
            if entry and entry.status == "playing":
                self._remove_entry_locked(entry, "finished")
            self._active_entry_id = None
            self._rotate_code_locked()
            self._ensure_active_entry_locked(now, is_playing=False)

    def expire_ready_if_needed(self, *, is_playing: bool) -> None:
        now = time.time()
        with self._lock:
            self._expire_ready_locked(now, is_playing=is_playing)

    def _serialize_entry_locked(
        self,
        entry: QueueEntry,
        now: float,
        *,
        active_remaining: Optional[float] = None,
    ) -> Dict[str, Any]:
        info: Dict[str, Any] = {
            "id": entry.id,
            "state": entry.status,
            "joined_at": entry.joined_at,
            "activated_at": entry.activated_at,
        }
        if entry.status in {"ready", "playing"}:
            info["position"] = 0
            if entry.status == "ready" and entry.expires_at is not None:
                info["ready_expires_in"] = max(0.0, entry.expires_at - now)
            if entry.user_key:
                info["user_key"] = entry.user_key
        elif entry.status == "waiting":
            ahead = 1 if self._admin_playing else 0
            waiting_ahead = 0
            for candidate in self._entries:
                if candidate.id == entry.id:
                    break
                if candidate.status in self.ACTIVE_STATES:
                    ahead += 1
                if candidate.status == "waiting":
                    waiting_ahead += 1
            info["position"] = ahead + 1
            info["waiting_position"] = waiting_ahead + 1
            estimated_wait = ahead * self.ESTIMATED_SECONDS_PER_USER
            if (
                ahead > 0
                and active_remaining is not None
                and math.isfinite(active_remaining)
            ):
                remaining = max(0.0, float(active_remaining))
                estimated_wait = remaining + max(0, ahead - 1) * self.ESTIMATED_SECONDS_PER_USER
            info["estimated_wait_seconds"] = estimated_wait
        else:
            info["position"] = None
        return info

    def get_status(
        self,
        entry_id: Optional[str],
        *,
        is_playing: bool,
        active_remaining: Optional[float] = None,
    ) -> Dict[str, Any]:
        now = time.time()
        with self._lock:
            self._expire_ready_locked(now, is_playing=is_playing)
            entry = self._entries_by_id.get(entry_id) if entry_id else None
            payload: Dict[str, Any] = {
                "queue_size": (
                    (1 if self._admin_playing else 0)
                    + sum(1 for e in self._entries if e.status in self.ACTIVE_STATES)
                ),
                "selection_timeout": self.SELECTION_TIMEOUT,
            }
            if entry:
                payload["entry"] = self._serialize_entry_locked(
                    entry,
                    now,
                    active_remaining=active_remaining if is_playing else None,
                )
            else:
                payload["entry"] = None
            return payload

    def entry_for_user_key(self, user_key: Optional[str]) -> Optional[QueueEntry]:
        if not user_key:
            return None
        with self._lock:
            entry_id = self._entry_by_user_key.get(user_key)
            if not entry_id:
                return None
            return self._entries_by_id.get(entry_id)

def _parse_int_env(name: str, default: int, *, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        LOGGER.warning("Invalid integer value '%s' for %s; using %s.", raw, name, default)
        return default
    return max(minimum, min(maximum, value))


def _parse_float_env(name: str, default: float, *, minimum: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except (TypeError, ValueError):
        LOGGER.warning("Invalid float value '%s' for %s; using %s.", raw, name, default)
        return default
    return max(minimum, value)


def _coerce_bool(value: object) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    return None


SMOKE_TRIGGER_LEVEL = _parse_int_env("SMOKE_TRIGGER_LEVEL", 255, minimum=0, maximum=255)
SMOKE_TRIGGER_DURATION = _parse_float_env("SMOKE_TRIGGER_DURATION", 3.0, minimum=0.0)
SNOW_MACHINE_TIMEOUT = _parse_float_env("SNOW_MACHINE_TIMEOUT", 3.0, minimum=0.5)


def _format_command(command: Iterable[str]) -> str:
    return " ".join(shlex.quote(str(part)) for part in command)


def schedule_application_restart(delay: float = 1.0) -> None:
    if DISABLE_SELF_RESTART:
        LOGGER.info("Self-restart requested but DISABLE_SELF_RESTART is set; skipping restart.")
        return

    def _restart() -> None:
        time.sleep(max(0.0, delay))
        python = sys.executable or shutil.which("python3") or shutil.which("python")
        if not python:
            LOGGER.error("Unable to determine Python executable for restart.")
            return
        args = [python, *sys.argv]
        LOGGER.info("Restarting application: %s", _format_command(args))
        try:
            os.execv(python, args)
        except Exception:  # pragma: no cover - restart failure should be rare
            LOGGER.exception("Unable to restart application")

    threading.Thread(target=_restart, daemon=True).start()


def perform_git_update() -> Tuple[bool, str]:
    git_executable = shutil.which("git")
    if not git_executable:
        return False, "Git executable not found."

    command = [git_executable, "pull", "--ff-only"]
    LOGGER.info("Running git update: %s", _format_command(command))
    try:
        result = subprocess.run(
            command,
            cwd=str(BASE_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        output = "".join(filter(None, [exc.stdout, exc.stderr])).strip()
        message = output or "Git pull failed."
        LOGGER.error("Git update failed: %s", message)
        return False, message

    output_lines = [result.stdout.strip(), result.stderr.strip()]
    summary = "\n".join(line for line in output_lines if line)
    if summary:
        LOGGER.info("Git update completed: %s", summary.replace("\n", " "))
    else:
        LOGGER.info("Git update completed: repository already up to date.")
    return True, summary


def build_power_command(mode: str) -> Optional[List[str]]:
    needs_privilege = True
    try:
        needs_privilege = os.geteuid() != 0  # type: ignore[attr-defined]
    except AttributeError:
        needs_privilege = True

    command: Optional[List[str]] = None

    if mode == "restart":
        systemctl_binary = shutil.which("systemctl")
        if systemctl_binary:
            command = [systemctl_binary, "reboot"]
        else:
            reboot_binary = shutil.which("reboot")
            if reboot_binary:
                command = [reboot_binary]
            else:
                shutdown_binary = shutil.which("shutdown")
                if shutdown_binary:
                    command = [shutdown_binary, "-r", "now"]
    else:
        shutdown_binary = shutil.which("shutdown")
        if shutdown_binary:
            command = [shutdown_binary, "-h", "now"]

    if not command:
        return None

    if needs_privilege:
        sudo_binary = shutil.which("sudo")
        if sudo_binary:
            command.insert(0, sudo_binary)

    return command


def schedule_power_command(mode: str, delay: float = 1.0) -> Tuple[bool, str]:
    command = build_power_command(mode)
    if not command:
        return False, "Shutdown command is not available on this system."

    LOGGER.info("Scheduling %s command: %s", mode, _format_command(command))

    def _worker() -> None:
        time.sleep(max(0.0, delay))
        try:
            subprocess.Popen(command)
        except Exception:  # pragma: no cover - depends on system configuration
            LOGGER.exception("Unable to execute %s command", mode)

    threading.Thread(target=_worker, daemon=True).start()
    return True, ""


def _generate_channel_preset_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


CHANNEL_COMPONENT_COLOR_KEYS = {"red", "green", "blue"}
CHANNEL_COMPONENT_TYPE_VALUES = {"color", "slider", "dropdown"}
CHANNEL_COMPONENT_DEFAULT_TYPE = "slider"
CHANNEL_COMPONENT_DEFAULT_NAMES = {
    "red": "Red",
    "green": "Green",
    "blue": "Blue",
    "white": "White",
    "brightness": "Brightness",
}


def _slugify_component(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    return re.sub(r"_{2,}", "_", slug)


COLOR_PRESET_HEX_RE = re.compile(r"^#?[0-9a-fA-F]{6}$")

DEFAULT_MASTER_COLOR = "#ffffff"

DEFAULT_COLOR_PRESETS: List[Dict[str, Any]] = [
    {
        "id": "color_red",
        "name": "Red",
        "iconColor": "#ff3b30",
        "red": 255,
        "green": 0,
        "blue": 0,
    },
    {
        "id": "color_orange",
        "name": "Orange",
        "iconColor": "#ff9500",
        "red": 255,
        "green": 87,
        "blue": 0,
    },
    {
        "id": "color_amber",
        "name": "Amber",
        "iconColor": "#ffcc00",
        "red": 255,
        "green": 170,
        "blue": 0,
    },
    {
        "id": "color_yellow",
        "name": "Yellow",
        "iconColor": "#ffd60a",
        "red": 255,
        "green": 214,
        "blue": 10,
    },
    {
        "id": "color_green",
        "name": "Green",
        "iconColor": "#34c759",
        "red": 0,
        "green": 255,
        "blue": 0,
    },
    {
        "id": "color_teal",
        "name": "Teal",
        "iconColor": "#30d158",
        "red": 0,
        "green": 209,
        "blue": 88,
    },
    {
        "id": "color_cyan",
        "name": "Cyan",
        "iconColor": "#32ade6",
        "red": 0,
        "green": 173,
        "blue": 230,
    },
    {
        "id": "color_blue",
        "name": "Blue",
        "iconColor": "#007aff",
        "red": 0,
        "green": 122,
        "blue": 255,
    },
    {
        "id": "color_purple",
        "name": "Purple",
        "iconColor": "#af52de",
        "red": 175,
        "green": 82,
        "blue": 222,
    },
    {
        "id": "color_pink",
        "name": "Pink",
        "iconColor": "#ff2d55",
        "red": 255,
        "green": 45,
        "blue": 85,
    },
    {
        "id": "color_white",
        "name": "White",
        "iconColor": "#ffffff",
        "red": 255,
        "green": 255,
        "blue": 255,
    },
]


def _normalize_channel_component(value: object) -> str:
    if not isinstance(value, str):
        return ""
    normalized = value.strip()
    if not normalized:
        return ""
    if normalized.lower() == "none":
        return ""
    return _slugify_component(normalized)


def _normalize_channel_component_type(value: object, default: str = "") -> str:
    if isinstance(value, str):
        candidate = value.strip().lower()
        if candidate in CHANNEL_COMPONENT_TYPE_VALUES:
            return candidate
    return default


def _sanitize_component_name(value: object) -> str:
    if isinstance(value, str):
        return value.strip()
    return ""


def _clamp(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


def _normalize_hex_color(value: object, fallback: str = "#ffffff") -> str:
    if not isinstance(value, str):
        return fallback
    candidate = value.strip()
    if COLOR_PRESET_HEX_RE.match(candidate):
        hex_value = candidate[1:] if candidate.startswith("#") else candidate
        return f"#{hex_value.lower()}"
    return fallback


def _auto_detect_channel_component(name: str, group: str) -> str:
    combined = f"{name} {group}".lower()
    for keyword in ("dimmer", "brightness", "intensity"):
        if re.search(rf"\\b{re.escape(keyword)}\\b", combined):
            return "brightness"
    for keyword, component in {"red": "red", "green": "green", "blue": "blue", "white": "white"}.items():
        if re.search(rf"\\b{re.escape(keyword)}\\b", combined):
            return component
    return ""


def _default_component_type(component: str, values: Iterable[Any]) -> str:
    if component in CHANNEL_COMPONENT_COLOR_KEYS:
        return "color"
    if component in {"white", "brightness"}:
        return "slider"
    if any(True for _ in values):
        return "dropdown"
    return CHANNEL_COMPONENT_DEFAULT_TYPE


def _default_component_name(component: str, component_type: str) -> str:
    if component in CHANNEL_COMPONENT_DEFAULT_NAMES:
        return CHANNEL_COMPONENT_DEFAULT_NAMES[component]
    if component:
        words = component.replace("_", " ").split()
        if words:
            return " ".join(word.capitalize() for word in words)
    if component_type == "dropdown":
        return "Mode"
    if component_type == "slider":
        return "Level"
    return ""


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
    group = raw.get("group") if isinstance(raw.get("group"), str) else ""
    component = _normalize_channel_component(raw.get("component"))
    if not component:
        component = _auto_detect_channel_component(name, group)

    try:
        channel_value = int(raw.get("channel", 1))
    except (TypeError, ValueError):
        channel_value = 1
    channel = _clamp(channel_value, 1, 512)
    values_raw = raw.get("values")
    if isinstance(values_raw, list):
        values = [entry for entry in (sanitize_channel_value(item) for item in values_raw) if entry]
    else:
        values = []

    if component:
        component_type = _normalize_channel_component_type(raw.get("componentType"))
        if not component_type:
            component_type = _default_component_type(component, values)
        component_name = _sanitize_component_name(raw.get("componentName"))
        if not component_name:
            component_name = _default_component_name(component, component_type)
    else:
        component_type = ""
        component_name = ""
    return {
        "id": preset_id,
        "name": name,
        "group": group,
        "channel": channel,
        "component": component,
        "componentType": component_type,
        "componentName": component_name,
        "values": values,
    }


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


def sanitize_color_preset(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None

    preset_id = raw.get("id")
    if not isinstance(preset_id, str) or not preset_id:
        preset_id = _generate_channel_preset_id("color")

    name = raw.get("name") if isinstance(raw.get("name"), str) else ""

    red = raw.get("red")
    green = raw.get("green")
    blue = raw.get("blue")

    if isinstance(raw.get("rgb"), dict):
        rgb = raw["rgb"]
        red = rgb.get("r", red)
        green = rgb.get("g", green)
        blue = rgb.get("b", blue)

    try:
        red_value = int(red)
    except (TypeError, ValueError):
        red_value = 255

    try:
        green_value = int(green)
    except (TypeError, ValueError):
        green_value = 255

    try:
        blue_value = int(blue)
    except (TypeError, ValueError):
        blue_value = 255

    fallback_hex = f"#{red_value:02x}{green_value:02x}{blue_value:02x}"
    icon_source = raw.get("iconColor") if isinstance(raw.get("iconColor"), str) else raw.get("color")
    icon_color = _normalize_hex_color(icon_source, fallback_hex)

    return {
        "id": preset_id,
        "name": name,
        "iconColor": icon_color,
        "red": _clamp(red_value, 0, 255),
        "green": _clamp(green_value, 0, 255),
        "blue": _clamp(blue_value, 0, 255),
    }


def load_color_presets_from_disk() -> List[Dict[str, Any]]:
    if not COLOR_PRESETS_FILE.exists():
        return [preset for preset in (sanitize_color_preset(entry) for entry in DEFAULT_COLOR_PRESETS) if preset]

    try:
        with COLOR_PRESETS_FILE.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        LOGGER.exception("Unable to read color presets file")
        return [preset for preset in (sanitize_color_preset(entry) for entry in DEFAULT_COLOR_PRESETS) if preset]

    if isinstance(data, dict):
        raw_presets = data.get("presets", [])
    else:
        raw_presets = data

    if not isinstance(raw_presets, list):
        LOGGER.warning("Color presets file did not contain a list of presets")
        return [preset for preset in (sanitize_color_preset(entry) for entry in DEFAULT_COLOR_PRESETS) if preset]

    sanitized: List[Dict[str, Any]] = []
    for entry in raw_presets:
        preset = sanitize_color_preset(entry)
        if preset:
            sanitized.append(preset)

    if not sanitized:
        return [preset for preset in (sanitize_color_preset(entry) for entry in DEFAULT_COLOR_PRESETS) if preset]
    return sanitized


def save_color_presets_to_disk(presets: Iterable[Dict[str, Any]]) -> None:
    sanitized: List[Dict[str, Any]] = []
    for entry in presets:
        preset = sanitize_color_preset(entry)
        if preset:
            sanitized.append(preset)

    if not sanitized:
        sanitized = [
            preset for preset in (sanitize_color_preset(entry) for entry in DEFAULT_COLOR_PRESETS) if preset
        ]

    try:
        with COLOR_PRESETS_FILE.open("w", encoding="utf-8") as fh:
            json.dump({"presets": sanitized}, fh, indent=2)
    except OSError:
        LOGGER.exception("Unable to write color presets file")
        raise


def sanitize_relay_preset(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None

    preset_id = raw.get("id")
    if not isinstance(preset_id, str) or not preset_id:
        preset_id = f"relay_{uuid.uuid4().hex}"

    name = raw.get("name") if isinstance(raw.get("name"), str) else ""

    commands: List[Dict[str, str]] = []
    raw_commands = raw.get("commands")
    if isinstance(raw_commands, list):
        for entry in raw_commands:
            if not isinstance(entry, dict):
                continue
            command_id = entry.get("id") if isinstance(entry.get("id"), str) else ""
            if not command_id:
                command_id = f"cmd_{uuid.uuid4().hex}"
            label = entry.get("label") if isinstance(entry.get("label"), str) else ""
            url_value = entry.get("url") if isinstance(entry.get("url"), str) else entry.get("value")
            if not isinstance(url_value, str):
                continue
            url_text = url_value.strip()
            if not url_text:
                continue
            commands.append({"id": command_id, "label": label, "url": url_text})
    else:
        for key, default_label in (("on", "On"), ("off", "Off")):
            url_value = raw.get(f"{key}_url")
            if not isinstance(url_value, str):
                url_value = raw.get(key)
            if not isinstance(url_value, str):
                continue
            url_text = url_value.strip()
            if not url_text:
                continue
            commands.append({"id": key, "label": default_label, "url": url_text})

    if not commands:
        return None

    normalized: List[Dict[str, str]] = []
    seen_ids: Set[str] = set()
    for command in commands:
        command_id = command.get("id") or f"cmd_{uuid.uuid4().hex}"
        if command_id in seen_ids:
            command_id = f"cmd_{uuid.uuid4().hex}"
        seen_ids.add(command_id)
        label = command.get("label") or command_id.replace("_", " ").title()
        normalized.append({"id": command_id, "label": label, "url": command["url"]})

    return {"id": preset_id, "name": name, "commands": normalized}


def load_relay_presets_from_disk() -> List[Dict[str, Any]]:
    if not RELAY_PRESETS_FILE.exists():
        return []

    try:
        with RELAY_PRESETS_FILE.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        LOGGER.exception("Unable to read relay presets file")
        return []

    if isinstance(data, dict):
        raw_presets = data.get("presets", [])
    else:
        raw_presets = data

    if not isinstance(raw_presets, list):
        LOGGER.warning("Relay presets file did not contain a list of presets")
        return []

    sanitized: List[Dict[str, Any]] = []
    for entry in raw_presets:
        preset = sanitize_relay_preset(entry)
        if preset:
            sanitized.append(preset)
    return sanitized


def save_relay_presets_to_disk(presets: Iterable[Dict[str, Any]]) -> None:
    items = list(presets)
    sanitized: List[Dict[str, Any]] = []
    for entry in items:
        preset = sanitize_relay_preset(entry)
        if not preset and entry:
            raise ValueError("Relay presets must include valid commands")
        if preset:
            sanitized.append(preset)

    if items and not sanitized:
        raise ValueError("No valid relay presets were provided")

    try:
        with RELAY_PRESETS_FILE.open("w", encoding="utf-8") as fh:
            json.dump({"presets": sanitized}, fh, indent=2)
    except OSError:
        LOGGER.exception("Unable to write relay presets file")
        raise


def _generate_template_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def _determine_row_type(raw: Dict[str, Any]) -> str:
    raw_type = raw.get("type")
    if isinstance(raw_type, str):
        normalized = raw_type.strip().lower()
        if normalized == "delay":
            return "delay"
        if normalized == "action":
            return "action"

    # Heuristic for legacy delay rows that may lack a type but include a duration
    if "duration" in raw and "channel" not in raw:
        return "delay"

    return "action"


def sanitize_template_master_state(raw: Any, channel_master_id: str) -> Optional[Dict[str, Any]]:
    if not channel_master_id:
        return None

    state: Dict[str, Any] = {"id": channel_master_id}
    sliders: Dict[str, int] = {}
    dropdowns: Dict[str, str] = {}

    if isinstance(raw, dict):
        color = raw.get("color")
        if isinstance(color, str) and color.strip():
            state["color"] = _normalize_hex_color(color, DEFAULT_MASTER_COLOR)

        if "brightness" in raw:
            try:
                brightness_value = int(raw.get("brightness", 0))
            except (TypeError, ValueError):
                brightness_value = 0
            clamped = _clamp(brightness_value, 0, 255)
            state["brightness"] = clamped
            sliders["brightness"] = clamped

        if "white" in raw:
            try:
                white_value = int(raw.get("white", 0))
            except (TypeError, ValueError):
                white_value = 0
            clamped = _clamp(white_value, 0, 255)
            state["white"] = clamped
            sliders["white"] = clamped

        sliders_raw = raw.get("sliders")
        if isinstance(sliders_raw, dict):
            for key, value in sliders_raw.items():
                component = _normalize_channel_component(key)
                if not component:
                    continue
                try:
                    numeric_value = int(value)
                except (TypeError, ValueError):
                    continue
                clamped = _clamp(numeric_value, 0, 255)
                sliders[component] = clamped
                if component == "brightness" and "brightness" not in state:
                    state["brightness"] = clamped
                if component == "white" and "white" not in state:
                    state["white"] = clamped

        dropdown_raw = raw.get("dropdownSelections")
        if isinstance(dropdown_raw, dict):
            for key, value in dropdown_raw.items():
                component = _normalize_channel_component(key)
                if not component:
                    continue
                if isinstance(value, str) and value.strip():
                    dropdowns[component] = value.strip()

    if "color" not in state:
        state["color"] = DEFAULT_MASTER_COLOR

    if sliders:
        state["sliders"] = sliders

    if dropdowns:
        state["dropdownSelections"] = dropdowns

    return state


def sanitize_template_row(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None

    row_type = _determine_row_type(raw)

    row_id = raw.get("id")
    if not isinstance(row_id, str) or not row_id:
        row_id = _generate_template_id("row")

    if row_type == "delay":
        try:
            duration_value = float(raw.get("duration", 0))
        except (TypeError, ValueError):
            duration_value = 0.0
        duration = max(0.0, duration_value)
        return {"id": row_id, "type": "delay", "duration": duration}

    try:
        channel_value = int(raw.get("channel", 1))
    except (TypeError, ValueError):
        channel_value = 1
    channel = _clamp(channel_value, 1, 512)

    try:
        value_value = int(raw.get("value", 0))
    except (TypeError, ValueError):
        value_value = 0
    value = _clamp(value_value, 0, 255)

    try:
        fade_value = float(raw.get("fade", 0))
    except (TypeError, ValueError):
        fade_value = 0.0
    fade = max(0.0, fade_value)

    channel_preset_id = raw.get("channelPresetId")
    if not isinstance(channel_preset_id, str) or not channel_preset_id:
        channel_preset_id = None

    value_preset_id = raw.get("valuePresetId")
    if not isinstance(value_preset_id, str) or not value_preset_id:
        value_preset_id = None

    channel_master_id = raw.get("channelMasterId")
    if not isinstance(channel_master_id, str) or not channel_master_id:
        channel_master_id = None
        master_state = None
    else:
        master_state = sanitize_template_master_state(raw.get("master"), channel_master_id)

    return {
        "id": row_id,
        "type": "action",
        "channel": channel,
        "value": value,
        "fade": fade,
        "channelPresetId": channel_preset_id,
        "valuePresetId": value_preset_id,
        "channelMasterId": channel_master_id,
        "master": master_state,
    }


def sanitize_light_template(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None

    template_id = raw.get("id")
    if not isinstance(template_id, str) or not template_id:
        template_id = _generate_template_id("template")

    name = raw.get("name") if isinstance(raw.get("name"), str) else ""

    rows_raw = raw.get("rows")
    if isinstance(rows_raw, list):
        rows_iter = (sanitize_template_row(entry) for entry in rows_raw)
        rows = [row for row in rows_iter if row]
    else:
        rows = []

    return {"id": template_id, "name": name, "rows": rows}


def load_light_templates_from_disk() -> List[Dict[str, Any]]:
    if not LIGHT_TEMPLATES_FILE.exists():
        return []
    try:
        with LIGHT_TEMPLATES_FILE.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        LOGGER.exception("Unable to read light templates file")
        return []

    if isinstance(data, dict):
        raw_templates = data.get("templates", [])
    else:
        raw_templates = data

    if not isinstance(raw_templates, list):
        LOGGER.warning("Light templates file did not contain a list of templates")
        return []

    sanitized: List[Dict[str, Any]] = []
    for entry in raw_templates:
        template = sanitize_light_template(entry)
        if template:
            sanitized.append(template)
    return sanitized


def save_light_templates_to_disk(templates: Iterable[Dict[str, Any]]) -> None:
    sanitized: List[Dict[str, Any]] = []
    for entry in templates:
        template = sanitize_light_template(entry)
        if template:
            sanitized.append(template)

    try:
        with LIGHT_TEMPLATES_FILE.open("w", encoding="utf-8") as fh:
            json.dump({"templates": sanitized}, fh, indent=2)
    except OSError:
        LOGGER.exception("Unable to write light templates file")
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
        warning_video: Optional[Path] = None,
    ) -> None:
        self.default_video = default_video
        self._lock = threading.RLock()
        self._process: Optional[subprocess.Popen[bytes]] = None
        self._current: Optional[Path] = None
        self._ipc_path = str(BASE_DIR / "mpv-ipc.sock")
        self._idle_monitor_thread: Optional[threading.Thread] = None
        self._idle_monitor_stop: Optional[threading.Event] = None
        self._on_video_start = on_video_start
        self._on_default_start = on_default_start
        self._warning_video = warning_video
        self._pending_video_start: Optional[Path] = None
        self._pending_requires_playlist_advance = False
        self._start_callback_fired = False
        self._stage_overlay_active = False
        self._stage_overlay_text: Optional[str] = None
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
            warning_video = self._warning_video
            if warning_video and not warning_video.exists():
                LOGGER.warning("Warning video not found: %s", warning_video)
                warning_video = None
            self._play_video_locked(video_path, loop=False, pre_roll_path=warning_video)

    def stop(self) -> None:
        with self._lock:
            self._start_default_locked()

    def _play_video_locked(
        self, video_path: Path, loop: bool, *, pre_roll_path: Optional[Path] = None
    ) -> None:
        if not self._player_available:
            raise FileNotFoundError(
                "Video player command not found. Install mpv or configure VIDEO_PLAYER_CMD."
            )

        if loop and not video_path.exists():
            raise FileNotFoundError(self._default_missing_message)
        if not video_path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")

        self._ensure_player_running()
        if loop:
            self._clear_pending_video_start()
        else:
            self._pending_video_start = video_path
            self._pending_requires_playlist_advance = bool(pre_roll_path)
            self._start_callback_fired = False
        try:
            if pre_roll_path:
                self._send_ipc_command("loadfile", str(pre_roll_path), "replace")
                self._send_ipc_command("set_property", "loop-file", "no")
                self._send_ipc_command("loadfile", str(video_path), "append-play")
            else:
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

    def _start_default_locked(self) -> None:
        if not self.default_video.exists():
            raise FileNotFoundError(self._default_missing_message)

        self._clear_pending_video_start()

        if (
            self._process
            and self._process.poll() is None
            and self._current == self.default_video
        ):
            return

        self._play_video_locked(self.default_video, loop=True)

    def _clear_pending_video_start(self) -> None:
        self._pending_video_start = None
        self._pending_requires_playlist_advance = False
        self._start_callback_fired = False

    @staticmethod
    def _format_stage_overlay_filter(text: str) -> str:
        escaped_text = text.replace("\\", "\\\\").replace("'", "\\'")
        display_text = f"Stage code: {escaped_text}" if escaped_text else ""
        drawtext = (
            "lavfi=[drawtext=font='DejaVu Sans':fontsize=72:fontcolor=white"
            ":box=1:boxcolor=0x64000000:boxborderw=24:shadowcolor=0xC0000000:shadowx=2:shadowy=2"
            ":x=72:y=h-text_h-120:text='{}']"
        ).format(display_text)
        return f"@stagecode:{drawtext}"

    def set_stage_code_overlay(self, code: Optional[str]) -> None:
        text = (code or "").strip()
        with self._lock:
            if not (self._process and self._process.poll() is None):
                if not text:
                    self._stage_overlay_active = False
                    self._stage_overlay_text = None
                    return
                try:
                    self._ensure_player_running()
                except FileNotFoundError:
                    LOGGER.warning("Unable to enable stage code overlay because the video player is unavailable.")
                    self._stage_overlay_active = False
                    self._stage_overlay_text = None
                    return
                except Exception:
                    LOGGER.exception("Unable to ensure video player is running for stage code overlay")
                    self._stage_overlay_active = False
                    self._stage_overlay_text = None
                    return

            if self._stage_overlay_active or not text:
                try:
                    response = self._send_ipc_command("vf", "del", "@stagecode")
                    if response.get("error") not in {"success", "property unavailable", "no such filter"}:
                        LOGGER.debug("Stage code overlay removal returned %s", response.get("error"))
                except OSError:
                    LOGGER.exception("Unable to communicate with mpv while removing stage code overlay")
                    self._reset_player_state()
                    if not text:
                        return
                except Exception:
                    LOGGER.exception("Unexpected error removing stage code overlay")
                    if not text:
                        return
                finally:
                    self._stage_overlay_active = False
                    self._stage_overlay_text = None

            if not text:
                self._stage_overlay_active = False
                self._stage_overlay_text = None
                return

            try:
                filter_arg = self._format_stage_overlay_filter(text)
                response = self._send_ipc_command("vf", "add", filter_arg)
                if response.get("error") == "success":
                    self._stage_overlay_active = True
                    self._stage_overlay_text = text
                else:
                    LOGGER.warning("Unable to enable stage code overlay: %s", response.get("error"))
                    self._stage_overlay_active = False
                    self._stage_overlay_text = None
            except OSError:
                LOGGER.exception("Unable to communicate with mpv while enabling stage code overlay")
                self._reset_player_state()
                self._stage_overlay_active = False
                self._stage_overlay_text = None
            except Exception:
                LOGGER.exception("Unexpected error enabling stage code overlay")
                self._stage_overlay_active = False
                self._stage_overlay_text = None

    def _maybe_fire_video_start(self, idle: bool) -> None:
        if idle:
            return

        with self._lock:
            pending = self._pending_video_start
            requires_advance = self._pending_requires_playlist_advance
            callback = self._on_video_start
            already_fired = self._start_callback_fired

        if already_fired or pending is None or callback is None:
            return

        if requires_advance:
            try:
                response = self._send_ipc_command("get_property", "playlist-pos")
            except OSError:
                return
            if response.get("error") != "success":
                return
            try:
                position = int(response.get("data"))
            except (TypeError, ValueError):
                return
            if position <= 0:
                return

        with self._lock:
            if self._start_callback_fired:
                return
            pending = self._pending_video_start
            callback = self._on_video_start
            if pending is None or callback is None:
                return
            self._pending_video_start = None
            self._pending_requires_playlist_advance = False
            self._start_callback_fired = True

        try:
            callback(pending)
        except Exception:  # pragma: no cover - defensive logging
            LOGGER.exception("Video start callback failed")

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

            self._maybe_fire_video_start(idle)

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
user_registry = UserRegistry()
playback_session = PlaybackSession()
queue_manager = QueueManager(user_registry)

snow_machine_controller = SnowMachineController(
    load_relay_presets_from_disk,
    preset_id=SNOW_MACHINE_PRESET_ID,
    request_timeout=SNOW_MACHINE_TIMEOUT,
)
dmx_manager.set_relay_action_callback(snow_machine_controller.handle_relay_action)


def _handle_default_start(_: Path) -> None:
    playback_session.clear()
    queue_manager.finish_active()
    try:
        controller.set_stage_code_overlay(queue_manager.current_code())
    except Exception:
        LOGGER.exception("Unable to update stage code overlay for default loop")
    default_entry = get_video_entry_by_path(DEFAULT_VIDEO_PATH)
    if default_entry:
        try:
            dmx_manager.start_show_for_video(default_entry)
            if dmx_manager.has_active_show():
                return
            LOGGER.info(
                "Default loop video DMX template had no actions; using default loop template instead."
            )
        except Exception:
            LOGGER.exception("Unable to start DMX show for default loop video")
    dmx_manager.start_default_show(DEFAULT_LOOP_TEMPLATE_PATH)


def _handle_video_start(video_path: Path) -> None:
    try:
        controller.set_stage_code_overlay(None)
    except Exception:
        LOGGER.exception("Unable to clear stage code overlay for video playback")
    video_entry = get_video_entry_by_path(video_path)
    if not video_entry:
        LOGGER.warning("Unable to locate video entry for %s", video_path)
        return
    try:
        dmx_manager.start_show_for_video(video_entry)
    except Exception:
        LOGGER.exception(
            "Unable to start DMX show for video %s", video_entry.get("name", video_entry.get("id"))
        )


controller = PlaybackController(
    DEFAULT_VIDEO_PATH,
    on_video_start=_handle_video_start,
    on_default_start=_handle_default_start,
    warning_video=WARNING_VIDEO_PATH,
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


def _parse_admin_flag(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _calculate_remaining_playback_seconds(duration: Any, position: Any) -> Optional[float]:
    try:
        duration_value = float(duration)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(duration_value) or duration_value <= 0:
        return None

    try:
        position_value = float(position)
    except (TypeError, ValueError):
        position_value = 0.0
    if not math.isfinite(position_value):
        position_value = 0.0

    return max(0.0, duration_value - max(0.0, position_value))


def _queue_playback_context() -> Tuple[bool, Optional[float]]:
    try:
        state = controller.query_state()
    except Exception:
        LOGGER.exception("Unable to query playback state for queue context")
        state = None

    is_playing = playback_session.has_active()
    remaining: Optional[float] = None

    if isinstance(state, dict):
        default_flag = state.get("is_default")
        if default_flag is not None:
            is_playing = not bool(default_flag)

        if is_playing:
            remaining = _calculate_remaining_playback_seconds(
                state.get("duration"),
                state.get("position"),
            )

    return is_playing, remaining


def _request_queue_id(data: Optional[Dict[str, Any]] = None) -> Optional[str]:
    if data:
        entry_value = data.get("entry_id")
        if isinstance(entry_value, str) and entry_value.strip():
            return entry_value.strip()
    cookie_value = request.cookies.get("queue_id")
    if cookie_value:
        return cookie_value
    arg_value = request.args.get("entry_id")
    if arg_value:
        return arg_value
    return None


@app.route("/api/register", methods=["POST"])
def api_register() -> Any:
    data = request.get_json(force=True, silent=True) or {}
    record = user_registry.register(is_admin=_parse_admin_flag(data.get("admin")))
    return jsonify({"status": "ok", "key": record["key"], "admin": record["admin"]})


@app.route("/api/queue/join", methods=["POST"])
def api_queue_join() -> Any:
    data = request.get_json(force=True, silent=True) or {}
    provided_code = str(data.get("code") or "").strip()
    entry_id = _request_queue_id(data)
    is_playing, remaining = _queue_playback_context()

    try:
        entry, created = queue_manager.join(
            provided_code,
            existing_id=entry_id,
            is_playing=is_playing,
        )
    except ValueError:
        return jsonify({"error": "Invalid access code"}), 403

    status_payload = queue_manager.get_status(
        entry.id,
        is_playing=is_playing,
        active_remaining=remaining,
    )
    response_payload = {"status": "joined", "created": created, **status_payload}
    response = jsonify(response_payload)
    response.set_cookie(
        "queue_id",
        entry.id,
        max_age=6 * 60 * 60,
        samesite="Strict",
        httponly=True,
        secure=False,
        path="/",
    )
    return response


@app.route("/api/queue/status")
def api_queue_status() -> Any:
    entry_id = _request_queue_id()
    is_playing, remaining = _queue_playback_context()
    status_payload = queue_manager.get_status(
        entry_id,
        is_playing=is_playing,
        active_remaining=remaining,
    )
    response = jsonify(status_payload)
    if entry_id and not status_payload.get("entry"):
        response.delete_cookie("queue_id")
    return response


@app.route("/api/queue/leave", methods=["POST"])
def api_queue_leave() -> Any:
    data = request.get_json(force=True, silent=True) or {}
    entry_id = _request_queue_id(data)
    removed = queue_manager.leave(entry_id)
    response = jsonify({"status": "left" if removed else "not_found"})
    response.delete_cookie("queue_id")
    return response


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


@app.route("/api/color-presets", methods=["GET"])
def api_get_color_presets() -> Any:
    presets = load_color_presets_from_disk()
    return jsonify({"presets": presets})


@app.route("/api/color-presets", methods=["PUT"])
def api_put_color_presets() -> Any:
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
        save_color_presets_to_disk(raw_presets)
    except OSError:
        return jsonify({"error": "Unable to save color presets"}), 500

    presets = load_color_presets_from_disk()
    return jsonify({"presets": presets})


@app.route("/api/relay-presets", methods=["GET"])
def api_get_relay_presets() -> Any:
    presets = load_relay_presets_from_disk()
    return jsonify({"presets": presets})


@app.route("/api/relay-presets", methods=["PUT"])
def api_put_relay_presets() -> Any:
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
        save_relay_presets_to_disk(raw_presets)
    except ValueError as exc:
        return jsonify({"error": str(exc) or "Invalid relay presets"}), 400
    except OSError:
        return jsonify({"error": "Unable to save relay presets"}), 500

    snow_machine_controller.reload()

    presets = load_relay_presets_from_disk()
    return jsonify({"presets": presets})


@app.route("/api/light-templates", methods=["GET"])
def api_get_light_templates() -> Any:
    templates = load_light_templates_from_disk()
    return jsonify({"templates": templates})


@app.route("/api/light-templates", methods=["PUT"])
def api_put_light_templates() -> Any:
    data = request.get_json(silent=True)  # type: ignore[no-untyped-call]
    if data is None:
        return jsonify({"error": "Request body must be JSON"}), 400

    if isinstance(data, list):
        raw_templates = data
    else:
        raw_templates = data.get("templates")

    if not isinstance(raw_templates, list):
        return jsonify({"error": "Request must include a list of templates"}), 400

    try:
        save_light_templates_to_disk(raw_templates)
    except OSError:
        return jsonify({"error": "Unable to save light templates"}), 500

    templates = load_light_templates_from_disk()
    return jsonify({"templates": templates})


@app.route("/api/system/update", methods=["POST"])
def api_system_update() -> Any:
    with SYSTEM_ACTION_LOCK:
        success, details = perform_git_update()
        if not success:
            return jsonify({"error": details or "Unable to update the application."}), 500
        schedule_application_restart(delay=1.0)

    response: Dict[str, Any] = {
        "status": "scheduled",
        "message": "Update applied. Restarting application.",
    }
    if details:
        response["details"] = details
    return jsonify(response)


@app.route("/api/system/restart", methods=["POST"])
def api_system_restart() -> Any:
    success, error_message = schedule_power_command("restart", delay=1.0)
    if not success:
        LOGGER.error("System restart request failed: %s", error_message)
        return jsonify({"error": error_message or "Unable to restart the system."}), 500
    return jsonify(
        {
            "status": "scheduled",
            "message": "Restart command sent. The Raspberry Pi will reboot shortly.",
        }
    )


@app.route("/api/system/shutdown", methods=["POST"])
def api_system_shutdown() -> Any:
    success, error_message = schedule_power_command("shutdown", delay=1.0)
    if not success:
        LOGGER.error("System shutdown request failed: %s", error_message)
        return jsonify({"error": error_message or "Unable to shut down the system."}), 500
    return jsonify(
        {
            "status": "scheduled",
            "message": "Shutdown command sent. The Raspberry Pi will power off shortly.",
        }
    )


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

    key = data.get("key")
    user = user_registry.get(key)
    if not user:
        return jsonify({"error": "Unknown user key"}), 403

    is_admin = bool(user.get("admin"))

    queue_manager.expire_ready_if_needed(
        is_playing=playback_session.has_active()
    )

    queue_entry = None

    if not is_admin:
        queue_entry = queue_manager.entry_for_user_key(key)
        if not queue_entry or queue_entry.status != "ready":
            return jsonify({"error": "It's not your turn yet"}), 403

        owner_key = playback_session.owner_key()
        if owner_key and owner_key != key:
            return jsonify({"error": "Playback already in progress"}), 409

        is_default = True
        try:
            state = controller.query_state()
        except Exception:
            LOGGER.exception("Unable to query playback state while validating play request")
            state = None
        if isinstance(state, dict):
            default_flag = state.get("is_default")
            if default_flag is not None:
                is_default = bool(default_flag)
        if playback_session.has_active() or not is_default:
            return jsonify({"error": "Playback already in progress"}), 409

    video_entry = get_video_entry(video_id)
    if not video_entry:
        return jsonify({"error": "Unknown video id"}), 404

    video_path = resolve_media_path(video_entry["file"])
    if not video_path.exists():
        return jsonify({"error": "Video file not found on server"}), 404

    try:
        dmx_manager.fade_all_to_value(0, 1.5)
    except Exception:
        LOGGER.exception("Unable to fade lights before playback")

    try:
        controller.play(video_path)
    except FileNotFoundError:
        LOGGER.error('Video player command not found. Install mpv or set VIDEO_PLAYER_CMD.')
        return jsonify({"error": "Video player not available on server"}), 500
    except Exception:
        LOGGER.exception('Unable to start playback')
        return jsonify({"error": "Unable to start playback"}), 500

    if not is_admin:
        if not queue_manager.mark_playing(key):
            LOGGER.warning("Queue session for key %s expired before playback started", key)
            try:
                controller.stop()
            except Exception:
                LOGGER.exception("Unable to stop playback after queue session expired")
            return jsonify({"error": "Queue session expired"}), 403
    else:
        queue_manager.register_admin_play_start()

    playback_session.start(key, video_id)

    return jsonify({"status": "playing", "id": video_id})


@app.route("/api/stop", methods=["POST"])
def api_stop() -> Any:
    data = request.get_json(force=True, silent=True) or {}
    key = data.get("key") or request.args.get("key")
    user = user_registry.get(key)
    if not user:
        return jsonify({"error": "Unknown user key"}), 403

    is_admin = bool(user.get("admin"))
    owner_key = playback_session.owner_key()

    if not is_admin:
        if owner_key and owner_key != key:
            return jsonify({"error": "Only the user who started playback may stop it"}), 403
        if not owner_key:
            is_default = True
            try:
                state = controller.query_state()
            except Exception:
                LOGGER.exception("Unable to query playback state while validating stop request")
                state = None
            if isinstance(state, dict):
                default_flag = state.get("is_default")
                if default_flag is not None:
                    is_default = bool(default_flag)
            if not is_default:
                return jsonify({"error": "Playback is controlled by another user"}), 403

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
    playback_session.clear()
    queue_manager.clear_admin_play()

    return jsonify({"status": "default_loop"})


@app.route("/api/status")
def api_status() -> Any:
    request_key = request.args.get("key")
    user = user_registry.get(request_key)
    is_admin = bool(user.get("admin")) if user else False

    state = controller.query_state()
    if not isinstance(state, dict):
        state = {}
    mode = "default_loop" if state.get("is_default") else "video"

    queue_manager.expire_ready_if_needed(is_playing=(mode == "video"))

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

    payload["smoke_active"] = dmx_manager.is_smoke_active()
    payload["smoke_available"] = dmx_manager.is_smoke_available()
    payload["snow_machine_active"] = snow_machine_controller.is_active()
    payload["snow_machine_available"] = snow_machine_controller.is_available()

    if mode != "video":
        playback_session.clear()

    owner_key = playback_session.owner_key()
    is_owner = playback_session.is_owner(request_key)
    payload["controls"] = {
        "can_stop": mode == "video" and (is_owner or is_admin),
        "is_admin": is_admin,
        "is_owner": is_owner,
        "can_play": bool(is_admin or mode != "video"),
        "has_active_owner": bool(owner_key),
    }

    return jsonify(payload)


@app.route("/api/volume", methods=["POST"])
def api_volume() -> Any:
    data = request.get_json(force=True, silent=True) or {}
    if "volume" not in data:
        return jsonify({"error": "Missing 'volume' in request body"}), 400

    key = data.get("key")
    user = user_registry.get(key)
    if not user:
        return jsonify({"error": "Unknown user key"}), 403
    if not user.get("admin"):
        return jsonify({"error": "Only admins may adjust volume"}), 403

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


@app.route("/api/dmx/smoke", methods=["POST"])
def api_dmx_smoke() -> Any:
    data = request.get_json(force=True, silent=True) or {}
    key = data.get("key") or request.args.get("key")
    user = user_registry.get(key)
    if not user:
        return jsonify({"error": "Unknown user key"}), 403
    if not user.get("admin"):
        return jsonify({"error": "Only admins may trigger smoke"}), 403

    if not dmx_manager.is_smoke_available():
        return jsonify({"error": "Smoke channel is not configured on the server."}), 400

    try:
        duration = dmx_manager.trigger_smoke(
            level=SMOKE_TRIGGER_LEVEL,
            duration=SMOKE_TRIGGER_DURATION,
        )
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        LOGGER.exception("Unable to trigger smoke effect")
        return jsonify({"error": "Unable to trigger smoke effect"}), 500

    return jsonify({"status": "triggered", "duration": duration, "active": duration > 0})


@app.route("/api/relay/snow-machine", methods=["POST"])
def api_relay_snow_machine() -> Any:
    if not snow_machine_controller.is_available():
        return jsonify({"error": "Snow machine relay is not configured on the server."}), 400

    data = request.get_json(force=True, silent=True) or {}
    key = data.get("key") or request.args.get("key")
    user = user_registry.get(key)
    if not user:
        return jsonify({"error": "Unknown user key"}), 403
    if not user.get("admin"):
        return jsonify({"error": "Only admins may control the snow machine"}), 403

    desired_raw = data.get("active")
    desired_state: Optional[bool]
    if desired_raw is None:
        desired_state = None
    else:
        desired_state = _coerce_bool(desired_raw)
        if desired_state is None:
            return jsonify({"error": "Invalid 'active' value; expected true/false."}), 400

    try:
        if desired_state is None:
            new_state = snow_machine_controller.toggle()
        else:
            new_state = snow_machine_controller.set_active(desired_state)
    except RuntimeError as exc:
        message = str(exc) or "Unable to control snow machine"
        return jsonify({"error": message}), 500

    status_text = "on" if new_state else "off"
    message = f"Snow machine turned {status_text}"
    return jsonify({"status": status_text, "active": new_state, "message": message})


@app.route("/api/dmx/templates/<video_id>", methods=["GET", "POST"])
def api_dmx_template(video_id: str) -> Any:
    video_entry = get_video_entry(video_id)
    if not video_entry:
        return jsonify({"error": "Unknown video id"}), 404

    template_path = dmx_manager.template_path_for_video(video_entry)

    if request.method == "GET":
        try:
            actions = dmx_manager.load_show_for_video(video_entry)
            relay_actions = dmx_manager.load_relay_actions_for_video(video_entry)
        except RuntimeError as exc:
            return jsonify({"error": str(exc)}), 500

        stored_actions: List[Dict[str, Any]] = []
        stored_relay_actions: List[Dict[str, Any]] = []
        if template_path.exists():
            try:
                with template_path.open("r", encoding="utf-8") as fh:
                    payload = json.load(fh)
            except (OSError, json.JSONDecodeError):
                LOGGER.exception("Unable to read DMX template %s", template_path)
            else:
                raw_actions = payload.get("actions") if isinstance(payload, dict) else None
                if isinstance(raw_actions, list):
                    stored_actions = raw_actions
                raw_relay = payload.get("relay_actions") if isinstance(payload, dict) else None
                if isinstance(raw_relay, list):
                    stored_relay_actions = raw_relay

        try:
            relative_path = template_path.relative_to(BASE_DIR)
            template_str = str(relative_path)
        except ValueError:
            template_str = str(template_path)

        if not stored_actions:
            stored_actions = dmx_manager.serialize_actions(actions)

        if not stored_relay_actions:
            stored_relay_actions = dmx_manager.serialize_relay_actions(relay_actions)

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
            "actions": stored_actions,
            "relay_actions": stored_relay_actions,
        }
        return jsonify(response)

    data = request.get_json(force=True, silent=True) or {}
    actions_payload = data.get("actions")
    if not isinstance(actions_payload, list):
        return jsonify({"error": "Request body must include an 'actions' list"}), 400

    relay_payload = data.get("relay_actions")
    if relay_payload is None:
        relay_payload = []
    if not isinstance(relay_payload, list):
        return jsonify({"error": "Relay actions must be provided as a list"}), 400

    try:
        dmx_manager.save_template(template_path, actions=actions_payload, relay_actions=relay_payload)
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
    paused_raw = data.get("paused", False)
    paused = bool(paused_raw) if isinstance(paused_raw, bool) else False

    template_preview = bool(data.get("template_preview"))

    try:
        dmx_manager.start_preview(
            actions_payload,
            start_time=start_time,
            paused=paused,
            template_preview=template_preview,
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:  # pragma: no cover - defensive logging
        LOGGER.exception("Unable to start preview mode")
        return jsonify({"error": "Unable to start preview mode"}), 500

    return jsonify({"status": "previewing"})


def main() -> None:
    default_loop_started = False

    try:
        controller.start_default_loop()
        default_loop_started = True
    except FileNotFoundError as exc:
        LOGGER.error("%s", exc)
    except Exception:
        LOGGER.exception("Unable to start default video loop")

    if not default_loop_started:
        try:
            dmx_manager.start_default_show(DEFAULT_LOOP_TEMPLATE_PATH)
        except Exception:
            LOGGER.exception("Unable to start default DMX template")

    LOGGER.info("Starting HTTP server. HTTPS support is disabled.")

    app.run(host="0.0.0.0", port=8050)


if __name__ == "__main__":
    main()
