import pytest

pytest.importorskip("flask")

from app import _mpv_flag_is_true


def test_mpv_flag_handles_boolean_inputs():
    assert _mpv_flag_is_true(True) is True
    assert _mpv_flag_is_true(False) is False


def test_mpv_flag_handles_string_responses():
    assert _mpv_flag_is_true("yes") is True
    assert _mpv_flag_is_true("no") is False
    assert _mpv_flag_is_true("TRUE") is True
    assert _mpv_flag_is_true("false") is False
    assert _mpv_flag_is_true("On") is True
    assert _mpv_flag_is_true("off") is False


def test_mpv_flag_handles_numeric_strings_and_values():
    assert _mpv_flag_is_true("1") is True
    assert _mpv_flag_is_true("0") is False
    assert _mpv_flag_is_true(1) is True
    assert _mpv_flag_is_true(0) is False
    assert _mpv_flag_is_true(2) is True
    assert _mpv_flag_is_true(0.0) is False
    assert _mpv_flag_is_true("0.0") is False
    assert _mpv_flag_is_true("2.5") is True


def test_mpv_flag_falls_back_to_python_truthiness():
    class Something:
        def __bool__(self):
            return True

    assert _mpv_flag_is_true(Something()) is True
    assert _mpv_flag_is_true(None) is False
