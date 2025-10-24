"""Helpers for controlling a simple on/off snow machine relay."""

from __future__ import annotations

import logging
import threading
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable, Dict, Iterable, Optional

from dmx import RelayAction

LOGGER = logging.getLogger("kpop_stage.snow")


@dataclass
class SnowCommand:
    """Represents a single relay command for the snow machine."""

    command_id: str
    label: str
    url: str

    @staticmethod
    def from_dict(raw: Dict[str, object]) -> Optional["SnowCommand"]:
        if not isinstance(raw, dict):
            return None

        url_value = raw.get("url")
        if not isinstance(url_value, str) or not url_value.strip():
            return None
        url = url_value.strip()

        command_id_raw = raw.get("id")
        command_id = command_id_raw.strip() if isinstance(command_id_raw, str) else ""
        label_raw = raw.get("label")
        label = label_raw.strip() if isinstance(label_raw, str) else ""

        return SnowCommand(command_id=command_id, label=label, url=url)

    def matches(self, action: RelayAction) -> bool:
        """Return True if the relay action represents this command."""

        if not isinstance(action, RelayAction):
            return False

        url = action.url.strip()
        if url and url == self.url:
            return True

        command_id = action.command_id.strip().lower()
        if self.command_id and command_id and command_id == self.command_id.lower():
            return True

        label = action.label.strip().lower()
        if self.label and label and label == self.label.lower():
            return True

        return False


class SnowMachineController:
    """Loads snow machine relay presets and exposes simple on/off controls."""

    def __init__(
        self,
        preset_loader: Callable[[], Iterable[Dict[str, object]]],
        *,
        preset_id: str,
        request_timeout: float = 3.0,
    ) -> None:
        self._preset_loader = preset_loader
        self._preset_id = preset_id
        self._request_timeout = max(0.5, float(request_timeout))
        self._lock = threading.Lock()
        self._active = False
        self._available = False
        self._on_command: Optional[SnowCommand] = None
        self._off_command: Optional[SnowCommand] = None
        self.reload()

    def reload(self) -> None:
        """Reload commands from relay presets on disk."""

        try:
            presets = list(self._preset_loader())
        except Exception:  # pragma: no cover - defensive logging
            LOGGER.exception("Unable to load relay presets for snow machine")
            presets = []

        preset = self._find_preset(presets)

        on_command: Optional[SnowCommand] = None
        off_command: Optional[SnowCommand] = None

        if preset:
            commands = preset.get("commands") if isinstance(preset, dict) else None
            command_list = commands if isinstance(commands, list) else []
            for entry in command_list:
                command = SnowCommand.from_dict(entry)
                if not command:
                    continue
                if self._looks_like_on_command(command) and on_command is None:
                    on_command = command
                elif self._looks_like_off_command(command) and off_command is None:
                    off_command = command
                elif on_command is None:
                    on_command = command
                elif off_command is None:
                    off_command = command

        with self._lock:
            self._on_command = on_command
            self._off_command = off_command
            self._available = bool(on_command or off_command)
            if not self._available:
                self._active = False

    def is_available(self) -> bool:
        with self._lock:
            return self._available

    def is_active(self) -> bool:
        with self._lock:
            return self._active

    def handle_relay_action(self, action: RelayAction) -> None:
        """Update internal state when a relay action is executed."""

        if not self.is_available():
            return

        if not isinstance(action, RelayAction):
            return

        preset_id = action.preset_id.strip().lower()
        expected_id = self._preset_id.strip().lower()
        relevant = False
        if preset_id and expected_id and preset_id == expected_id:
            relevant = True
        else:
            # Fall back to URL/label matching when preset metadata is missing.
            relevant = any(
                command and command.matches(action)
                for command in (self._on_command, self._off_command)
            )

        if not relevant:
            return

        if self._on_command and self._on_command.matches(action):
            with self._lock:
                self._active = True
            return

        if self._off_command and self._off_command.matches(action):
            with self._lock:
                self._active = False

    def set_active(self, desired: bool) -> bool:
        """Set the snow machine state via its configured relay commands."""

        command = self._on_command if desired else self._off_command
        if command is None:
            raise RuntimeError("Snow machine command is not configured")

        request = urllib.request.Request(command.url)
        try:
            with urllib.request.urlopen(request, timeout=self._request_timeout) as response:
                response.read(1)
        except urllib.error.URLError as exc:
            state = "on" if desired else "off"
            raise RuntimeError(f"Unable to turn snow machine {state}") from exc
        except Exception as exc:  # pragma: no cover - defensive logging
            state = "on" if desired else "off"
            raise RuntimeError(f"Unable to turn snow machine {state}") from exc

        with self._lock:
            self._active = desired

        return desired

    def toggle(self) -> bool:
        """Toggle the snow machine on/off based on the current state."""

        return self.set_active(not self.is_active())

    def _find_preset(self, presets: Iterable[Dict[str, object]]) -> Optional[Dict[str, object]]:
        preset_id = self._preset_id.strip().lower()
        for entry in presets:
            if not isinstance(entry, dict):
                continue
            entry_id = str(entry.get("id") or "").strip().lower()
            if preset_id and entry_id == preset_id:
                return entry
        for entry in presets:
            if not isinstance(entry, dict):
                continue
            name = str(entry.get("name") or "").strip().lower()
            if name == "snow machine":
                return entry
        return None

    @staticmethod
    def _looks_like_on_command(command: SnowCommand) -> bool:
        key = command.command_id.lower() if command.command_id else ""
        label = command.label.lower() if command.label else ""
        return key == "on" or label == "on"

    @staticmethod
    def _looks_like_off_command(command: SnowCommand) -> bool:
        key = command.command_id.lower() if command.command_id else ""
        label = command.label.lower() if command.label else ""
        return key == "off" or label == "off"
