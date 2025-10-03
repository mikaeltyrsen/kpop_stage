"""DMX control helpers for orchestrating lighting cues.

This module provides a small abstraction around python-ola (if installed) so
that DMX data can be sent to a USB or network DMX interface from the
application.  When the OLA client library is not available the implementation
falls back to a no-op sender that simply logs the values that would be
transmitted.  This keeps the application usable on development machines that do
not have access to DMX hardware while still providing real output on the
Raspberry Pi when OLA is installed.
"""
from __future__ import annotations

import array
import atexit
import json
import logging
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, cast

LOGGER = logging.getLogger("kpop_stage.dmx")

try:  # pragma: no-cover - optional dependency
    from ola.ClientWrapper import ClientWrapper  # type: ignore
except ImportError:  # pragma: no-cover - optional dependency
    ClientWrapper = None  # type: ignore

try:  # pragma: no-cover - optional dependency
    import serial  # type: ignore
except ImportError:  # pragma: no-cover - optional dependency
    serial = None  # type: ignore


DEFAULT_CHANNELS = 512
DMX_FPS = 30.0
DMX_BREAK_DURATION = float(os.environ.get("DMX_BREAK_DURATION", "0.00012"))
DMX_MARK_AFTER_BREAK = float(os.environ.get("DMX_MARK_AFTER_BREAK", "0.000012"))


def _clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def _resolve_serial_port() -> Optional[str]:
    """Resolve the DMX serial port from environment configuration."""

    configured_port = os.environ.get("DMX_SERIAL_PORT")
    if configured_port:
        return configured_port

    serial_identifier = os.environ.get("DMX_SERIAL_NUMBER")
    if not serial_identifier:
        return None

    if serial is None:  # pragma: no cover - depends on optional dependency
        LOGGER.error(
            "DMX_SERIAL_NUMBER is set to %s but pyserial is not installed. "
            "Install pyserial or provide DMX_SERIAL_PORT to use direct DMX output.",
            serial_identifier,
        )
        return None

    try:  # pragma: no cover - optional dependency
        from serial.tools import list_ports  # type: ignore
    except Exception:  # pragma: no cover - defensive
        LOGGER.exception(
            "Unable to import serial.tools.list_ports to resolve DMX interface %s",
            serial_identifier,
        )
        return None

    identifier_normalized = serial_identifier.strip().lower()
    if not identifier_normalized:
        return None

    matches: List[str] = []
    for port in list_ports.comports():
        candidates = [
            getattr(port, "serial_number", None),
            getattr(port, "hwid", None),
            getattr(port, "description", None),
            getattr(port, "device", None),
        ]
        for candidate in candidates:
            if not candidate:
                continue
            if identifier_normalized in str(candidate).strip().lower():
                device = str(getattr(port, "device", ""))
                if device:
                    matches.append(device)
                break

    if not matches:
        LOGGER.error(
            "Unable to locate DMX serial interface matching identifier '%s'",
            serial_identifier,
        )
        return None

    if len(matches) > 1:
        LOGGER.warning(
            "Multiple DMX serial interfaces matched identifier '%s'. Using %s.",
            serial_identifier,
            matches[0],
        )

    resolved_port = matches[0]
    if resolved_port:
        LOGGER.info(
            "Resolved DMX serial interface %s using identifier '%s'",
            resolved_port,
            serial_identifier,
        )
    return resolved_port


def _parse_timecode(value: str) -> float:
    """Convert a timecode (HH:MM:SS[.mmm]) string into seconds."""
    if not value:
        raise ValueError("Missing timecode value")

    parts = value.strip().split(":")
    if len(parts) != 3:
        raise ValueError(f"Invalid timecode '{value}'. Expected HH:MM:SS format.")

    hours, minutes, seconds = parts
    try:
        hours_i = int(hours)
        minutes_i = int(minutes)
        seconds_f = float(seconds)
    except ValueError as exc:
        raise ValueError(f"Invalid timecode '{value}'.") from exc

    if minutes_i < 0 or minutes_i >= 60:
        raise ValueError(f"Invalid minutes in timecode '{value}'.")
    if seconds_f < 0 or seconds_f >= 60:
        raise ValueError(f"Invalid seconds in timecode '{value}'.")

    return hours_i * 3600.0 + minutes_i * 60.0 + seconds_f


