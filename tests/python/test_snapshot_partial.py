"""The contract with Hermes and the robustness of the agent half: what is served when a source fails,
and the `partial` field that says so.
"""

import importlib
import importlib.util
import sqlite3
import sys
import time
import types
from pathlib import Path

import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]


def _snap():
    """The snapshot module the mounted route really uses (private name, like tests/python/test_history.py: no second copy under another name)."""
    _client()
    return importlib.import_module("_officecraft_http.snapshot")


SCHEMA = """
CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, assignee TEXT,
  created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER, last_heartbeat_at INTEGER);
CREATE TABLE task_runs (id INTEGER PRIMARY KEY, task_id TEXT, profile TEXT, status TEXT, started_at INTEGER, ended_at INTEGER, outcome TEXT);
CREATE TABLE task_events (id INTEGER PRIMARY KEY, task_id TEXT, kind TEXT, created_at INTEGER);
"""


def _board_db(path: Path, *, with_task: bool = True, after=None) -> Path:
    con = sqlite3.connect(path)
    con.executescript(SCHEMA)
    if with_task:
        con.execute("INSERT INTO tasks (id, title, status, assignee, created_at) VALUES ('t1', 'Ship it', 'running', 'alice', 10)")
    if after:
        after(con)
    con.commit()
    con.close()
    return path


# ------------------------------------------------------------------ boards and sources: `partial`
def _partial_of(read):
    """Run ``read()`` inside a partial scope: (its value, what it flagged)."""
    snap = _snap()
    with snap.partial_scope() as flags:
        value = read()
    return value, list(flags)


def _registry(monkeypatch, *boards):
    import hermes_cli.kanban_db_boards as reg
    monkeypatch.setattr(reg, "list_boards", lambda include_archived=False: [
        {"slug": slug, "db_path": str(path), "created_at": None} for slug, path in boards])


def _drift(path):
    return _board_db(path, after=lambda c: c.execute("ALTER TABLE tasks RENAME COLUMN status TO state"))


def test_schema_drift_is_not_an_empty_board(tmp_path):
    """A board whose tasks table no longer matches Hermes is flagged `schema`; a healthy empty board is not."""
    snap = _snap()
    _, healthy = _partial_of(lambda: snap.read_board(_board_db(tmp_path / "empty.db", with_task=False), "b"))
    _, drifted = _partial_of(lambda: snap.read_board(_drift(tmp_path / "drift.db"), "b"))
    assert healthy == []
    assert drifted == [{"source": "kanban:b", "reason": "schema"}]


def test_absent_board_file_is_flagged_missing(tmp_path):
    snap = _snap()
    board, flags = _partial_of(lambda: snap.read_board(tmp_path / "gone.db", "b"))
    assert board["tasks"] == []
    assert flags == [{"source": "kanban:b", "reason": "missing"}]


def test_locked_board_copy_is_flagged_locked(tmp_path, monkeypatch):
    """A copy of a board held by an exclusive writer: the read gives up after its short timeout and says `locked`."""
    snap = _snap()
    _fake_hermes(tmp_path, monkeypatch)
    copy = _board_db(tmp_path / "copy.db")
    _registry(monkeypatch, ("main", copy))
    monkeypatch.setattr(snap, "DB_TIMEOUT_S", 0.05)
    holder = sqlite3.connect(copy, isolation_level=None)
    holder.execute("BEGIN EXCLUSIVE")
    try:
        _, flags = _partial_of(lambda: snap.hermes_boards(history=False))
    finally:
        holder.close()
    assert flags == [{"source": "kanban:main", "reason": "locked"}]


def test_garbage_board_file_is_flagged_unreadable_and_never_leaks_the_error(tmp_path, monkeypatch):
    snap = _snap()
    _fake_hermes(tmp_path, monkeypatch)
    (tmp_path / "kanban.db").write_bytes(b"not a sqlite file" * 400)
    _, flags = _partial_of(lambda: snap.hermes_boards(history=False))
    assert flags == [{"source": "kanban:main", "reason": "unreadable"}]
    assert str(tmp_path) not in str(flags)


def test_live_and_history_always_carry_partial(tmp_path, monkeypatch):
    _fake_hermes(tmp_path, monkeypatch)
    for route in ("live", "history"):
        body = _get(route)
        assert body["ok"] is True and body["partial"] == [], route


