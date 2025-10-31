import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:  # pragma: no branch - deterministic fallback when Flask is absent
    import flask  # type: ignore  # noqa: F401
except ModuleNotFoundError:  # pragma: no cover - environment dependent
    flask_stub = ModuleType("flask")

    class _DummyFlask:
        def __init__(self, *args, **kwargs) -> None:  # pragma: no cover - trivial
            pass

        def route(self, *args, **kwargs):  # pragma: no cover - trivial
            def decorator(func):
                return func

            return decorator

    def _unsupported(*args, **kwargs):  # pragma: no cover - trivial
        raise RuntimeError("Flask is not available in the test environment")

    flask_stub.Flask = _DummyFlask
    flask_stub.abort = _unsupported
    flask_stub.jsonify = _unsupported
    flask_stub.redirect = _unsupported
    flask_stub.render_template = _unsupported
    flask_stub.request = SimpleNamespace()
    flask_stub.send_from_directory = _unsupported
    sys.modules.setdefault("flask", flask_stub)

import app


def test_main_starts_default_dmx_template_when_default_loop_missing(monkeypatch):
    started = {"dmx": False}

    def fake_start_default_loop(*, force_restart: bool = False) -> None:
        raise FileNotFoundError("default loop missing")

    def fake_start_default_show(path: Path) -> None:
        started["dmx"] = True

    def fake_run(*args, **kwargs) -> None:
        return None

    monkeypatch.setattr(app.controller, "start_default_loop", fake_start_default_loop)
    monkeypatch.setattr(app.dmx_manager, "start_default_show", fake_start_default_show)
    monkeypatch.setattr(app.app, "run", fake_run, raising=False)
    monkeypatch.setattr(app, "_serve_app", lambda *args, **kwargs: None)

    app.main()

    assert started["dmx"] is True


def test_build_power_command_prefers_systemctl(monkeypatch):
    monkeypatch.setattr(app.os, "geteuid", lambda: 0, raising=False)

    def fake_which(name: str) -> Optional[str]:
        mapping = {
            "systemctl": "/bin/systemctl",
            "reboot": "/sbin/reboot",
            "shutdown": "/sbin/shutdown",
        }
        return mapping.get(name)

    monkeypatch.setattr(app.shutil, "which", fake_which)

    command = app.build_power_command("restart")

    assert command == ["/bin/systemctl", "reboot"]


def test_build_power_command_adds_sudo_when_needed(monkeypatch):
    monkeypatch.setattr(app.os, "geteuid", lambda: 1000, raising=False)

    def fake_which(name: str) -> Optional[str]:
        mapping = {
            "systemctl": "/bin/systemctl",
            "sudo": "/usr/bin/sudo",
        }
        return mapping.get(name)

    monkeypatch.setattr(app.shutil, "which", fake_which)

    command = app.build_power_command("restart")

    assert command == ["/usr/bin/sudo", "/bin/systemctl", "reboot"]


def test_ensure_display_powered_on_quotes_osd_name(monkeypatch):
    payload = {}

    def fake_run(*args, **kwargs):
        payload["input"] = kwargs.get("input")

    monkeypatch.setattr(app, "CEC_OSD_NAME", 'Demon "Player" \\ Test')
    monkeypatch.setattr(app.subprocess, "run", fake_run)

    app.ensure_display_powered_on()

    assert (
        payload["input"]
        == b'name 0 "Demon \\"Player\\" \\\\ Test"\non 0\n'
    )
