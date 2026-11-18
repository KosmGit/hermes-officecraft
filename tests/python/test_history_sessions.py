"""The session read of `/history` (indexed, bounded) and `lastNonEmptySession` (the newest human
conversation that has messages), on copies of `state.db` written with the columns Hermes gives them
(`hermes_state_common.py:461-505`): no fake reader, a real SQLite file read the way the route reads it."""

import sqlite3
import sys
import time
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from hermes_officecraft import snapshot  # noqa: E402

NOW = 1_800_000_000.0
SECRET = "SECRET-DO-NOT-LEAK"

SCHEMA = """
CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, title TEXT, started_at REAL, last_activity_at REAL,
  message_count INTEGER DEFAULT 0, parent_session_id TEXT, archived INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0,
  model TEXT, input_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0, system_prompt TEXT);
CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, timestamp REAL);
CREATE INDEX idx_messages_session ON messages(session_id, timestamp);
"""


def _db(home: Path, sessions: list, messages: "dict | None" = None) -> Path:
    home.mkdir(parents=True, exist_ok=True)
    db = home / "state.db"
    con = sqlite3.connect(db)
    con.executescript(SCHEMA)
    for s in sessions:
        con.execute(
            "INSERT INTO sessions (id, source, title, started_at, last_activity_at, message_count, parent_session_id, archived, hidden,"
            " model, system_prompt) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (s["id"], s.get("source", "desktop"), s.get("title"), s.get("started", NOW - 1000), s.get("active"), s.get("count", 0),
             s.get("parent"), s.get("archived", 0), s.get("hidden", 0), s.get("model"), SECRET))
    for sid, stamps in (messages or {}).items():
        for t in stamps:
            con.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?,?,?,?)", (sid, "user", SECRET, t))
    con.commit()
    con.close()
    return db


def _refs(db: Path):
    return snapshot._session_refs(db, snapshot.listing_denied)


def test_newest_chat_is_blank_the_older_one_with_messages_is_served(tmp_path):
    """The `default` case: Hermes's newest human session is a blank chat (0 message, no title)."""
    db = _db(tmp_path / "p", [
        {"id": "blank-new", "title": None, "started": NOW - 10, "active": NOW - 10, "count": 0},
        {"id": "real-old", "title": "Fix the thing", "started": NOW - 9000, "active": NOW - 8000, "count": 42},
        {"id": "real-older", "title": "Older", "started": NOW - 20000, "active": NOW - 19000, "count": 7},
    ])
    human, worker, non_empty = _refs(db)
    assert human["title"] == "" and human["last_active"] == NOW - 10   # the blank chat is still what `lastSession` says
    assert worker is None
    assert non_empty == {"id": "real-old", "title": "Fix the thing", "last_active": NOW - 8000, "message_count": 42}


def test_newest_session_is_served_when_it_has_messages(tmp_path):
    db = _db(tmp_path / "p", [{"id": "a", "title": "A", "active": NOW - 5, "count": 3}, {"id": "b", "title": "B", "active": NOW - 50, "count": 9}])
    assert _refs(db)[2] == {"id": "a", "title": "A", "last_active": NOW - 5, "message_count": 3}


def test_no_session_with_messages_gives_null(tmp_path):
    db = _db(tmp_path / "p", [{"id": "x", "active": NOW - 5, "count": 0}, {"id": "y", "active": NOW - 6, "count": 0}])
    human, _worker, non_empty = _refs(db)
    assert human is not None and non_empty is None
    assert _refs(_db(tmp_path / "empty", []))[2] is None


def test_workers_archived_hidden_and_sub_agent_rows_are_never_the_non_empty_session(tmp_path):
    db = _db(tmp_path / "p", [
        {"id": "kanban-run", "source": "kanban", "title": "Card", "active": NOW - 1, "count": 80, "model": "m-1"},
        {"id": "tool-run", "source": "tool", "active": NOW - 2, "count": 5},
        {"id": "oneshot", "source": "oneshot", "active": NOW - 3, "count": 5},
        {"id": "archived", "title": "Gone", "active": NOW - 4, "count": 5, "archived": 1},
        {"id": "hidden", "title": "Bot mode", "active": NOW - 5, "count": 5, "hidden": 1},
        {"id": "child", "title": "Sub-agent", "active": NOW - 6, "count": 5, "parent": "real"},
        {"id": "real", "title": "The one", "active": NOW - 7000, "count": 11},
    ])
    human, worker, non_empty = _refs(db)
    assert non_empty["id"] == "real" and human["title"] == "The one"
    assert worker == {"title": "Card", "last_active": NOW - 1, "source": "kanban", "model": "m-1"}


