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
