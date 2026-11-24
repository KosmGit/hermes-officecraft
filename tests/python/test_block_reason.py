"""The reason a bot gave when it blocked a card (``blockReason`` of ``/live``): where it is read, how it is cleaned and bounded,
and the four places it must never reach (a notification, the journal of orders, a prompt, a title or a button name)."""

import importlib.util
import json
import re
import sqlite3
import sys
import types
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
PKG = ROOT / "hermes_officecraft"
sys.path.insert(0, str(ROOT))
from hermes_officecraft import snapshot as snap   # noqa: E402  (as a package: `printable` imports its sibling)

SCHEMA = """
CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, assignee TEXT, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER, last_heartbeat_at INTEGER, result TEXT);
CREATE TABLE task_runs (id INTEGER PRIMARY KEY, task_id TEXT, profile TEXT, status TEXT, started_at INTEGER,
  ended_at INTEGER, outcome TEXT, summary TEXT);
CREATE TABLE task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, run_id INTEGER, kind TEXT, payload TEXT, created_at INTEGER);
"""


def _db(tmp_path, cards, schema=SCHEMA):
    """cards: [(id, status, [(kind, payload-or-dict), ...])]"""
    db = tmp_path / "kanban.db"
    if db.exists():
        db.unlink()   # one board per call: a test may ask for several
    con = sqlite3.connect(db)
    con.executescript(schema)
    for i, (cid, status, events) in enumerate(cards):
        con.execute("INSERT INTO tasks (id, title, assignee, status, created_at) VALUES (?, ?, 'alpha', ?, ?)", (cid, f"Card {cid}", status, 10 + i))
        for n, (kind, payload) in enumerate(events):
            con.execute("INSERT INTO task_events (task_id, kind, payload, created_at) VALUES (?, ?, ?, ?)",
                        (cid, kind, payload if isinstance(payload, str) or payload is None else json.dumps(payload), 100 + n))
    con.commit()
    con.close()
    return db


def _reason(tmp_path, reason, status="blocked"):
    db = _db(tmp_path, [("a", status, [("blocked", {"reason": reason, "kind": "needs_input"})])])
    return snap.read_board(db, "demo", history=False, reasons=True)["tasks"][0].get("blockReason", "absent")


def test_a_blocked_card_carries_the_reason_of_its_last_blocking(tmp_path):
    db = _db(tmp_path, [("a", "blocked", [("blocked", {"reason": "first try"}), ("unblocked", None), ("blocked", {"reason": "Which provider should we pick?"})])])
    assert snap.read_board(db, "demo", history=False, reasons=True)["tasks"][0]["blockReason"] == "Which provider should we pick?"


def test_no_reason_is_none_never_an_empty_string(tmp_path):
    cards = [
        ("none", "blocked", []),                                           # blocked without any event (created blocked)
        ("null", "blocked", [("blocked", {"reason": None, "kind": "needs_input"})]),
        ("blank", "blocked", [("blocked", {"reason": "  \n\t "})]),
        ("nopayload", "blocked", [("blocked", None)]),
        ("junk", "blocked", [("blocked", "not json at all")]),
        ("list", "blocked", [("blocked", "[1, 2]")]),
        ("number", "blocked", [("blocked", {"reason": 42})]),
    ]
    tasks = snap.read_board(_db(tmp_path, cards), "demo", history=False, reasons=True)["tasks"]
    assert [t["blockReason"] for t in tasks] == [None] * len(cards)


def test_only_blocked_cards_carry_the_field_and_only_on_request(tmp_path):
    db = _db(tmp_path, [("a", "blocked", [("blocked", {"reason": "Pick one"})]), ("b", "running", [("blocked", {"reason": "old news"})])])
    served = snap.read_board(db, "demo", history=False, reasons=True)["tasks"]
    assert served[0]["blockReason"] == "Pick one" and "blockReason" not in served[1]
    for kwargs in ({}, {"history": True}, {"reasons": False}):
        assert "blockReason" not in json.dumps(snap.read_board(db, "demo", **{"history": False, **kwargs}))


