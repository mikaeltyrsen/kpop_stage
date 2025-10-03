from __future__ import annotations

import sys
from pathlib import Path
from typing import Iterable, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dmx import DMXAction, DMXShowManager


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

