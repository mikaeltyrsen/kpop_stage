import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dmx import DMXOutput


def _wait_for_transitions(duration: float) -> None:
    # Give transition threads time to process without relying on busy waiting.
    time.sleep(duration)


def test_transition_cancels_previous_fade_on_same_channel() -> None:
    output = DMXOutput()
    try:
        output.set_channel(1, 0)
        output.transition_channel(1, 255, 0.6)
        _wait_for_transitions(0.05)
        output.transition_channel(1, 100, 0.2)
        _wait_for_transitions(0.8)
        final_value = output.get_channel(1)
        assert 95 <= final_value <= 105
    finally:
        output.shutdown()


def test_set_channel_cancels_active_transition() -> None:
    output = DMXOutput()
    try:
        output.set_channel(1, 0)
        output.transition_channel(1, 255, 0.6)
        _wait_for_transitions(0.05)
        output.set_channel(1, 10)
        _wait_for_transitions(0.7)
        assert output.get_channel(1) <= 12
    finally:
        output.shutdown()