@pytest.mark.parametrize("hostile, expected", [
    ("Choose\u202eevil\u202c one\u2066x\u2069", "Chooseevil onex"),                    # bidi overrides and isolates
    ("zero\u200bwidth\u2060joiner\ufeff", "zerowidthjoiner"),
    ("first line\nsecond line\r\nthird\tline", "first line second line third line"),   # line breaks become a blank, words stay apart
    ("a\u2028b\u2029c\x85d", "a b c d"),
    ("bell\x07 and \x1b[31mred", "bell and [31mred"),
    ("  padded   with   blanks  ", "padded with blanks"),
])
def test_a_hostile_reason_is_cleaned_like_a_title(tmp_path, hostile, expected):
    assert _reason(tmp_path, hostile) == expected


def test_html_and_markdown_are_kept_as_text_not_interpreted(tmp_path):
    raw = "<img src=x onerror=alert(1)> [click](https://example.com) **bold**"
    assert _reason(tmp_path, raw) == raw   # the page draws text: the cleaning here is for control characters, not markup


def test_a_5000_character_reason_is_bounded_and_cut_on_a_word(tmp_path):
    out = _reason(tmp_path, "word " * 1000)
    assert len(out) <= snap.BLOCK_REASON_MAX and out.endswith("…") and out[:-1].split(" ")[-1] == "word"
    assert "word…" not in out[:-1]
    one = _reason(tmp_path, "x" * 5000)   # no blank to cut on: a hard cut, still bounded
    assert len(one) == snap.BLOCK_REASON_MAX and one.endswith("…")


def test_a_reason_that_fits_is_untouched(tmp_path):
    exact = ("a" * 79 + " ") * 3 + "b" * 40
    assert len(exact) == snap.BLOCK_REASON_MAX
    assert _reason(tmp_path, exact) == exact


def test_a_cut_never_keeps_a_dangling_blank_or_comma(tmp_path):
    out = _reason(tmp_path, ("alpha, " * 100))
    assert out.endswith("alpha…") and ", …" not in out


def test_an_older_hermes_without_events_or_columns_gives_none_without_a_flag(tmp_path):
    for schema in ("CREATE TABLE tasks (id TEXT, title TEXT, status TEXT, created_at INTEGER);",                                   # no events table
                   "CREATE TABLE tasks (id TEXT, title TEXT, status TEXT, created_at INTEGER); CREATE TABLE task_events (task_id TEXT, kind TEXT);"):   # no payload column
        db = tmp_path / "old.db"
        if db.exists():
            db.unlink()
        con = sqlite3.connect(db)
        con.executescript(schema)
        con.execute("INSERT INTO tasks VALUES ('a', 'A', 'blocked', 1)")
        con.commit()
        con.close()
        with snap.partial_scope() as flags:
            board = snap.read_board(db, "old", history=False, reasons=True)
        assert board["tasks"][0]["blockReason"] is None and not flags


def test_a_locked_or_broken_events_read_costs_the_reason_only(tmp_path):
    db = _db(tmp_path, [("a", "blocked", [("blocked", {"reason": "kept?"})])])
    con = sqlite3.connect(db)
    con.execute("DROP TABLE task_events")
    con.execute("CREATE VIEW task_events AS SELECT 1 AS task_id")   # a table that is not the one Hermes writes
    con.commit()
    con.close()
    with snap.partial_scope() as flags:
        board = snap.read_board(db, "demo", history=False, reasons=True)
    assert board["tasks"][0]["blockReason"] is None and not flags


def test_many_blocked_cards_are_read_in_chunks(tmp_path):
    cards = [(f"c{i}", "blocked", [("blocked", {"reason": f"reason {i}"})]) for i in range(950)]
    tasks = snap.read_board(_db(tmp_path, cards), "demo", history=False, reasons=True)["tasks"]
    assert [t["blockReason"] for t in tasks] == [f"reason {i}" for i in range(950)]


