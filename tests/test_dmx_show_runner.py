import threading

from dmx import DMXAction, DMXShowRunner


class ImmediateOutput:
    def __init__(self) -> None:
        self.calls = []

    def transition_channel(self, channel: int, value: int, duration: float, stop_event=None) -> None:  # pragma: no cover - trivial
        self.calls.append((channel, value, duration))


def test_start_replaces_running_show_without_deadlock() -> None:
    output = ImmediateOutput()
    runner = DMXShowRunner(output)

    actions = [DMXAction(time_seconds=1.0, channel=1, value=255, fade=0.0)]

    runner.start(actions)

    thread = threading.Thread(target=lambda: runner.start(actions))
    thread.start()
    thread.join(timeout=1.5)

    assert not thread.is_alive(), "runner.start() should not deadlock when restarting a show"

    runner.stop()
