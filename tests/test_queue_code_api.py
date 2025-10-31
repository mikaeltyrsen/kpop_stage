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
            self.started = 0
            self.default_missing_message = "missing"

        def set_stage_code_overlay(self, code: str) -> None:
            self.calls.append(code)

        def query_state(self):
            return {"is_default": True}

        def start_default_loop(self) -> None:
            self.started += 1

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
    assert controller.started == 1


def test_regenerate_code_requires_idle_queue(monkeypatch):
    registry = app.UserRegistry()
    manager = app.QueueManager(registry)
    manager._access_code = "2468"

    controller = type(
        "ControllerStub",
        (),
        {
            "default_missing_message": "missing",
            "set_stage_code_overlay": lambda self, code: None,
            "query_state": lambda self: {"is_default": True},
            "start_default_loop": lambda self: None,
        },
    )()

    # Seed an entry so the queue is not idle
    manager.join(manager.current_code(), existing_id=None, is_playing=False)

    monkeypatch.setattr(app, "user_registry", registry)
    monkeypatch.setattr(app, "queue_manager", manager)
    monkeypatch.setattr(app, "controller", controller)

    client = app.app.test_client()

    response = client.post("/api/queue/regenerate-code")
    assert response.status_code == 409
    payload = response.get_json()
    assert "error" in payload


def test_regenerate_code_success(monkeypatch):
    registry = app.UserRegistry()
    manager = app.QueueManager(registry)
    manager._access_code = "1111"
    manager._generate_code = lambda: "2222"

    class ControllerStub:
        default_missing_message = "missing"

        def __init__(self) -> None:
            self.set_calls = []
            self.start_count = 0

        def set_stage_code_overlay(self, code: str) -> None:
            self.set_calls.append(code)

        def query_state(self):
            return {"is_default": True}

        def start_default_loop(self) -> None:
            self.start_count += 1

    controller = ControllerStub()

    monkeypatch.setattr(app, "user_registry", registry)
    monkeypatch.setattr(app, "queue_manager", manager)
    monkeypatch.setattr(app, "controller", controller)

    client = app.app.test_client()

    response = client.post("/api/queue/regenerate-code")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["code"] == "2222"
    assert payload["status"] == "rotated"
    assert controller.set_calls == ["2222"]
    assert controller.start_count == 1
    assert manager.current_code() == "2222"


def test_regenerate_code_reports_default_restart_failure(monkeypatch):
    registry = app.UserRegistry()
    manager = app.QueueManager(registry)
    manager._access_code = "9999"
    manager._generate_code = lambda: "0001"

    class ControllerStub:
        default_missing_message = "Default missing"

        def set_stage_code_overlay(self, code: str) -> None:
            pass

        def query_state(self):
            return {"is_default": True}

        def start_default_loop(self) -> None:
            raise FileNotFoundError("missing")

    controller = ControllerStub()

    monkeypatch.setattr(app, "user_registry", registry)
    monkeypatch.setattr(app, "queue_manager", manager)
    monkeypatch.setattr(app, "controller", controller)

    client = app.app.test_client()

    response = client.post("/api/queue/regenerate-code")
    assert response.status_code == 500
    payload = response.get_json()
    assert payload["error"] == controller.default_missing_message
