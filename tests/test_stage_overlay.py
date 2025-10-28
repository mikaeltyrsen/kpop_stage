import sys
from pathlib import Path
from types import MethodType, ModuleType, SimpleNamespace

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


def _enable_mpv(monkeypatch) -> None:
    monkeypatch.setattr(app.shutil, "which", lambda name: name)


def test_stage_overlay_updates_default_loop_subtitle_when_running(monkeypatch, tmp_path):
    _enable_mpv(monkeypatch)

    default_video = tmp_path / "default.mp4"
    controller = app.PlaybackController(default_video=default_video)
    controller._process = _DummyProcess()
    controller._current = controller.default_video

    commands = []

    def fake_send_ipc_command(*command):
        commands.append(command)
        return {"error": "success"}

    monkeypatch.setattr(controller, "_send_ipc_command", fake_send_ipc_command)

    controller.set_stage_code_overlay("ABC")

    subtitle_path = controller._stage_overlay_subtitle_path
    assert subtitle_path == controller.default_video.with_suffix(".ass")
    assert subtitle_path.read_text(encoding="utf-8") == "\n".join(
        [
            "[Script Info]",
            "ScriptType: v4.00+",
            "PlayResX: 1920",
            "PlayResY: 1080",
            "",
            "[V4+ Styles]",
            (
                "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
                "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
                "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
                "Alignment, MarginL, MarginR, MarginV, Encoding"
            ),
            (
                "Style: StageCode,Arial,72,&H00FFFFFF,&H000000FF,&H64000000,&H64000000,"
                "0,0,0,0,100,100,0,0,1,3,0,3,0,100,100,1"
            ),
            "",
            "[Events]",
            (
                "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, "
                "Effect, Text"
            ),
            "Dialogue: 0,0:00:00.00,9:59:59.99,StageCode,,0,0,0,,{\\an3}ABC",
            "",
        ]
    )
    assert ("sub-reload",) in commands


def test_stage_overlay_clear_removes_subtitle(monkeypatch, tmp_path):
    _enable_mpv(monkeypatch)

    default_video = tmp_path / "default.mp4"
    controller = app.PlaybackController(default_video=default_video)
    controller._process = _DummyProcess()
    controller._current = controller.default_video

    commands = []

    def fake_send_ipc_command(*command):
        commands.append(command)
        return {"error": "success"}

    monkeypatch.setattr(controller, "_send_ipc_command", fake_send_ipc_command)

    controller.set_stage_code_overlay("ABC")
    subtitle_path = controller._stage_overlay_subtitle_path
    assert subtitle_path.exists()

    controller.set_stage_code_overlay(None)

    assert not subtitle_path.exists()
    assert commands[-1] == ("sub-reload",)


def test_start_default_loop_writes_subtitle_before_playback(monkeypatch, tmp_path):
    _enable_mpv(monkeypatch)

    default_video = tmp_path / "media" / "default.mp4"
    default_video.parent.mkdir(parents=True, exist_ok=True)
    default_video.write_bytes(b"data")

    controller = app.PlaybackController(default_video=default_video)
    controller.set_stage_code_overlay("ABC")

    captured = {}

    def fake_play(self, video_path, loop, *, pre_roll_path=None):
        captured["path"] = video_path
        captured["loop"] = loop
        captured["subtitle"] = self._stage_overlay_subtitle_path.read_text(encoding="utf-8")

    monkeypatch.setattr(controller, "_play_video_locked", MethodType(fake_play, controller))

    controller._start_default_locked()

    assert captured["path"] == controller.default_video
    assert captured["loop"] is True
    assert captured["subtitle"] == "\n".join(
        [
            "[Script Info]",
            "ScriptType: v4.00+",
            "PlayResX: 1920",
            "PlayResY: 1080",
            "",
            "[V4+ Styles]",
            (
                "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
                "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
                "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
                "Alignment, MarginL, MarginR, MarginV, Encoding"
            ),
            (
                "Style: StageCode,Arial,72,&H00FFFFFF,&H000000FF,&H64000000,&H64000000,"
                "0,0,0,0,100,100,0,0,1,3,0,3,0,100,100,1"
            ),
            "",
            "[Events]",
            (
                "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, "
                "Effect, Text"
            ),
            "Dialogue: 0,0:00:00.00,9:59:59.99,StageCode,,0,0,0,,{\\an3}ABC",
            "",
        ]
    )


def test_mpv_player_defaults_enable_subtitles(monkeypatch, tmp_path):
    _enable_mpv(monkeypatch)

    controller = app.PlaybackController(default_video=tmp_path / "default.mp4")

    assert "--sid=auto" in controller._base_command
    assert "--sub-visibility=yes" in controller._base_command
    assert "--sub-ass-override=no" in controller._base_command


def test_non_mpv_player_does_not_receive_subtitle_flags(monkeypatch, tmp_path):
    _enable_mpv(monkeypatch)

    controller = app.PlaybackController(
        default_video=tmp_path / "default.mp4",
        player_command=["vlc", "--fullscreen"],
    )

    assert "--sid=auto" not in controller._base_command
    assert "--sub-visibility=yes" not in controller._base_command
    assert "--sub-ass-override=no" not in controller._base_command