def test_live_names_the_broken_boards_and_still_serves_the_others(tmp_path, monkeypatch):
    _fake_hermes(tmp_path, monkeypatch)
    _registry(monkeypatch, ("main", tmp_path / "kanban.db"), ("old", _drift(tmp_path / "drift2.db")), ("gone", tmp_path / "gone.db"))
    body = _get("live")
    assert {b["slug"] for b in body["boards"]} == {"main", "old", "gone"}
    assert body["partial"] == [{"source": "kanban:gone", "reason": "missing"}, {"source": "kanban:old", "reason": "schema"}]


def test_failed_source_is_flagged_not_served_as_empty(tmp_path, monkeypatch):
    """A failing source is served as [], and the answer says so (`profiles`), without the error text."""
    _fake_hermes(tmp_path, monkeypatch, denied=False)
    snap = _snap()
    monkeypatch.setattr(snap, "hermes_profiles", lambda **_: (_ for _ in ()).throw(RuntimeError("/secret/path boom")))
    body = _get("history")
    assert body["ok"] is True and body["profiles"] == []
    assert body["partial"] == [{"source": "profiles", "reason": "unreadable"}]
    assert "secret" not in str(body) and "boom" not in str(body)


def test_failing_cron_history_is_flagged(tmp_path, monkeypatch):
    _fake_hermes(tmp_path, monkeypatch)
    snap = _snap()
    monkeypatch.setattr(snap, "hermes_cron_runs", lambda: (_ for _ in ()).throw(RuntimeError("locked")))
    body = _get("history")
    assert body["ok"] is True and body["crons"] == []
    assert body["partial"] == [{"source": "cron", "reason": "unreadable"}]


def test_every_source_failing_is_still_ok_false_with_an_empty_partial(tmp_path, monkeypatch):
    _fake_hermes(tmp_path, monkeypatch)
    import hermes_cli.kanban_db_boards as reg
    monkeypatch.setattr(reg, "list_boards", lambda include_archived=False: (_ for _ in ()).throw(RuntimeError("x")))
    monkeypatch.delitem(sys.modules, "hermes_constants")   # no gateway home: ops fails too
    body = _get("live")
    assert body["ok"] is False and body["partial"] == []


def test_locked_cron_history_copy_is_flagged_locked(tmp_path, monkeypatch):
    snap = _snap()
    monkeypatch.setattr(snap, "DB_TIMEOUT_S", 0.05)
    home = tmp_path / "home"
    (home / "cron").mkdir(parents=True)
    (home / "cron" / "jobs.json").write_text('{"jobs": [{"id": "j1", "name": "nightly"}]}')
    db = home / "cron" / "executions.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE executions (job_id TEXT, status TEXT, finished_at TEXT, claimed_at TEXT)")
    con.commit()
    con.close()
    holder = sqlite3.connect(db, isolation_level=None)
    holder.execute("BEGIN EXCLUSIVE")
    try:
        _, flags = _partial_of(lambda: snap.read_cron_runs("p", home))
    finally:
        holder.close()
    assert flags == [{"source": "cron:p", "reason": "locked"}]


def test_cron_history_schema_drift_and_garbage_jobs_file(tmp_path):
    snap = _snap()
    home = tmp_path / "home"
    (home / "cron").mkdir(parents=True)
    (home / "cron" / "jobs.json").write_text("{not json")
    con = sqlite3.connect(home / "cron" / "executions.db")
    con.execute("CREATE TABLE executions (job_id TEXT, state TEXT)")
    con.commit()
    con.close()
    _, flags = _partial_of(lambda: (snap.read_crons(home / "cron" / "jobs.json", "p"), snap.read_cron_runs("p", home)))
    assert snap.partial_list(flags) == [{"source": "cron:p", "reason": "unreadable"}, {"source": "cron:p", "reason": "schema"}]


def test_gateway_state_missing_and_garbage(tmp_path):
    snap = _snap()
    _, gone = _partial_of(lambda: snap.read_gateway(tmp_path / "gateway_state.json"))
    (tmp_path / "gateway_state.json").write_text("{nope")
    _, broken = _partial_of(lambda: snap.read_gateway(tmp_path / "gateway_state.json"))
    assert gone == [{"source": "gateway", "reason": "missing"}]
    assert broken == [{"source": "gateway", "reason": "unreadable"}]