def parse_timecode(value: str) -> float:
    """Wrapper that converts errors into ValueError with context."""
    try:
        return _parse_timecode(value)
    except ValueError as exc:
        raise ValueError(f"Unable to parse timecode '{value}': {exc}") from exc


@dataclass
class DMXAction:
    time_seconds: float
    channel: int
    value: int
    fade: float

    @classmethod
    def from_dict(cls, data: Dict[str, object]) -> "DMXAction":
        if "time" not in data:
            raise ValueError("Action is missing required 'time' field")
        if "channel" not in data:
            raise ValueError("Action is missing required 'channel' field")
        if "value" not in data:
            raise ValueError("Action is missing required 'value' field")

        time_seconds = parse_timecode(str(data["time"]))
        channel = int(data["channel"])
        value = int(data["value"])
        fade = float(data.get("fade", 0.0))

        if channel < 1 or channel > DEFAULT_CHANNELS:
            raise ValueError("DMX channel must be between 1 and 512")
        if value < 0 or value > 255:
            raise ValueError("DMX value must be between 0 and 255")
        if fade < 0:
            raise ValueError("Fade duration must be zero or positive")

        return cls(time_seconds=time_seconds, channel=channel, value=value, fade=fade)


class DMXOutput:
    """Continuously pushes the latest DMX universe state to the hardware."""

    def __init__(self, universe: int = 0, channel_count: int = DEFAULT_CHANNELS) -> None:
        self.universe = universe
        self.channel_count = channel_count
        self._levels = [0] * self.channel_count
        self._lock = threading.Lock()
        self._dirty = False
        self._stop_event = threading.Event()
        self._sender, self._sender_cleanup = self._build_sender(universe)
        self._thread = threading.Thread(target=self._run_sender, daemon=True)
        self._thread.start()
        atexit.register(self.shutdown)

    def _build_sender(
        self, universe: int
    ) -> tuple[Callable[[bytearray], None], Optional[Callable[[], None]]]:
        serial_port = _resolve_serial_port()
        if serial_port:
            try:
                sender = self._build_serial_sender(serial_port)
            except Exception:  # pragma: no cover - depends on hardware
                LOGGER.exception(
                    "Unable to initialise DMX serial port %s. Falling back to OLA/dry-run output.",
                    serial_port,
                )
            else:
                if sender:
                    return sender

        if ClientWrapper is None:
            LOGGER.warning(
                "python-ola not available. DMX output will run in dry-run mode. "
                "Install OLA on the Raspberry Pi to control real fixtures."
            )

            def log_sender(data: bytearray) -> None:
                LOGGER.debug("DMX dry-run universe %s: %s", universe, list(data[:16]))

            return log_sender, None

        thread_local = threading.local()

        def _get_thread_resources() -> tuple[Any, Any, threading.Lock]:
            resources = getattr(thread_local, "resources", None)
            if resources is None:
                wrapper = ClientWrapper()
                client = wrapper.Client()
                lock = threading.Lock()
                resources = (wrapper, client, lock)
                thread_local.resources = resources
            return cast(tuple[Any, Any, threading.Lock], resources)

        def send(data: bytearray) -> None:
            wrapper, client, lock = _get_thread_resources()
            done = threading.Event()

            def _callback(status: bool) -> None:  # pragma: no cover - depends on hardware
                if not status:
                    LOGGER.error("Failed to send DMX frame via OLA")
                done.set()
                wrapper.Stop()

            with lock:
                # python-ola expects an ``array('B')`` or similar object that
                # provides a ``tobytes`` method.  ``bytearray`` does not, so we
                # wrap the data to match the library expectations before
                # sending.
                payload = array.array("B", data)
                client.SendDmx(universe, payload, _callback)
                wrapper.Run()  # Blocks until wrapper.Stop() called in callback
            if not done.wait(timeout=1.0):
                LOGGER.warning("Timed out waiting for DMX send confirmation")

        return send, None

    def _build_serial_sender(
        self, port: str
    ) -> Optional[tuple[Callable[[bytearray], None], Optional[Callable[[], None]]]]:
        if serial is None:
            LOGGER.error(
                "DMX_SERIAL_PORT is set to %s but pyserial is not installed. "
                "Install pyserial to enable direct USB DMX output.",
                port,
            )
            return None

        LOGGER.info("Using DMX serial port %s for DMX output", port)
        serial_config: Dict[str, Any] = {
            "port": port,
            "baudrate": 250000,
            "bytesize": serial.EIGHTBITS,
            "parity": serial.PARITY_NONE,
            "stopbits": serial.STOPBITS_TWO,
            "timeout": 1,
            "write_timeout": 1,
        }

        try:
            # Attempt to open the serial port once during initialisation so we
            # can gracefully fall back to a dry-run sender when the hardware is
            # not available (e.g. on development machines).
            test_serial = serial.Serial(**serial_config)
        except Exception as exc:  # pragma: no cover - depends on hardware
            LOGGER.error(
                "Unable to open DMX serial port %s (%s). "
                "Falling back to OLA/dry-run output.",
                port,
                exc,
            )
            return None
        else:  # pragma: no cover - depends on hardware
            try:
                test_serial.close()
            except Exception:
                LOGGER.debug(
                    "Error while closing test connection to DMX serial port %s",
                    port,
                    exc_info=True,
                )

        thread_local = threading.local()
        lock = threading.Lock()

        def _get_serial() -> Any:
            ser = getattr(thread_local, "serial", None)
            if ser is None or not getattr(ser, "is_open", False):
                try:
                    ser = serial.Serial(**serial_config)
                except Exception:  # pragma: no cover - depends on hardware
                    LOGGER.exception("Unable to open DMX serial port %s", port)
                    raise
                thread_local.serial = ser
            return ser

        def _close_serial() -> None:
            ser = getattr(thread_local, "serial", None)
            if ser is not None:
                try:
                    ser.close()
                except Exception:  # pragma: no cover - depends on hardware
                    LOGGER.exception("Error while closing DMX serial port %s", port)
                finally:
                    thread_local.serial = None

        def send(data: bytearray) -> None:
            try:
                ser = _get_serial()
            except Exception:
                return

            frame = bytes([0]) + bytes(data[: self.channel_count])
            with lock:
                try:
                    ser.break_condition = True
                    time.sleep(DMX_BREAK_DURATION)
                    ser.break_condition = False
                    time.sleep(DMX_MARK_AFTER_BREAK)
                    ser.write(frame)
                    ser.flush()
                except Exception:  # pragma: no cover - depends on hardware
                    LOGGER.exception("Error while sending DMX data over %s", port)
                    _close_serial()

        return send, _close_serial

    def _run_sender(self) -> None:
        cached_levels = bytearray(self._levels)
        while not self._stop_event.is_set():
            with self._lock:
                if self._dirty:
                    cached_levels = bytearray(self._levels)
                    self._dirty = False
            try:
                self._sender(bytearray(cached_levels))
            except Exception:  # pragma: no cover - defensive logging
                LOGGER.exception("Error while sending DMX data")
            self._stop_event.wait(1.0 / DMX_FPS)

    def set_channel(self, channel: int, value: int) -> None:
        idx = channel - 1
        if idx < 0 or idx >= self.channel_count:
            raise ValueError("Channel out of range")
        with self._lock:
            self._levels[idx] = _clamp(value, 0, 255)
            self._dirty = True

    def get_channel(self, channel: int) -> int:
        idx = channel - 1
        if idx < 0 or idx >= self.channel_count:
            raise ValueError("Channel out of range")
        with self._lock:
            return self._levels[idx]

    def set_levels(self, levels: Iterable[int]) -> None:
        values = list(levels)
        if len(values) != self.channel_count:
            raise ValueError("Levels iterable must contain exactly 512 values")
        with self._lock:
            self._levels[:] = [_clamp(v, 0, 255) for v in values]
            self._dirty = True

    def blackout(self) -> None:
        with self._lock:
            if any(self._levels):
                self._levels = [0] * self.channel_count
                self._dirty = True

    def transition_channel(
        self,
        channel: int,
        value: int,
        duration: float,
        stop_event: Optional[threading.Event] = None,
    ) -> None:
        value = _clamp(value, 0, 255)
        if duration <= 0:
            self.set_channel(channel, value)
            return

        start_value = self.get_channel(channel)
        steps = max(int(duration * DMX_FPS), 1)
        step_duration = duration / steps

        def _worker() -> None:
            for step in range(1, steps + 1):
                if stop_event and stop_event.is_set():
                    return
                ratio = step / steps
                current = round(start_value + (value - start_value) * ratio)
                self.set_channel(channel, current)
                if stop_event:
                    if stop_event.wait(step_duration):
                        return
                else:
                    time.sleep(step_duration)

        thread = threading.Thread(target=_worker, daemon=True)
        thread.start()

    def shutdown(self) -> None:
        self._stop_event.set()
        if self._thread.is_alive():
            self._thread.join(timeout=1.0)
        cleanup = getattr(self, "_sender_cleanup", None)
        if cleanup:
            try:
                cleanup()
            except Exception:  # pragma: no cover - defensive
                LOGGER.exception("Error while cleaning up DMX sender")


