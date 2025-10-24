import sys
from pathlib import Path
from typing import Optional

import pytest

pytest.importorskip("flask")

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import app


def test_main_starts_default_dmx_template_when_default_loop_missing(monkeypatch):
    started = {"dmx": False}

    def fake_start_default_loop() -> None:
        raise FileNotFoundError("default loop missing")

    def fake_start_default_show(path: Path) -> None:
        started["dmx"] = True

    def fake_run(*args, **kwargs) -> None:
        return None

    monkeypatch.setattr(app.controller, "start_default_loop", fake_start_default_loop)
    monkeypatch.setattr(app.dmx_manager, "start_default_show", fake_start_default_show)
    monkeypatch.setattr(app.app, "run", fake_run)

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
