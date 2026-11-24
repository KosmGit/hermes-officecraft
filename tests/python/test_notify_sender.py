"""The sender of Hermes moved from ``tools.send_message_tool`` to ``gateway.outbound.send``: both homes are tried, and a
send that cannot even be imported is written to the log by its class name."""
import json
import logging
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from hermes_officecraft import notify as N  # noqa: E402


def _module(name, calls, ok=True):
    mod = types.ModuleType(name)
    mod.send_message_tool = lambda args, **kw: calls.append((name, args)) or json.dumps({"success": ok})
    return mod


def _install(monkeypatch, name, calls, ok=True):
    parts = name.split(".")
    for i in range(1, len(parts)):
        pkg = ".".join(parts[:i])
        monkeypatch.setitem(sys.modules, pkg, types.ModuleType(pkg))
    monkeypatch.setitem(sys.modules, name, _module(name, calls, ok))


def _forbid(monkeypatch, name):
    monkeypatch.setitem(sys.modules, name, None)   # ``None`` in sys.modules makes the import raise ImportError


def test_the_new_home_of_the_sender_is_used_first(monkeypatch):
    calls = []
    _install(monkeypatch, "gateway.outbound.send", calls)
    _install(monkeypatch, "tools.send_message_tool", calls)
    assert N.hermes_send("telegram:1", "hello") == {"success": True, "error": None}
    assert calls == [("gateway.outbound.send", {"action": "send", "target": "telegram:1", "message": "hello"})]


def test_an_older_hermes_still_sends_through_the_old_home(monkeypatch):
    calls = []
    _forbid(monkeypatch, "gateway.outbound.send")
    _install(monkeypatch, "tools.send_message_tool", calls, ok=False)
    assert N.hermes_send("telegram:1", "hello") == {"success": False, "error": "send_failed"}
    assert [c[0] for c in calls] == ["tools.send_message_tool"]


def test_no_sender_at_all_raises_an_import_error(monkeypatch):
    _forbid(monkeypatch, "gateway.outbound.send")
    _forbid(monkeypatch, "tools.send_message_tool")
    with pytest.raises(ImportError):
        N.hermes_send("telegram:1", "hello")


def test_a_send_that_raises_is_logged_by_class_name_only():
    import inspect
    src = inspect.getsource(N.Notifier)
    assert 'log.warning("hermes-officecraft notification not sent: %s", type(exc).__name__)' in src