class DMXShowRunner:
    def __init__(self, output: DMXOutput) -> None:
        self.output = output
        self._thread: Optional[threading.Thread] = None
        self._stop_event: Optional[threading.Event] = None
        self._lock = threading.Lock()

    def start(self, actions: Iterable[DMXAction]) -> None:
        ordered_actions = sorted(actions, key=lambda act: act.time_seconds)
        if not ordered_actions:
            LOGGER.info("No DMX actions to execute for this show")
            return

        with self._lock:
            self.stop()
            stop_event = threading.Event()
            self._stop_event = stop_event
            self._thread = threading.Thread(
                target=self._run_show,
                args=(ordered_actions, stop_event),
                daemon=True,
            )
            self._thread.start()
            LOGGER.info("Started DMX show with %s actions", len(ordered_actions))

    def _run_show(self, actions: List[DMXAction], stop_event: threading.Event) -> None:
        start_time = time.monotonic()
        for action in actions:
            if stop_event.is_set():
                break
            now = time.monotonic()
            wait_time = action.time_seconds - (now - start_time)
            if wait_time > 0:
                if stop_event.wait(wait_time):
                    break
            self.output.transition_channel(
                action.channel,
                action.value,
                action.fade,
                stop_event=stop_event,
            )

    def stop(self) -> None:
        thread: Optional[threading.Thread]
        with self._lock:
            if self._stop_event:
                self._stop_event.set()
            thread = self._thread
            self._thread = None
            self._stop_event = None
        if thread and thread.is_alive():
            thread.join(timeout=1.0)
            LOGGER.info("Stopped DMX show")


