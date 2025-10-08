import json

import pytest

pytest.importorskip("flask")

import app as app_module


@pytest.fixture(autouse=True)
def color_presets_tempfile(tmp_path, monkeypatch):
    temp_file = tmp_path / "color_presets.json"
    monkeypatch.setattr(app_module, "COLOR_PRESETS_FILE", temp_file)
    yield temp_file


def test_get_color_presets_returns_defaults(color_presets_tempfile):
    client = app_module.app.test_client()

    response = client.get("/api/color-presets")

    assert response.status_code == 200
    body = response.get_json()
    assert "presets" in body
    presets = body["presets"]
    assert isinstance(presets, list)
    assert presets
    first = presets[0]
    assert set(first.keys()) == {"id", "name", "iconColor", "red", "green", "blue"}
    assert not color_presets_tempfile.exists()


def test_put_color_presets_sanitizes_and_saves(color_presets_tempfile):
    client = app_module.app.test_client()

    payload = {
        "presets": [
            {
                "id": "color_custom",
                "name": "Custom",
                "iconColor": "not-a-color",
                "red": 999,
                "green": -5,
                "blue": 20,
            },
            {
                "name": "Secondary",
                "rgb": {"r": 10, "g": 20, "b": 30},
                "iconColor": "#abc",
            },
        ]
    }

    response = client.put("/api/color-presets", json=payload)

    assert response.status_code == 200
    data = response.get_json()
    presets = data["presets"]
    assert isinstance(presets, list)
    assert len(presets) == 2

    first, second = presets
    assert first["id"] == "color_custom"
    assert first["red"] == 255
    assert first["green"] == 0
    assert first["blue"] == 20
    assert first["iconColor"] == "#ff0014"

    assert second["red"] == 10
    assert second["green"] == 20
    assert second["blue"] == 30
    assert second["iconColor"] == "#aabbcc"

    assert color_presets_tempfile.exists()
    stored = json.loads(color_presets_tempfile.read_text(encoding="utf-8"))
    assert "presets" in stored
    assert len(stored["presets"]) == 2
