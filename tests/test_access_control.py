import pathlib
import sys
from typing import Any, Dict, Optional

import pytest

ROOT_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

pytest.importorskip("flask")

import app as app_module


class StubController:
    def __init__(self) -> None:
        self.play_calls = []
        self.stop_calls = 0
        self.is_default = True
        self.default_missing_message = "missing default"
        self.welcome_texts = []

    def play(self, path: pathlib.Path, *, welcome_text: Optional[str] = None) -> None:
        self.play_calls.append(path)
        self.welcome_texts.append(welcome_text)
        self.is_default = False

    def stop(self) -> None:
        self.stop_calls += 1
        self.is_default = True

    def query_state(self) -> Dict[str, Any]:
        return {
            "is_default": self.is_default,
            "current": "current.mp4" if not self.is_default else None,
            "volume": 50,
            "position": 12.5,
            "duration": 120.0,
        }


class StubDMXManager:
    def __init__(self) -> None:
        self.started_for = []
        self.stop_calls = 0
        self.active = False

    def start_show_for_video(self, video: Dict[str, Any]) -> None:
        self.started_for.append(video)
        self.active = True

    def stop_show(self) -> None:
        self.stop_calls += 1
        self.active = False

    def is_smoke_active(self) -> bool:
        return False

    def is_smoke_available(self) -> bool:
        return False

    def has_active_show(self) -> bool:
        return self.active


@pytest.fixture()
def setup_environment(monkeypatch: pytest.MonkeyPatch) -> Dict[str, Any]:
    controller = StubController()
    manager = StubDMXManager()
    registry = app_module.UserRegistry()
    session = app_module.PlaybackSession()

    monkeypatch.setattr(app_module, "controller", controller)
    monkeypatch.setattr(app_module, "dmx_manager", manager)
    monkeypatch.setattr(app_module, "user_registry", registry)
    monkeypatch.setattr(app_module, "playback_session", session)
    monkeypatch.setattr(
        app_module,
        "get_video_entry",
        lambda video_id: {"id": video_id, "file": "video.mp4", "name": f"Video {video_id}"},
    )
    monkeypatch.setattr(app_module, "resolve_media_path", lambda path: pathlib.Path(__file__))

    client = app_module.app.test_client()
    return {
        "client": client,
        "controller": controller,
        "manager": manager,
        "registry": registry,
        "session": session,
    }


def register(client, *, admin: bool) -> str:
    response = client.post("/api/register", json={"admin": admin})
    payload = response.get_json()
    return payload["key"]


def test_non_admin_blocked_during_playback(setup_environment: Dict[str, Any]) -> None:
    client = setup_environment["client"]
    controller: StubController = setup_environment["controller"]

    user_key = register(client, admin=False)
    response = client.post("/api/play", json={"id": "alpha", "key": user_key})
    assert response.status_code == 200
    assert controller.play_calls

    second_key = register(client, admin=False)
    response_conflict = client.post("/api/play", json={"id": "beta", "key": second_key})
    assert response_conflict.status_code == 409

    same_user_response = client.post("/api/play", json={"id": "gamma", "key": user_key})
    assert same_user_response.status_code == 409

    admin_key = register(client, admin=True)
    admin_response = client.post("/api/play", json={"id": "delta", "key": admin_key})
    assert admin_response.status_code == 200
    assert controller.play_calls[-1].name == pathlib.Path(__file__).name


def test_stop_requires_owner_or_admin(setup_environment: Dict[str, Any]) -> None:
    client = setup_environment["client"]
    controller: StubController = setup_environment["controller"]
    session: app_module.PlaybackSession = setup_environment["session"]

    owner_key = register(client, admin=False)
    start_response = client.post("/api/play", json={"id": "alpha", "key": owner_key})
    assert start_response.status_code == 200
    assert session.owner_key() == owner_key

    other_key = register(client, admin=False)
    forbidden_response = client.post("/api/stop", json={"key": other_key})
    assert forbidden_response.status_code == 403
    assert controller.stop_calls == 0

    admin_key = register(client, admin=True)
    admin_response = client.post("/api/stop", json={"key": admin_key})
    assert admin_response.status_code == 200
    assert controller.stop_calls == 1
    assert session.owner_key() is None


def test_status_reports_owner_and_admin_controls(setup_environment: Dict[str, Any]) -> None:
    client = setup_environment["client"]
    session: app_module.PlaybackSession = setup_environment["session"]

    owner_key = register(client, admin=False)
    play_response = client.post("/api/play", json={"id": "alpha", "key": owner_key})
    assert play_response.status_code == 200

    other_key = register(client, admin=False)
    admin_key = register(client, admin=True)

    owner_status = client.get(f"/api/status?key={owner_key}").get_json()
    assert owner_status["controls"]["is_owner"] is True
    assert owner_status["controls"]["can_stop"] is True
    assert owner_status["controls"]["can_play"] is False

    other_status = client.get(f"/api/status?key={other_key}").get_json()
    assert other_status["controls"]["is_owner"] is False
    assert other_status["controls"]["can_stop"] is False
    assert other_status["controls"]["can_play"] is False

    admin_status = client.get(f"/api/status?key={admin_key}").get_json()
    assert admin_status["controls"]["is_admin"] is True
    assert admin_status["controls"]["can_stop"] is True
    assert admin_status["controls"]["can_play"] is True

    # Simulate playback ending and ensure session clears
    session.clear()
    setup_environment["controller"].is_default = True
    stopped_status = client.get(f"/api/status?key={owner_key}").get_json()
    assert stopped_status["mode"] == "default_loop"
    assert stopped_status["controls"]["can_stop"] is False
