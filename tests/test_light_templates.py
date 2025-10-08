import pytest


pytest.importorskip("flask")

from app import sanitize_template_row


def test_sanitize_template_row_action_includes_type_and_fields():
    result = sanitize_template_row(
        {
            "id": "row_action",
            "type": "action",
            "channel": 42,
            "value": 200,
            "fade": 1.25,
            "channelPresetId": "preset-1",
            "valuePresetId": "value-1",
        }
    )

    assert result == {
        "id": "row_action",
        "type": "action",
        "channel": 42,
        "value": 200,
        "fade": 1.25,
        "channelPresetId": "preset-1",
        "valuePresetId": "value-1",
    }


def test_sanitize_template_row_delay_preserves_duration():
    result = sanitize_template_row({"id": "row_delay", "type": "delay", "duration": "2.5"})

    assert result == {"id": "row_delay", "type": "delay", "duration": 2.5}


def test_sanitize_template_row_infers_delay_type_when_missing():
    result = sanitize_template_row({"id": "row_delay", "duration": 3})

    assert result == {"id": "row_delay", "type": "delay", "duration": 3.0}


def test_sanitize_template_row_master_preserves_primary_fields():
    result = sanitize_template_row(
        {
            "id": "row_master",
            "channel": 5,
            "value": 120,
            "channelMasterId": "master-1",
            "master": {
                "color": "#123456",
                "brightness": "200",
                "white": 150,
                "sliders": {"custom": "90"},
                "dropdownSelections": {"Mode": "Pulse"},
            },
        }
    )

    assert result == {
        "id": "row_master",
        "type": "action",
        "channel": 5,
        "value": 120,
        "fade": 0.0,
        "channelPresetId": None,
        "valuePresetId": None,
        "channelMasterId": "master-1",
        "master": {
            "id": "master-1",
            "color": "#123456",
            "brightness": 200,
            "white": 150,
            "sliders": {"custom": 90, "brightness": 200, "white": 150},
            "dropdownSelections": {"mode": "Pulse"},
        },
    }


def test_sanitize_template_row_master_extracts_brightness_from_sliders():
    result = sanitize_template_row(
        {
            "id": "row_master_slider",
            "channel": 7,
            "value": 0,
            "fade": 1.0,
            "channelMasterId": "master-2",
            "master": {
                "sliders": {"Brightness": "85", "WHITE": 210, "Extra": 33}
            },
        }
    )

    assert result["master"] == {
        "id": "master-2",
        "color": "#ffffff",
        "brightness": 85,
        "white": 210,
        "sliders": {"brightness": 85, "white": 210, "extra": 33},
    }
