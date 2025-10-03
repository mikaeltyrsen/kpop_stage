import json

import pytest

pytest.importorskip("flask")

import app as app_module


@pytest.fixture(autouse=True)
def channel_presets_tempfile(tmp_path, monkeypatch):
    temp_file = tmp_path / "channel_presets.json"
    monkeypatch.setattr(app_module, "CHANNEL_PRESETS_FILE", temp_file)
    yield temp_file


def test_get_channel_presets_returns_empty_list(channel_presets_tempfile):
    client = app_module.app.test_client()

    response = client.get("/api/channel-presets")

    assert response.status_code == 200
    assert response.get_json() == {"presets": []}
    assert not channel_presets_tempfile.exists()


def test_put_channel_presets_saves_and_returns_sanitized(channel_presets_tempfile):
    client = app_module.app.test_client()

    payload = {
        "presets": [
            {
                "id": "preset_custom",
                "name": "Front Wash",
                "channel": 0,
                "values": [
                    {"id": "value_custom", "name": "Full", "value": 999},
                    {"name": "Half", "value": 128},
                ],
            },
            {
                "name": "Back Wash",
                "channel": 20,
                "values": [],
            },
        ]
    }

    response = client.put("/api/channel-presets", json=payload)

    assert response.status_code == 200
    body = response.get_json()
    assert "presets" in body
    returned = body["presets"]
    assert isinstance(returned, list)
    assert len(returned) == 2
    first = returned[0]
    assert first["id"] == "preset_custom"
    assert first["channel"] == 1  # clamped
    assert first["values"][0]["id"] == "value_custom"
    assert first["values"][0]["value"] == 255
    assert 0 <= first["values"][1]["value"] <= 255

    assert channel_presets_tempfile.exists()
    stored = json.loads(channel_presets_tempfile.read_text(encoding="utf-8"))
    assert "presets" in stored
    assert len(stored["presets"]) == 2


def test_put_channel_presets_rejects_invalid_payload():
    client = app_module.app.test_client()

    response = client.put("/api/channel-presets", data="{}", content_type="application/json")

    assert response.status_code == 400
    assert "error" in response.get_json()
