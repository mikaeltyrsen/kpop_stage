from __future__ import annotations

import sys
import time
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Iterable, List, Optional

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import dmx
from dmx import DMXAction, DMXOutput, DMXShowManager, _resolve_serial_port


class DummyOutput:
    def __init__(self, channel_count: int = 8) -> None:
        self.channel_count = channel_count
        self.level_history: List[List[int]] = []
        self.blackout_called = 0

    def set_levels(self, levels: Iterable[int]) -> None:  # pragma: no cover - simple stub
        self.level_history.append(list(levels))

    def blackout(self) -> None:  # pragma: no cover - simple stub
        self.blackout_called += 1


class DummyRunner:
    def __init__(self) -> None:
        self.started_actions: Optional[List[DMXAction]] = None
        self.stop_calls = 0

    def start(self, actions: Iterable[DMXAction]) -> None:  # pragma: no cover - simple stub
        self.started_actions = list(actions)

    def stop(self) -> None:  # pragma: no cover - simple stub
        self.stop_calls += 1


def create_manager(tmp_path: Path, output: DummyOutput) -> DMXShowManager:
    manager = DMXShowManager(tmp_path, output)
    manager.runner = DummyRunner()  # type: ignore[assignment]
    return manager


def test_start_show_resets_levels_before_running(tmp_path: Path) -> None:
    output = DummyOutput(channel_count=4)
    manager = create_manager(tmp_path, output)

    actions = [
        DMXAction(time_seconds=0.0, channel=1, value=255, fade=0.0),
        DMXAction(time_seconds=2.0, channel=2, value=128, fade=1.0),
    ]

    manager.load_show_for_video = lambda _: actions  # type: ignore[assignment]

    manager.start_show_for_video({"id": "video"})

    assert output.level_history
    assert output.level_history[0] == [0, 0, 0, 0]

    runner: DummyRunner = manager.runner  # type: ignore[assignment]
    assert runner.stop_calls == 1
    assert runner.started_actions == actions


def test_preview_uses_zero_baseline_for_levels(tmp_path: Path) -> None:
    output = DummyOutput(channel_count=3)
    manager = create_manager(tmp_path, output)

    raw_actions = [
        {"time": "00:00:00", "channel": 1, "value": 200, "fade": 2},
        {"time": "00:00:02", "channel": 2, "value": 100, "fade": 0},
    ]

    manager.start_preview(raw_actions, start_time=1.0)

    assert output.level_history
    latest_levels = output.level_history[-1]
    assert latest_levels == [100, 0, 0]


def test_dmx_output_continuous_refresh(monkeypatch: pytest.MonkeyPatch) -> None:
    frames: List[bytes] = []

    def fake_build_sender(self: DMXOutput, universe: int):
        def fake_sender(payload: bytearray) -> None:
            frames.append(bytes(payload))

        return fake_sender, None

    monkeypatch.setattr(dmx, "DMX_FPS", 80.0)
    monkeypatch.setattr(DMXOutput, "_build_sender", fake_build_sender, raising=False)

    output = DMXOutput()
    try:
        output.set_channel(1, 255)
        time.sleep(0.1)
    finally:
        output.shutdown()

    bright_frames = [frame for frame in frames if frame and frame[0] == 255]
    assert len(bright_frames) >= 2