# ------------------------------------------------------------------ the route

@pytest.fixture
def live_client(tmp_path, monkeypatch):
    db = _db(tmp_path, [("a", "blocked", [("blocked", {"reason": "Which provider?"})]), ("b", "running", [])])

    def mod(name, **attrs):
        m = types.ModuleType(name)
        m.__dict__.update(attrs)
        monkeypatch.setitem(sys.modules, name, m)

    mod("hermes_cli")
    mod("hermes_cli.kanban_db_boards", list_boards=lambda include_archived=False: [{"slug": "demo", "db_path": str(db), "created_at": None}])
    mod("hermes_cli.profiles", list_profiles=lambda lazy_skill_count=False: [])
    mod("hermes_yaml", safe_load=lambda s: {})
    s = importlib.util.spec_from_file_location("officecraft_plugin_api_reason", ROOT / "dashboard" / "plugin_api.py")
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    app = FastAPI()
    app.include_router(m.router, prefix="/api/plugins/hermes-officecraft")
    return TestClient(app)


def test_live_serves_the_reason_and_history_does_not(live_client):
    live = live_client.get("/api/plugins/hermes-officecraft/live").json()
    tasks = {t["id"]: t for t in live["boards"][0]["tasks"]}
    assert live["ok"] is True and tasks["a"]["blockReason"] == "Which provider?" and "blockReason" not in tasks["b"]
    assert "Which provider?" not in json.dumps(live_client.get("/api/plugins/hermes-officecraft/history").json())


# ------------------------------------------------------------------ the four places it never reaches

READ = lambda name: (PKG / name).read_text(encoding="utf-8")
NAMES = re.compile(r"blockReason|block_reason|read_block_reasons|_block_reason|reasons\s*=\s*True", re.I)


def test_never_in_a_notification():
    for name in ("notify.py", "notify_format.py"):
        assert not NAMES.search(READ(name)), name
    # the facts are built from whitelisted fields: a card that carries the reason does not carry it into a fact or a message
    from hermes_officecraft import notify, notify_format   # noqa: PLC0415
    secret = "SECRET-REASON-TEXT"
    board = {"slug": "demo", "tasks": [{"id": "t1", "title": "Pick one", "status": "blocked", "assignee": "alpha", "blockReason": secret}]}
    facts = notify.detect([board], None, 1_800_000_000.0)
    assert facts and secret not in json.dumps(facts)
    rendered = [notify_format.__dict__[n](facts) for n in ("format_plain",) if n in notify_format.__dict__]
    assert secret not in json.dumps(rendered)


def test_never_in_the_journal_of_orders():
    assert not NAMES.search(READ("audit.py"))
    from hermes_officecraft import audit   # noqa: PLC0415
    kept = audit.clean({"verb": "unblock", "result": "done", "board": "demo", "task": "t1", "blockReason": "SECRET-REASON-TEXT", "reason": "SECRET-REASON-TEXT"})
    assert "SECRET-REASON-TEXT" not in json.dumps(kept)


def test_never_in_a_prompt(monkeypatch):
    assert not NAMES.search(READ("llm.py"))
    calls = []
    real = snap.hermes_boards

    def spy(**kwargs):
        calls.append(kwargs)
        return []
    from hermes_officecraft import llm, snapshot   # noqa: PLC0415
    monkeypatch.setattr(snapshot, "hermes_boards", spy)
    llm.HermesReaders().boards()
    assert calls and all(not c.get("reasons") for c in calls) and real is not None


def test_only_the_live_route_asks_for_the_reasons():
    asking = [p.name for p in PKG.glob("*.py") if re.search(r"reasons\s*=\s*True", p.read_text(encoding="utf-8"))]
    assert asking == ["api.py"]
    assert len(re.findall(r"reasons\s*=\s*True", READ("api.py"))) == 1
