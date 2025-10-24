from typing import Iterable, List

import pytest

from dmx import RelayAction
from snow import SnowMachineController


class DummyResponse:
    def __enter__(self) -> "DummyResponse":  # pragma: no cover - simple stub
        return self

    def __exit__(self, exc_type, exc, exc_tb) -> None:  # pragma: no cover - simple stub
        return None

    def read(self, _size: int = 1) -> bytes:  # pragma: no cover - simple stub
        return b""


def build_loader(commands: List[dict]) -> Iterable[dict]:
    return [
        {
            "id": "relay_snow_machine",
            "name": "Snow Machine",
            "commands": commands,
        }
    ]


def test_snow_controller_executes_commands(monkeypatch: pytest.MonkeyPatch) -> None:
    invoked: List[str] = []

    def fake_urlopen(request: object, timeout: float = 0.0) -> DummyResponse:
        invoked.append(getattr(request, "full_url", ""))
        return DummyResponse()

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    controller = SnowMachineController(
        lambda: build_loader(
            [
                {"id": "on", "label": "On", "url": "http://relay/on"},
                {"id": "off", "label": "Off", "url": "http://relay/off"},
            ]
        ),
        preset_id="relay_snow_machine",
        request_timeout=1.0,
    )

    assert controller.is_available()
    assert controller.set_active(True)
    assert controller.is_active()
    assert controller.set_active(False) is False
    assert not controller.is_active()
    assert invoked == ["http://relay/on", "http://relay/off"]


def test_snow_controller_updates_from_relay_action() -> None:
    controller = SnowMachineController(
        lambda: build_loader(
            [
                {"id": "on", "label": "On", "url": "http://relay/on"},
                {"id": "off", "label": "Off", "url": "http://relay/off"},
            ]
        ),
        preset_id="relay_snow_machine",
        request_timeout=1.0,
    )

    assert controller.is_available()
    assert not controller.is_active()

    controller.handle_relay_action(
        RelayAction(
            time_seconds=0.0,
            url="http://relay/on",
            preset_id="relay_snow_machine",
            command_id="on",
            label="On",
        )
    )
    assert controller.is_active()

    controller.handle_relay_action(
        RelayAction(
            time_seconds=1.0,
            url="http://relay/off",
            preset_id="relay_snow_machine",
            command_id="off",
            label="Off",
        )
    )
    assert not controller.is_active()


def test_snow_controller_handles_missing_configuration() -> None:
    controller = SnowMachineController(lambda: [], preset_id="relay_snow_machine", request_timeout=1.0)

    assert not controller.is_available()
    with pytest.raises(RuntimeError):
        controller.set_active(True)
