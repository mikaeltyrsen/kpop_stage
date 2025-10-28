import sys
from collections import deque
from pathlib import Path
from types import ModuleType, SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:  # pragma: no branch - import fallback is deterministic
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


class _DummyProcess:
    def poll(self) -> None:
        return None


def test_stage_overlay_retries_when_command_initially_fails(monkeypatch, tmp_path):
    monkeypatch.setattr(app.shutil, "which", lambda name: name)

    controller = app.PlaybackController(default_video=tmp_path / "default.mp4")
    controller._process = _DummyProcess()
    controller._stage_overlay_subtitle_path = tmp_path / "stage_code.ass"

    sub_add_responses = deque(
        [
            {"error": "error running command"},
            {"error": "success"},
        ]
    )

    sid_responses = deque([
        {"error": "success", "data": "7"},
    ])

    commands = []

    def fake_send_ipc_command(*command):
        commands.append(command)
        if command[:1] == ("sub-add",):
            return sub_add_responses.popleft()
        if command[:2] == ("get_property", "sid"):
            return sid_responses.popleft()
        if command[:1] == ("sub-remove",):
            return {"error": "success"}
        return {"error": "success"}

    monkeypatch.setattr(controller, "_send_ipc_command", fake_send_ipc_command)

    controller.set_stage_code_overlay("ABC")

    assert controller._stage_overlay_text == "ABC"
    assert controller._stage_overlay_active is False
    # First attempt should fail to add the subtitle overlay.
    assert len(sub_add_responses) == 1

    controller._maybe_fire_video_start(idle=False)

    assert controller._stage_overlay_active is True
    assert controller._stage_overlay_text == "ABC"
    assert controller._stage_overlay_sid == 7
    assert ("set_property", "sub-visibility", "yes") in commands