def test_last_active_is_the_freshest_of_the_stamp_and_the_newest_message(tmp_path):
    """Heartbeats are rate-limited: `last_activity_at` can lag a newer message (`hermes_state_common.py:260`)."""
    db = _db(tmp_path / "p", [{"id": "s", "title": "S", "active": NOW - 500, "count": 2}], {"s": [NOW - 400, NOW - 30]})
    assert _refs(db)[2]["last_active"] == NOW - 30
    # a garbage double salvaged from a damaged page is not a time
    db2 = _db(tmp_path / "q", [{"id": "s", "title": "S", "active": NOW - 500, "count": 2}], {"s": [5e246]})
    assert _refs(db2)[2]["last_active"] == NOW - 500


def test_newest_is_ranked_like_hermes_by_the_freshest_of_stamp_and_message(tmp_path):
    """Hermes ranks sessions by the freshest of `last_activity_at` and the newest message
    (`_sql_session_last_active`, `hermes_state_common.py:260-275`); a heartbeat that lags (~60 s) must not make an
    older-stamped but more recently active session lose: with two running workers,
    a read by stamp alone names the wrong one."""
    db = _db(tmp_path / "p", [
        {"id": "stamp-new", "title": "Stamp newer", "started": NOW - 100, "active": NOW - 10, "count": 3},
        {"id": "msg-new", "title": "Message newer", "started": NOW - 100, "active": NOW - 40, "count": 3},
        {"id": "w-stamp", "source": "kanban", "title": "W stamp", "started": NOW - 100, "active": NOW - 10, "count": 3},
        {"id": "w-msg", "source": "kanban", "title": "W msg", "started": NOW - 100, "active": NOW - 40, "count": 3},
    ], {"stamp-new": [NOW - 20], "msg-new": [NOW - 5], "w-stamp": [NOW - 20], "w-msg": [NOW - 5]})
    human, worker, non_empty = _refs(db)
    assert human == {"title": "Message newer", "last_active": NOW - 5, "source": "desktop"}
    assert worker["title"] == "W msg" and worker["last_active"] == NOW - 5
    assert non_empty["id"] == "msg-new"


def test_the_newest_of_many_sessions_is_found_beyond_the_rerank_window(tmp_path):
    db = _db(tmp_path / "p", [{"id": f"s{n}", "title": f"T{n}", "started": NOW - 9000 + n, "active": NOW - 1000 + n * 10,
                               "count": 1} for n in range(12)])
    assert _refs(db)[2]["id"] == "s11" and _refs(db)[0]["title"] == "T11"


def test_a_garbage_message_stamp_does_not_hide_the_real_newest_message(tmp_path):
    """Hermes skips out-of-window cells inside the MAX (`hermes_state_common.py:262-268`), it does not drop the MAX."""
    db = _db(tmp_path / "p", [{"id": "s", "title": "S", "active": NOW - 500, "count": 2}], {"s": [NOW - 30, 5e246]})
    assert _refs(db)[2]["last_active"] == NOW - 30


def test_only_the_whitelisted_facts_leave_never_content_or_preview(tmp_path):
    db = _db(tmp_path / "p", [{"id": "s", "title": "T", "active": NOW - 5, "count": 4, "model": "m"}], {"s": [NOW - 5]})
    human, worker, non_empty = _refs(db)
    assert set(non_empty) == {"id", "title", "last_active", "message_count"}
    assert set(human) == {"title", "last_active", "source"}
    assert SECRET not in repr((human, worker, non_empty))


