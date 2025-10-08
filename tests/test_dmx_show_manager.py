from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Iterable, List

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
        self.started_actions: List[DMXAction] = []
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
    manager.update_baseline_levels([10, 20, 30, 40])

    actions = [
        DMXAction(time_seconds=0.0, channel=1, value=255, fade=0.0),
        DMXAction(time_seconds=2.0, channel=2, value=128, fade=1.0),
    ]

    manager.load_show_for_video = lambda _: actions  # type: ignore[assignment]

    manager.start_show_for_video({"id": "video"})

    assert output.level_history
    assert output.level_history[0] == [255, 0, 0, 0]

    runner: DummyRunner = manager.runner  # type: ignore[assignment]
    assert runner.stop_calls == 1
    assert runner.started_actions == actions


def test_soda_pop_uses_template_without_custom_actions(tmp_path: Path) -> None:
    output = DummyOutput(channel_count=8)
    manager = create_manager(tmp_path, output)
    manager.update_baseline_levels([0] * output.channel_count)
    expected_actions = [
        DMXAction(time_seconds=0.0, channel=1, value=255, fade=0.0),
        DMXAction(time_seconds=2.0, channel=2, value=128, fade=1.5),
    ]
    manager.load_show_for_video = lambda _: expected_actions  # type: ignore[assignment]

    manager.start_show_for_video({"id": "soda_pop"})

    runner: DummyRunner = manager.runner  # type: ignore[assignment]
    assert runner.stop_calls == 1
    assert runner.started_actions == expected_actions


def test_stop_show_preserves_startup_scene_until_show_runs(tmp_path: Path) -> None:
    output = DummyOutput(channel_count=4)
    manager = create_manager(tmp_path, output)

    manager.stop_show()

    assert output.blackout_called == 0


def test_stop_show_blackouts_after_show_runs(tmp_path: Path) -> None:
    output = DummyOutput(channel_count=4)
    manager = create_manager(tmp_path, output)

    actions = [
        DMXAction(time_seconds=0.0, channel=1, value=255, fade=0.0),
    ]
    manager.load_show_for_video = lambda _: actions  # type: ignore[assignment]

    manager.start_show_for_video({"id": "video"})
    manager.stop_show()

    assert output.blackout_called == 1


def test_preview_uses_baseline_for_levels(tmp_path: Path) -> None:
    output = DummyOutput(channel_count=3)
    manager = create_manager(tmp_path, output)
    manager.update_baseline_levels([10, 20, 30])

    raw_actions = [
        {"time": "00:00:00", "channel": 1, "value": 200, "fade": 2},
        {"time": "00:00:02", "channel": 2, "value": 100, "fade": 0},
    ]

    manager.start_preview(raw_actions, start_time=1.0)

    assert output.level_history
    latest_levels = output.level_history[-1]
    assert latest_levels == [105, 20, 30]


def test_start_show_without_instant_actions_defaults_to_zero(tmp_path: Path) -> None:
    output = DummyOutput(channel_count=4)
    manager = create_manager(tmp_path, output)
    manager.update_baseline_levels([50, 60, 70, 80])

    actions = [
        DMXAction(time_seconds=1.0, channel=2, value=200, fade=0.5),
    ]

    manager.load_show_for_video = lambda _: actions  # type: ignore[assignment]

    manager.start_show_for_video({"id": "video"})

    assert output.level_history
    assert output.level_history[0] == [0, 0, 0, 0]


def test_preview_template_uses_zero_baseline(tmp_path: Path) -> None:
    output = DummyOutput(channel_count=3)
    manager = create_manager(tmp_path, output)
    manager.update_baseline_levels([25, 50, 75])

    raw_actions = [
        {"time": "00:00:00", "channel": 2, "value": 100, "fade": 0},
        {"time": "00:00:01", "channel": 3, "value": 150, "fade": 0},
    ]

    manager.start_preview(raw_actions, start_time=0.0, paused=False, template_preview=True)

    assert output.level_history
    latest_levels = output.level_history[-1]
    assert latest_levels == [0, 100, 0]


def test_preview_applies_zero_fade_action_at_start_time(tmp_path: Path) -> None:
    output = DummyOutput(channel_count=3)
    manager = create_manager(tmp_path, output)
    manager.update_baseline_levels([10, 20, 30])

    raw_actions = [
        {"time": "00:00:00", "channel": 1, "value": 255, "fade": 0},
        {"time": "00:00:05", "channel": 2, "value": 200, "fade": 0},
    ]

    manager.start_preview(raw_actions, start_time=5.0)

    assert output.level_history
    latest_levels = output.level_history[-1]
    assert latest_levels == [255, 200, 30]

    runner: DummyRunner = manager.runner  # type: ignore[assignment]
    assert runner.started_actions == []


def test_preview_paused_stops_runner(tmp_path: Path) -> None:
    output = DummyOutput(channel_count=3)
    manager = create_manager(tmp_path, output)
    manager.update_baseline_levels([10, 20, 30])

    raw_actions = [
        {"time": "00:00:00", "channel": 1, "value": 200, "fade": 2},
        {"time": "00:00:03", "channel": 2, "value": 150, "fade": 0},
    ]

    manager.start_preview(raw_actions, start_time=1.0, paused=True)

    assert output.level_history
    latest_levels = output.level_history[-1]
    # Channel 1 should reflect fade progress, channel 2 stays at baseline.
    assert latest_levels == [105, 20, 30]

    runner: DummyRunner = manager.runner  # type: ignore[assignment]
    assert runner.started_actions == []


