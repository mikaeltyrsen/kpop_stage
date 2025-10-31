import pathlib
import sys

import pytest


pytest.importorskip("flask")

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import app


def test_queue_code_requires_admin(monkeypatch):
    registry = app.UserRegistry()
    manager = app.QueueManager(registry)
    manager._access_code = "1357"

    monkeypatch.setattr(app, "user_registry", registry)
    monkeypatch.setattr(app, "queue_manager", manager)

    client = app.app.test_client()

    # Missing key
    response = client.get("/api/queue/code")
    assert response.status_code == 403

    user = registry.register(is_admin=False)
    response = client.post("/api/queue/code", json={"key": user["key"]})
    assert response.status_code == 403


def test_queue_code_get_and_rotate(monkeypatch):
    class ControllerStub:
        def __init__(self) -> None:
            self.calls = []

        def set_stage_code_overlay(self, code: str) -> None:
            self.calls.append(code)

    registry = app.UserRegistry()
    manager = app.QueueManager(registry)
    manager._access_code = "1234"

    admin = registry.register(is_admin=True)

    controller = ControllerStub()

    monkeypatch.setattr(app, "user_registry", registry)
    monkeypatch.setattr(app, "queue_manager", manager)
    monkeypatch.setattr(app, "controller", controller)

    client = app.app.test_client()

    get_response = client.get(
        "/api/queue/code", query_string={"key": admin["key"]}
    )
    assert get_response.status_code == 200
    get_payload = get_response.get_json()
    assert get_payload["code"] == "1234"
    assert get_payload["status"] == "ok"

    manager._generate_code = lambda: "6789"

    post_response = client.post(
        "/api/queue/code", json={"key": admin["key"]}
    )
    assert post_response.status_code == 200
    post_payload = post_response.get_json()
    assert post_payload["status"] == "rotated"
    assert post_payload["code"] == "6789"
    assert manager.current_code() == "6789"
    assert controller.calls[-1] == "6789"