class DMXShowManager:
    """Handles loading, saving, and running DMX shows for videos."""

    def __init__(self, templates_dir: Path, output: DMXOutput) -> None:
        self.templates_dir = templates_dir
        self.templates_dir.mkdir(parents=True, exist_ok=True)
        self.output = output
        self.runner = DMXShowRunner(output)
        self._lock = threading.Lock()

    def template_path_for_video(self, video_entry: Dict[str, object]) -> Path:
        template_value = video_entry.get("dmx_template")
        if template_value:
            path = Path(str(template_value))
        else:
            slug = str(video_entry.get("name", video_entry.get("id", "show"))).lower()
            slug = "_".join(slug.split()) or "show"
            path = Path(f"{slug}.json")
        if not path.is_absolute():
            path = self.templates_dir / path
        return path

    def load_actions(self, template_path: Path) -> List[DMXAction]:
        if not template_path.exists():
            return []
        with template_path.open("r", encoding="utf-8") as fh:
            payload = json.load(fh)
        actions_data = payload.get("actions", [])
        actions: List[DMXAction] = []
        for entry in actions_data:
            actions.append(DMXAction.from_dict(entry))
        return actions

    def load_show_for_video(self, video_entry: Dict[str, object]) -> List[DMXAction]:
        path = self.template_path_for_video(video_entry)
        try:
            actions = self.load_actions(path)
        except FileNotFoundError:
            return []
        except Exception as exc:
            LOGGER.exception("Unable to load DMX template %s", path)
            raise RuntimeError(f"Invalid DMX template: {exc}") from exc
        return actions

    def start_show_for_video(self, video_entry: Dict[str, object]) -> None:
        try:
            actions = self.load_show_for_video(video_entry)
        except RuntimeError:
            LOGGER.error("Skipping DMX show due to template error")
            return
        self.runner.stop()
        zero_levels = [0] * self.output.channel_count
        self.output.set_levels(zero_levels)

        if actions:
            self.runner.start(actions)
        else:
            LOGGER.info(
                "No DMX template for video '%s'. Running blackout.",
                video_entry.get("name"),
            )

    def start_preview(self, raw_actions: Iterable[Dict[str, object]], start_time: float = 0.0) -> None:
        try:
            offset = float(start_time)
        except (TypeError, ValueError) as exc:  # pragma: no cover - defensive
            raise ValueError("start_time must be a number") from exc
        offset = max(0.0, offset)
        actions = [DMXAction.from_dict(entry) for entry in raw_actions]
        ordered = sorted(actions, key=lambda action: action.time_seconds)

        levels = [0] * self.output.channel_count
        adjusted: List[DMXAction] = []
        channel_levels: Dict[int, int] = {}

        for action in ordered:
            channel_index = action.channel - 1
            previous_level = channel_levels.get(action.channel, 0)
            if action.time_seconds < offset:
                if action.fade > 0 and action.time_seconds + action.fade > offset:
                    progress = (offset - action.time_seconds) / action.fade
                    progress = max(0.0, min(1.0, progress))
                    level = round(previous_level + (action.value - previous_level) * progress)
                else:
                    level = action.value
                channel_levels[action.channel] = level
                levels[channel_index] = level
                continue

            adjusted.append(
                DMXAction(
                    time_seconds=action.time_seconds - offset,
                    channel=action.channel,
                    value=action.value,
                    fade=action.fade,
                )
            )
            channel_levels[action.channel] = action.value

        self.runner.stop()
        self.output.set_levels(levels)
        if adjusted:
            self.runner.start(adjusted)

    def stop_show(self) -> None:
        self.runner.stop()
        self.output.blackout()

    def serialize_actions(self, actions: Iterable[DMXAction]) -> List[Dict[str, object]]:
        serialized = []
        for action in actions:
            serialized.append(
                {
                    "time": self.format_timecode(action.time_seconds),
                    "channel": action.channel,
                    "value": action.value,
                    "fade": round(action.fade, 3),
                }
            )
        return serialized

    @staticmethod
    def format_timecode(value: float) -> str:
        milliseconds = int(round((value - int(value)) * 1000))
        total_seconds = int(value)
        seconds = total_seconds % 60
        minutes = (total_seconds // 60) % 60
        hours = total_seconds // 3600
        if milliseconds:
            return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{milliseconds:03d}"
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"

    def save_actions(self, template_path: Path, actions: Iterable[Dict[str, object]]) -> None:
        normalized: List[Dict[str, object]] = []
        for raw in actions:
            action = DMXAction.from_dict(raw)
            normalized.append(
                {
                    "time": self.format_timecode(action.time_seconds),
                    "channel": action.channel,
                    "value": action.value,
                    "fade": round(action.fade, 3),
                }
            )

        payload = {"actions": sorted(normalized, key=lambda item: parse_timecode(str(item["time"])))}
        template_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = template_path.with_suffix(".tmp")
        with tmp_path.open("w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
            fh.write("\n")
        tmp_path.replace(template_path)


def create_manager(templates_dir: Path, universe: int = 0) -> DMXShowManager:
    output = DMXOutput(universe=universe)
    return DMXShowManager(templates_dir, output)