def test_session_facts_serves_the_new_field_per_bot_and_flags_nothing(tmp_path):
    roster = []
    for name, sessions in (("alice", [{"id": "b", "active": NOW - 1, "count": 0}, {"id": "r", "title": "Real", "active": NOW - 99, "count": 8}]),
                           ("bob", [{"id": "k", "source": "kanban", "active": NOW - 1, "count": 3}])):
        _db(tmp_path / name, sessions)
        roster.append(SimpleNamespace(name=name, path=tmp_path / name))
    with snapshot.partial_scope() as flags:
        facts = snapshot._session_facts(roster)
    assert snapshot.partial_list(flags) == []
    assert facts["alice"]["lastNonEmptySession"]["id"] == "r"
    assert facts["bob"]["lastNonEmptySession"] is None and facts["bob"]["worker"]["source"] == "kanban"
    assert facts["alice"]["stats"]["firstSeen"] is not None


def test_thirteen_big_stores_are_read_inside_the_budget_and_none_is_locked(tmp_path):
    """13 bots with thousands of sessions and messages each: no `locked`, and under the 0.45 s budget."""
    roster = []
    for i in range(13):
        home = tmp_path / f"b{i:02d}"
        _db(home, [])
        con = sqlite3.connect(home / "state.db")
        con.executemany("INSERT INTO sessions (id, source, title, started_at, last_activity_at, message_count) VALUES (?,?,?,?,?,?)",
                        [(f"s{n}", "cron" if n % 3 else "kanban", f"t{n}", NOW - n, NOW - n, n % 5) for n in range(5000)])
        con.executemany("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?,?,?,?)",
                        [(f"s{n % 5000}", "user", "x", NOW - n) for n in range(20000)])
        con.commit()
        con.close()
        roster.append(SimpleNamespace(name=f"b{i:02d}", path=home))
    for _ in range(3):
        t0 = time.perf_counter()
        with snapshot.partial_scope() as flags:
            facts = snapshot._session_facts(roster)
        elapsed = time.perf_counter() - t0
        assert snapshot.partial_list(flags) == [] and elapsed < snapshot.SESSIONS_BUDGET_S, elapsed
    assert all(f["lastSession"] and f["lastNonEmptySession"] for f in facts.values())


def test_unknown_schema_falls_back_to_the_hermes_reader(tmp_path, monkeypatch):
    """A store without the columns the fast read needs goes through `SessionDB.list_sessions_rich`; the non-empty
    session is then looked for in the 20 rows that reader returns."""
    db = tmp_path / "old" / "state.db"
    db.parent.mkdir()
    sqlite3.connect(db).executescript("CREATE TABLE sessions (id TEXT, source TEXT, started_at REAL);")

    class FakeDB:
        def __init__(self, db_path=None, read_only=False):
            pass

        def list_sessions_rich(self, **_):
            return [{"id": "blank", "source": "cli", "title": "", "last_active": NOW, "started_at": NOW, "message_count": 0, "preview": SECRET},
                    {"id": "real", "source": "cli", "title": "Real", "last_active": NOW - 5, "started_at": NOW - 9, "message_count": 6, "preview": SECRET}]

        def close(self):
            pass

    monkeypatch.setitem(sys.modules, "hermes_state", SimpleNamespace(SessionDB=FakeDB))
    human, worker, non_empty = snapshot._session_refs(db, snapshot.listing_denied)
    assert human["title"] == "" and worker is None
    assert non_empty == {"id": "real", "title": "Real", "last_active": NOW - 5, "message_count": 6}
    assert SECRET not in repr((human, worker, non_empty))


def test_locked_store_is_still_flagged_not_served_as_empty(tmp_path):
    db = _db(tmp_path / "p", [{"id": "s", "title": "S", "active": NOW, "count": 1}])
    writer = sqlite3.connect(db, isolation_level=None)
    writer.execute("BEGIN EXCLUSIVE")
    try:
        with snapshot.partial_scope() as flags:
            facts = snapshot._session_facts([SimpleNamespace(name="p", path=tmp_path / "p")])
        assert facts["p"]["lastSession"] is None and facts["p"]["lastNonEmptySession"] is None
        assert {"source": "sessions:p", "reason": "locked"} in snapshot.partial_list(flags)
    finally:
        writer.execute("ROLLBACK")
        writer.close()
