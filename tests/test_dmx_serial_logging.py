import logging
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import dmx


class _DummySerial:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.break_condition = False
        self.is_open = True
        self.written = []

    def close(self):
        self.is_open = False

    def write(self, payload):
        self.written.append(payload)

    def flush(self):
        pass


@pytest.fixture
def serial_stub(monkeypatch):
    stub = types.SimpleNamespace(
        Serial=_DummySerial,
        EIGHTBITS=8,
        PARITY_NONE="N",
        STOPBITS_TWO=2,
    )
    original = dmx.serial
    monkeypatch.setattr(dmx, "serial", stub)
    yield stub
    monkeypatch.setattr(dmx, "serial", original)


def _make_output(monkeypatch, caplog, **env):
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    caplog.set_level(logging.DEBUG, logger=dmx.LOGGER.name)
    caplog.clear()
    output = dmx.DMXOutput()
    return output


def test_serial_info_logged_on_success(monkeypatch, caplog, serial_stub):
    monkeypatch.delenv("DMX_SERIAL_NUMBER", raising=False)
    output = _make_output(monkeypatch, caplog, DMX_SERIAL_PORT="/dev/test")
    try:
        messages = [record.getMessage() for record in caplog.records]
        assert any(
            "Using DMX serial port /dev/test for DMX output" in message
            for message in messages
        )
    finally:
        output.shutdown()
        monkeypatch.delenv("DMX_SERIAL_PORT", raising=False)


def test_serial_info_not_logged_on_failure(monkeypatch, caplog):
    class _FailingSerial:
        def __init__(self, **kwargs):
            raise OSError("serial port missing")

    stub = types.SimpleNamespace(
        Serial=_FailingSerial,
        EIGHTBITS=8,
        PARITY_NONE="N",
        STOPBITS_TWO=2,
    )
    monkeypatch.setattr(dmx, "serial", stub)

    output = _make_output(monkeypatch, caplog, DMX_SERIAL_PORT="/dev/missing")
    try:
        messages = [record.getMessage() for record in caplog.records]
        assert not any(
            "Using DMX serial port /dev/missing for DMX output" in message
            for message in messages
        )
        assert any(
            "Unable to open DMX serial port /dev/missing" in message
            for message in messages
        )
    finally:
        output.shutdown()
        monkeypatch.delenv("DMX_SERIAL_PORT", raising=False)
