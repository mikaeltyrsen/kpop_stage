import pathlib
import sys

import pytest

pytest.importorskip("flask")

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import app


def test_normalize_performer_name_trims_and_limits():
    raw = "  Cosmic    Kid  \n"
    assert app._normalize_performer_name(raw) == "Cosmic Kid"

    long_name = "Nebula " + "x" * 100
    normalized = app._normalize_performer_name(long_name)
    assert normalized is not None
    assert len(normalized) <= app.PERFORMER_NAME_MAX_LENGTH


def test_queue_join_records_performer_name():
    registry = app.UserRegistry()
    manager = app.QueueManager(registry)
    manager._access_code = "54321"

    entry, created = manager.join(
        "54321",
        existing_id=None,
        is_playing=False,
        performer_name="  Star    Child  ",
    )

    assert created is True
    assert entry.performer_name == "Star Child"

    entry_again, created_again = manager.join(
        "54321",
        existing_id=entry.id,
        is_playing=False,
        performer_name="   ",
    )

    assert created_again is False
    assert entry_again.performer_name is None


def test_queue_performer_endpoint_updates(monkeypatch):
    registry = app.UserRegistry()
    manager = app.QueueManager(registry)
    manager._access_code = "13579"

    monkeypatch.setattr(app, "user_registry", registry)
    monkeypatch.setattr(app, "queue_manager", manager)

    client = app.app.test_client()

    join_response = client.post(
        "/api/queue/join",
        json={"code": "13579", "performer_name": "Nova"},
    )
    assert join_response.status_code == 200
    join_payload = join_response.get_json()
    assert join_payload["entry"]["performer_name"] == "Nova"

    update_response = client.post(
        "/api/queue/performer", json={"name": "Starlight"}
    )
    assert update_response.status_code == 200
    update_payload = update_response.get_json()
    assert update_payload["entry"]["performer_name"] == "Starlight"


def test_play_uses_performer_name(monkeypatch):
    class ControllerStub:
        def __init__(self) -> None:
            self.calls = []

        def play(self, path: pathlib.Path, *, welcome_text=None) -> None:
            self.calls.append((path, welcome_text))

        def stop(self) -> None:  # pragma: no cover - not used
            pass

        def query_state(self):
            return {"is_default": True}

    class DMXStub:
        def fade_all_to_value(self, *args, **kwargs):
            return None

        def start_show_for_video(self, *args, **kwargs):  # pragma: no cover - noop
            return None

        def has_active_show(self):
            return False

        def start_default_show(self, *args, **kwargs):  # pragma: no cover - noop
            return None

    registry = app.UserRegistry()
    manager = app.QueueManager(registry)
    manager._access_code = "24680"

    controller = ControllerStub()

    monkeypatch.setattr(app, "user_registry", registry)
    monkeypatch.setattr(app, "queue_manager", manager)
    monkeypatch.setattr(app, "controller", controller)
    monkeypatch.setattr(app, "dmx_manager", DMXStub())
    monkeypatch.setattr(
        app,
        "get_video_entry",
        lambda video_id: {"id": video_id, "file": "video.mp4", "name": video_id},
    )
    monkeypatch.setattr(app, "resolve_media_path", lambda path: pathlib.Path(__file__))

    client = app.app.test_client()

    join_payload = client.post(
        "/api/queue/join", json={"code": "24680", "performer_name": "Galaxy"}
    ).get_json()
    performer_key = join_payload["entry"]["user_key"]

    play_response = client.post(
        "/api/play", json={"id": "alpha", "key": performer_key}
    )

    assert play_response.status_code == 200
    assert controller.calls
    assert controller.calls[-1][1] == "Galaxy"