def test_resolve_serial_port_via_serial_number(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DMX_SERIAL_PORT", raising=False)
    monkeypatch.setenv("DMX_SERIAL_NUMBER", "BG00TZ1P")

    ports = [
        SimpleNamespace(
            device="/dev/ttyUSB0",
            serial_number="BG00TZ1P",
            description="FT232R USB UART",
            hwid="USB VID:PID=0403:6001 SNR=BG00TZ1P",
        ),
        SimpleNamespace(
            device="/dev/ttyUSB1",
            serial_number="OTHER",
            description="Other Adapter",
            hwid="USB VID:PID=0000:0000 SNR=OTHER",
        ),
    ]

    list_ports_module = ModuleType("serial.tools.list_ports")
    list_ports_module.comports = lambda: ports  # type: ignore[assignment]
    serial_tools_module = ModuleType("serial.tools")
    serial_tools_module.list_ports = list_ports_module  # type: ignore[assignment]
    serial_module = ModuleType("serial")
    serial_module.EIGHTBITS = 8
    serial_module.PARITY_NONE = "N"
    serial_module.STOPBITS_TWO = 2
    serial_module.Serial = lambda **_: None  # type: ignore[assignment]

    monkeypatch.setitem(sys.modules, "serial", serial_module)
    monkeypatch.setitem(sys.modules, "serial.tools", serial_tools_module)
    monkeypatch.setitem(sys.modules, "serial.tools.list_ports", list_ports_module)
    monkeypatch.setattr(dmx, "serial", serial_module)

    resolved = _resolve_serial_port()
    assert resolved == "/dev/ttyUSB0"


def test_create_manager_applies_default_startup_levels(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    class StartupOutput:
        def __init__(self, universe: int = 0, channel_count: int = dmx.DEFAULT_CHANNELS) -> None:
            self.universe = universe
            self.channel_count = channel_count
            self.applied: List[tuple[int, int]] = []

        def set_channel(self, channel: int, value: int) -> None:
            self.applied.append((channel, value))

        def set_levels(self, levels: Iterable[int]) -> None:  # pragma: no cover - stub
            pass

        def transition_channel(self, *args: object, **kwargs: object) -> None:  # pragma: no cover - stub
            pass

        def blackout(self) -> None:  # pragma: no cover - stub
            pass

        def shutdown(self) -> None:  # pragma: no cover - stub
            pass

    monkeypatch.delenv("DMX_STARTUP_LEVELS", raising=False)
    monkeypatch.setattr(dmx, "DMXOutput", StartupOutput)

    manager = dmx.create_manager(tmp_path, universe=1)
    output = manager.output
    assert isinstance(output, StartupOutput)
    assert output.applied == [(1, 255), (2, 255), (3, 255)]


def test_create_manager_honours_startup_levels_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    class StartupOutput:
        def __init__(self, universe: int = 0, channel_count: int = dmx.DEFAULT_CHANNELS) -> None:
            self.universe = universe
            self.channel_count = channel_count
            self.applied: List[tuple[int, int]] = []

        def set_channel(self, channel: int, value: int) -> None:
            self.applied.append((channel, value))

        def set_levels(self, levels: Iterable[int]) -> None:  # pragma: no cover - stub
            pass

        def transition_channel(self, *args: object, **kwargs: object) -> None:  # pragma: no cover - stub
            pass

        def blackout(self) -> None:  # pragma: no cover - stub
            pass

        def shutdown(self) -> None:  # pragma: no cover - stub
            pass

    monkeypatch.setenv("DMX_STARTUP_LEVELS", "4=10,5=99")
    monkeypatch.setattr(dmx, "DMXOutput", StartupOutput)

    manager = dmx.create_manager(tmp_path, universe=2)
    output = manager.output
    assert isinstance(output, StartupOutput)
    assert output.applied == [(4, 10), (5, 99)]


def test_create_manager_allows_disabling_startup_levels(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    class StartupOutput:
        def __init__(self, universe: int = 0, channel_count: int = dmx.DEFAULT_CHANNELS) -> None:
            self.universe = universe
            self.channel_count = channel_count
            self.applied: List[tuple[int, int]] = []

        def set_channel(self, channel: int, value: int) -> None:
            self.applied.append((channel, value))

        def set_levels(self, levels: Iterable[int]) -> None:  # pragma: no cover - stub
            pass

        def transition_channel(self, *args: object, **kwargs: object) -> None:  # pragma: no cover - stub
            pass

        def blackout(self) -> None:  # pragma: no cover - stub
            pass

        def shutdown(self) -> None:  # pragma: no cover - stub
            pass

    monkeypatch.setenv("DMX_STARTUP_LEVELS", "off")
    monkeypatch.setattr(dmx, "DMXOutput", StartupOutput)

    manager = dmx.create_manager(tmp_path, universe=0)
    output = manager.output
    assert isinstance(output, StartupOutput)
    assert output.applied == []