def test_no_scope_no_flags_no_error(tmp_path):
    """Called outside a route (a script): flagging is a no-op."""
    snap = _snap()
    assert snap.read_board(tmp_path / "gone.db", "b")["tasks"] == []


def test_flag_keeps_the_closed_vocabulary(tmp_path):
    """An unknown reason, a path or a free text as source is dropped, never served."""
    snap = _snap()
    _, flags = _partial_of(lambda: (snap.flag("kanban:b", "exploded"), snap.flag(str(tmp_path / "kanban.db"), "missing"),
                                    snap.flag("Kanban b", "missing"), snap.flag("kanban:b", "missing")))
    assert flags == [{"source": "kanban:b", "reason": "missing"}]


def test_bots_left_out_by_the_session_budget_are_flagged_locked(tmp_path, monkeypatch):
    """A bot whose sessions were not read because the phase ran out of time is not "no session"."""
    snap = _snap()
    names = tuple(f"bot{i:02d}" for i in range(6))
    _fake_hermes(tmp_path, monkeypatch, names=names)
    monkeypatch.setattr(snap, "_SLOW_SESSIONS", {})
    monkeypatch.setattr(snap, "SESSIONS_BUDGET_S", 0.05)
    monkeypatch.setattr(snap, "SESSION_PER_BOT_S", 0.0)
    monkeypatch.setattr(snap, "SESSIONS_GRACE_S", 0.0)   # no late slot, so the tail really is left out
    _DB.delay = 0.03                       # two bots fit in the budget, the others are left out
    body = _get("history")
    lost = {p["name"] for p in body["profiles"] if not p["lastSession"]}
    assert len(lost) >= 3, lost
    for name in lost:
        assert {"source": f"sessions:{name}", "reason": "locked"} in body["partial"], name


def test_bot_in_its_slow_skip_window_is_flagged_locked(tmp_path, monkeypatch):
    """A state.db left alone for a while after missing its slot is named, not served as empty."""
    snap = _snap()
    profiles = _fake_hermes(tmp_path, monkeypatch, names=("alice", "bob"))
    key = str((Path(profiles[0].path) / "state.db").resolve())
    monkeypatch.setattr(snap, "_SLOW_SESSIONS", {key: time.time() + 60})
    body = _get("history")
    assert _bot(body, "alice")["lastSession"] is None and _bot(body, "bob")["lastSession"]
    assert body["partial"] == [{"source": "sessions:alice", "reason": "locked"}]


# ------------------------------------------------------------------ fake Hermes (same shape as tests/python/test_history.py)
class FakeProfile:
    def __init__(self, name, path, default=False):
        self.name, self.path, self.is_default = name, path, default
        self.model, self.provider, self.description = "m", "p", f"{name} does things."
        self.skill_count = 0


class _DB:
    rows: list = []
    delay = 0.0
    fail = False

    def __init__(self, db_path=None, read_only=False):
        if type(self).fail:
            raise RuntimeError("state.db unreadable")

    def list_sessions_rich(self, **_):
        time.sleep(type(self).delay)
        return type(self).rows

    def close(self):
        pass


def _fake_hermes(tmp_path, monkeypatch, names=("alice", "bob"), denied=True, hermes_home=True):
    for name in names:
        home = tmp_path / "profiles" / name
        home.mkdir(parents=True)
        con = sqlite3.connect(home / "state.db")
        con.execute("CREATE TABLE sessions (id TEXT, source TEXT, started_at REAL, input_tokens INTEGER, cache_read_tokens INTEGER)")
        con.execute("INSERT INTO sessions VALUES ('s1', 'cli', 1000, 5, 1)")
        con.commit()
        con.close()
    board = _board_db(tmp_path / "kanban.db")
    (tmp_path / "gateway_state.json").write_text('{"gateway_state": "running", "platforms": {}}')   # a healthy gateway: no `partial`

    def mod(name, **attrs):
        m = types.ModuleType(name)
        m.__dict__.update(attrs)
        monkeypatch.setitem(sys.modules, name, m)

    profiles = [FakeProfile(n, tmp_path / "profiles" / n, i == 0) for i, n in enumerate(names)]
    mod("hermes_yaml", safe_load=yaml.safe_load)
    mod("hermes_cli")
    mod("hermes_cli.profiles", list_profiles=lambda lazy_skill_count=False: profiles)
    mod("hermes_cli.kanban_db_boards", list_boards=lambda include_archived=False: [{"slug": "main", "db_path": str(board), "created_at": None}])
    mod("hermes_state", SessionDB=_DB)
    mod("tui_gateway")
    mod("tui_gateway.methods_session", **({"_denied_source": lambda row: row.get("source") == "kanban"} if denied else {}))
    mod("hermes_constants", **({"get_hermes_home": lambda: tmp_path} if hermes_home else {}))
    _DB.rows = [{"id": "s1", "source": "cli", "title": "t", "last_active": 1000, "started_at": 900}]
    _DB.delay, _DB.fail = 0.0, False
    return profiles