def test_expand_actions_with_template_loop_count(tmp_path: Path) -> None:
    output = DummyOutput(channel_count=4)
    manager = create_manager(tmp_path, output)

    raw_actions = [
        {
            "time": "00:00:00",
            "channel": 1,
            "value": 255,
            "fade": 0,
            "templateInstanceId": "loop-1",
            "templateLoop": {
                "enabled": True,
                "count": 3,
                "mode": "forward",
                "duration": 1.0,
                "channels": [1],
            },
        },
        {
            "time": "00:00:00.500",
            "channel": 1,
            "value": 0,
            "fade": 0,
            "templateInstanceId": "loop-1",
        },
    ]

    expanded = manager._expand_actions_with_loops(raw_actions)
    times = [action.time_seconds for action in expanded]
    assert times == pytest.approx([0.0, 0.5, 1.0, 1.5, 2.0, 2.5])


def test_expand_actions_with_template_loop_infinite_conflict(tmp_path: Path) -> None:
    output = DummyOutput(channel_count=4)
    manager = create_manager(tmp_path, output)

    raw_actions = [
        {
            "time": "00:00:00",
            "channel": 1,
            "value": 255,
            "fade": 0,
            "templateInstanceId": "loop-1",
            "templateLoop": {
                "enabled": True,
                "infinite": True,
                "mode": "forward",
                "duration": 2.0,
                "channels": [1],
            },
        },
        {
            "time": "00:00:01.000",
            "channel": 1,
            "value": 0,
            "fade": 0,
            "templateInstanceId": "loop-1",
        },
        {"time": "00:00:05.000", "channel": 1, "value": 50, "fade": 0},
    ]

    expanded = manager._expand_actions_with_loops(raw_actions)
    times = [round(action.time_seconds, 6) for action in expanded]
    assert times == pytest.approx([0.0, 1.0, 2.0, 3.0, 4.0, 5.0])


def test_expand_actions_with_template_loop_infinite_without_conflict(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(dmx, "TEMPLATE_LOOP_INFINITE_DURATION_SECONDS", 3.0)
    output = DummyOutput(channel_count=4)
    manager = create_manager(tmp_path, output)

    raw_actions = [
        {
            "time": "00:00:00",
            "channel": 1,
            "value": 255,
            "fade": 0,
            "templateInstanceId": "loop-1",
            "templateLoop": {
                "enabled": True,
                "infinite": True,
                "mode": "forward",
                "duration": 1.0,
                "channels": [1],
            },
        },
        {
            "time": "00:00:00.500",
            "channel": 1,
            "value": 0,
            "fade": 0,
            "templateInstanceId": "loop-1",
        },
    ]

    expanded = manager._expand_actions_with_loops(raw_actions)
    times = [round(action.time_seconds, 6) for action in expanded]
    assert times == pytest.approx([0.0, 0.5, 1.0, 1.5, 2.0, 2.5])


def test_template_loop_stops_when_same_instance_changes_channel(tmp_path: Path) -> None:
    output = DummyOutput(channel_count=4)
    manager = create_manager(tmp_path, output)

    raw_actions = [
        {
            "time": "00:00:00",
            "channel": 1,
            "value": 255,
            "fade": 0,
            "templateInstanceId": "loop-1",
            "templateLoop": {
                "enabled": True,
                "count": 10,
                "mode": "forward",
                "duration": 1.0,
                "channels": [1, 2],
            },
        },
        {
            "time": "00:00:00.500",
            "channel": 2,
            "value": 128,
            "fade": 0,
            "templateInstanceId": "loop-1",
        },
        {
            "time": "00:00:03.200",
            "channel": 2,
            "value": 0,
            "fade": 0,
            "templateInstanceId": "loop-1",
        },
    ]

    expanded = manager._expand_actions_with_loops(raw_actions)
    times = [round(action.time_seconds, 6) for action in expanded]
    assert times == pytest.approx([0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.2])


def test_expand_actions_with_template_loop_requires_duration(tmp_path: Path) -> None:
    output = DummyOutput(channel_count=4)
    manager = create_manager(tmp_path, output)

    raw_actions = [
        {
            "time": "00:00:00",
            "channel": 1,
            "value": 255,
            "fade": 0,
            "templateInstanceId": "loop-1",
            "templateLoop": {"enabled": True, "count": 5, "mode": "forward", "duration": 0},
        },
        {
            "time": "00:00:00.500",
            "channel": 1,
            "value": 0,
            "fade": 0,
            "templateInstanceId": "loop-1",
        },
    ]

    expanded = manager._expand_actions_with_loops(raw_actions)
    times = [action.time_seconds for action in expanded]
    assert times == pytest.approx([0.0, 0.5])


def test_save_actions_persists_template_loop(tmp_path: Path) -> None:
    output = DummyOutput(channel_count=4)
    manager = create_manager(tmp_path, output)
    template_path = tmp_path / "loop.json"

    raw_actions = [
        {
            "time": "00:00:00",
            "channel": 1,
            "value": 200,
            "fade": 0,
            "templateInstanceId": "loop-1",
            "templateLoop": {
                "enabled": True,
                "count": 2,
                "mode": "pingpong",
                "duration": 1.25,
                "channels": [1, 2],
            },
        }
    ]

    manager.save_actions(template_path, raw_actions)

    with template_path.open("r", encoding="utf-8") as fh:
        saved = json.load(fh)

    assert "actions" in saved
    assert saved["actions"][0]["templateLoop"] == {
        "enabled": True,
        "count": 2,
        "infinite": False,
        "mode": "pingpong",
        "duration": 1.25,
        "channels": [1, 2],
    }


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

