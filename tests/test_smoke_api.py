import pytest

pytest.importorskip("flask")

import app as app_module


class StubSmokeManager:
    def __init__(self, available: bool = True) -> None:
        self.available = available
        self.active = False
        self.trigger_calls = []

    def is_smoke_available(self) -> bool:
        return self.available

    def is_smoke_active(self) -> bool:
        return self.active

    def trigger_smoke(self, level: int, duration: float) -> float:
        if not self.available:
            raise RuntimeError("not available")
        self.trigger_calls.append((level, duration))
        self.active = True
        return duration


class StubController:
    def query_state(self):
        return {"is_default": True}


def test_smoke_endpoint_triggers_manager(monkeypatch: pytest.MonkeyPatch) -> None:
    client = app_module.app.test_client()
    manager = StubSmokeManager()
    monkeypatch.setattr(app_module, "dmx_manager", manager)
    monkeypatch.setattr(app_module, "SMOKE_TRIGGER_LEVEL", 180)
    monkeypatch.setattr(app_module, "SMOKE_TRIGGER_DURATION", 1.5)

    response = client.post("/api/dmx/smoke")

    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "triggered"
    assert data["duration"] == pytest.approx(1.5)
    assert manager.trigger_calls == [(180, 1.5)]


def test_smoke_endpoint_handles_missing_channel(monkeypatch: pytest.MonkeyPatch) -> None:
    client = app_module.app.test_client()
    manager = StubSmokeManager(available=False)
    monkeypatch.setattr(app_module, "dmx_manager", manager)

    response = client.post("/api/dmx/smoke")

    assert response.status_code == 400
    body = response.get_json()
    assert "error" in body


def test_status_includes_smoke_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    client = app_module.app.test_client()
    manager = StubSmokeManager()
    controller = StubController()
    monkeypatch.setattr(app_module, "dmx_manager", manager)
    monkeypatch.setattr(app_module, "controller", controller)

    response = client.get("/api/status")

    assert response.status_code == 200
    payload = response.get_json()
    assert "smoke_active" in payload
    assert "smoke_available" in payload
    assert payload["smoke_active"] is False
    assert payload["smoke_available"] is True