def _client():
    spec = importlib.util.spec_from_file_location("partial_plugin_api", ROOT / "dashboard" / "plugin_api.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    app = FastAPI()
    app.include_router(module.router, prefix="/api/plugins/hermes-officecraft")
    return TestClient(app)


def _get(route):
    return _client().get(f"/api/plugins/hermes-officecraft/{route}").json()


def _bot(body, name):
    return next(p for p in body["profiles"] if p["name"] == name)


# ------------------------------------------------------------------ sessions and boards that cannot be read
def test_unreadable_sessions_differ_from_no_sessions(tmp_path, monkeypatch):
    """A bot whose state.db could not be read is named in `partial`; a bot with no session is not."""
    _fake_hermes(tmp_path, monkeypatch)
    _DB.rows, _DB.fail = [], False
    quiet = _get("history")                           # readable, simply no session
    _DB.fail = True
    broken = _get("history")                          # read failed
    assert quiet["partial"] == []
    assert broken["partial"] == [{"source": "sessions:alice", "reason": "unreadable"}, {"source": "sessions:bob", "reason": "unreadable"}]


def test_slow_state_db_is_flagged_locked(tmp_path, monkeypatch):
    snap = _snap()
    _fake_hermes(tmp_path, monkeypatch, names=("alice",))
    monkeypatch.setattr(snap, "SESSION_READ_TIMEOUT_S", 0.02)
    _DB.delay = 0.3
    body = _get("history")
    assert {"source": "sessions:alice", "reason": "locked"} in body["partial"]


def test_damaged_state_db_aggregates_are_flagged(tmp_path, monkeypatch):
    snap = _snap()
    profiles = _fake_hermes(tmp_path, monkeypatch, names=("alice",))
    db = Path(profiles[0].path) / "state.db"
    db.write_bytes(b"garbage" * 600)
    _, flags = _partial_of(lambda: snap.session_stats(db, source="sessions:alice"))
    assert flags == [{"source": "sessions:alice", "reason": "unreadable"}]


def test_unreadable_board_is_not_silently_absent(tmp_path, monkeypatch):
    """A board file that cannot be opened is named in `partial` (it is not served, and not silent either)."""
    _fake_hermes(tmp_path, monkeypatch)
    (tmp_path / "kanban.db").write_bytes(b"not a sqlite file" * 400)
    body = _get("live")
    assert body["boards"] == []
    assert body["partial"] == [{"source": "kanban:main", "reason": "unreadable"}]


# ------------------------------------------------------------------ one failing source
def test_history_survives_missing_private_symbol(tmp_path, monkeypatch):
    _fake_hermes(tmp_path, monkeypatch, denied=False)
    body = _get("history")
    assert body["ok"] is True            # roles, skills, runs and events do not need the human/worker split
    assert body["boards"]
    # a failing profiles source is served as [] with ok:true: the bots and their human session must survive
    assert [p["name"] for p in body["profiles"]] == ["alice", "bob"]
    assert all(p["lastSession"] for p in body["profiles"])


def test_live_keeps_boards_when_ops_fails(tmp_path, monkeypatch):
    _fake_hermes(tmp_path, monkeypatch, hermes_home=False)
    body = _get("live")
    assert body["ok"] is True
    assert body["boards"]


# ------------------------------------------------------------------ timestamps
def test_text_epoch_is_normalised_like_hermes(tmp_path):
    db = _board_db(tmp_path / "t.db", after=lambda c: c.execute("UPDATE tasks SET created_at='2026-11-01T10:00:00+00:00'"))
    card = _snap().read_board(db, "b")["tasks"][0]
    assert isinstance(card["createdAt"], (int, float))

def test_numeric_text_and_garbage_like_hermes(tmp_path):
    db = _board_db(tmp_path / "t.db", after=lambda c: c.execute(
        "UPDATE tasks SET created_at='1700000000', started_at='not a date', completed_at=1700000100.9, last_heartbeat_at=''"))
    card = _snap().read_board(db, "b")["tasks"][0]
    assert card["createdAt"] == 1700000000 and card["startedAt"] is None
    assert card["completedAt"] == 1700000100 and card["heartbeatAt"] is None


# ------------------------------------------------------------------ bundled manifest
def test_binary_bundled_manifest_costs_nothing(tmp_path, monkeypatch):
    profiles = _fake_hermes(tmp_path, monkeypatch)
    skills = Path(profiles[0].path) / "skills"
    skills.mkdir()
    (skills / ".bundled_manifest").write_bytes(b"\xff\xfe\x00\x01")
    body = _get("history")
    assert body["ok"] is True
    # a failing profiles source is served as [] with ok:true: the bots themselves must still be there
    assert [p["name"] for p in body["profiles"]] == ["alice", "bob"]


# ------------------------------------------------------------------ skills and crons
def test_disabled_skill_is_matched_by_declared_name(tmp_path):
    home = tmp_path / "p"
    d = home / "skills" / "folder-name"
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text("---\nname: declared-name\n---\nbody\n")
    (home / "config.yaml").write_text("skills:\n  disabled: [declared-name]\n")
    items = _snap().read_skills(home, yaml.safe_load)["items"]
    assert items[0]["enabled"] is False


def test_cron_schedule_display_falls_back_like_hermes(tmp_path):
    f = tmp_path / "jobs.json"
    f.write_text('{"jobs": [{"name": "nightly", "enabled": true, "schedule": {"display": "every 1h"}}]}')
    assert _snap().read_crons(f, "default")[0]["schedule_display"] == "every 1h"

def test_cron_without_a_name_is_labelled_without_reading_its_prompt(tmp_path):
    f = tmp_path / "jobs.json"
    f.write_text('{"jobs": [{"id": "j-1", "prompt": "SECRET-PROMPT", "schedule": "0 3 * * *"},'
                 ' {"id": "j-2", "skills": ["digest"], "schedule_display": "daily"}]}')
    jobs = _snap().read_crons(f, "default")
    assert [j["name"] for j in jobs] == ["j-1", "digest"]
    assert jobs[0]["schedule_display"] == "0 3 * * *" and jobs[1]["schedule_display"] == "daily"
    assert "SECRET-PROMPT" not in str(jobs)


# ------------------------------------------------------------------ session budget
def test_session_budget_scales_with_the_roster(tmp_path, monkeypatch):
    names = tuple(f"bot{i:02d}" for i in range(60))
    _fake_hermes(tmp_path, monkeypatch, names=names)
    _DB.delay = 0.012            # ~ the measured warm cost of one real state.db read (7-13 ms)
    body = _get("history")
    assert body["ok"] is True
    assert all(p["lastSession"] for p in body["profiles"])


def test_the_starting_bot_rotates(tmp_path, monkeypatch):
    """Under a tight budget the bots that lose their session facts are not always the same ones."""
    snap = _snap()
    names = tuple(f"bot{i:02d}" for i in range(6))
    _fake_hermes(tmp_path, monkeypatch, names=names)
    monkeypatch.setattr(snap, "SESSIONS_BUDGET_S", 0.05)
    monkeypatch.setattr(snap, "SESSION_PER_BOT_S", 0.0)
    monkeypatch.setattr(snap, "SESSIONS_GRACE_S", 0.0)   # no late slot, so the tail really is left out
    _DB.delay = 0.03                       # two bots fit in the budget, the others are skipped
    lost = []
    for _ in range(3):
        body = _get("history")
        lost.append({p["name"] for p in body["profiles"] if not p["lastSession"]})
    assert len({frozenset(s) for s in lost}) > 1, lost
