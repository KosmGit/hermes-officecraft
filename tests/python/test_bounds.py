"""Exact values the agent half serves, so that a one-character mutant dies.

The EVENT_KINDS whitelist, the empty ``default`` board, SMALL_SKILL_SET at 12/13,
the session model bound (120), the description bound (280).
"""

import importlib.util
import sqlite3
import sys
import types
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("officecraft_snapshot_bounds", ROOT / "hermes_officecraft" / "snapshot.py")
assert spec is not None and spec.loader is not None
snap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snap)

SCHEMA = """
CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, assignee TEXT,
  created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER, last_heartbeat_at INTEGER);
CREATE TABLE task_runs (id INTEGER PRIMARY KEY, task_id TEXT, profile TEXT, status TEXT, started_at INTEGER, ended_at INTEGER, outcome TEXT);
CREATE TABLE task_events (id INTEGER PRIMARY KEY, task_id TEXT, kind TEXT, payload TEXT, created_at INTEGER);
"""

# What Hermes writes to task_events.kind that the game layer reads (review success, incidents, chains).
EXPECTED_EVENT_KINDS = {"blocked", "unblocked", "review_requested", "changes_requested", "completed", "crashed", "timed_out"}


def _db(path: Path, *, tasks=1, kinds=()):
    con = sqlite3.connect(path)
    con.executescript(SCHEMA)
    for i in range(tasks):
        con.execute("INSERT INTO tasks (id, title, status, assignee, created_at) VALUES (?, 'T', 'todo', 'a', 10)", (f"t{i}",))
    for i, kind in enumerate(kinds):
        con.execute("INSERT INTO task_events (task_id, kind, payload, created_at) VALUES ('t0', ?, 'SECRET', ?)", (kind, 100 + i))
    con.commit()
    con.close()
    return path


# ------------------------------------------------------------------ EVENT_KINDS
def test_event_kinds_are_exactly_the_expected_set_and_each_one_is_served(tmp_path):
    assert set(snap.EVENT_KINDS) == EXPECTED_EVENT_KINDS and len(snap.EVENT_KINDS) == len(EXPECTED_EVENT_KINDS)
    other = ("commented", "assigned", "edited")      # events Hermes writes that must NOT be served
    db = _db(tmp_path / "k.db", kinds=sorted(EXPECTED_EVENT_KINDS) + list(other))
    served = snap.read_board(db, "b")["events"]
    assert {e["kind"] for e in served} == EXPECTED_EVENT_KINDS
    assert len(served) == len(EXPECTED_EVENT_KINDS)
    assert all(set(e) == {"task", "kind", "ts"} for e in served)    # never the payload


# ------------------------------------------------------------------ the empty default board
@pytest.fixture
def boards(tmp_path, monkeypatch):
    def install(*entries):
        mod = types.ModuleType("hermes_cli.kanban_db_boards")
        mod.list_boards = lambda include_archived=False: [{"slug": s, "db_path": str(p), "created_at": None} for s, p in entries]
        monkeypatch.setitem(sys.modules, "hermes_cli", types.ModuleType("hermes_cli"))
        monkeypatch.setitem(sys.modules, "hermes_cli.kanban_db_boards", mod)
    return install


def test_the_empty_default_board_is_hidden_and_a_non_empty_one_is_shown(tmp_path, boards):
    empty, busy, other = _db(tmp_path / "e.db", tasks=0), _db(tmp_path / "b.db", tasks=1), _db(tmp_path / "o.db", tasks=0)
    boards(("default", empty), ("work", other))
    assert [b["slug"] for b in snap.hermes_boards()] == ["work"]       # empty default hidden, an empty OTHER board kept
    boards(("default", busy), ("work", other))
    assert [b["slug"] for b in snap.hermes_boards()] == ["default", "work"]


# ------------------------------------------------------------------ SMALL_SKILL_SET
def _items(n):
    return {"items": [{"name": f"s{i}", "category": "c", "tags": [], "enabled": True, "mtime": float(i)} for i in range(n)], "bundled": []}


def test_a_profile_with_12_skills_lists_them_all_one_with_13_does_not():
    assert snap.SMALL_SKILL_SET == 12
    # every skill is held by all three profiles: not rare, so only a short list (<= 12) shows them
    shaped = snap.shape_skills({"p12": _items(12), "p13": _items(13), "q": _items(13)})
    assert shaped["p12"]["count"] == 12 and len(shaped["p12"]["own"]) == 12
    assert shaped["p13"]["count"] == 13 and shaped["p13"]["own"] == []


# ------------------------------------------------------------------ session model and description bounds
class _Profile:
    def __init__(self, name, path, description):
        self.name, self.path, self.is_default = name, path, True
        self.model, self.provider, self.description = "m", "p", description


class _DB:
    def __init__(self, db_path=None, read_only=False):
        pass

    def list_sessions_rich(self, **_):
        return [{"id": "w", "source": "kanban", "title": "W", "last_active": 100, "started_at": 90, "model": "m" * 500}]

    def close(self):
        pass


def _fake(monkeypatch, home, description):
    def mod(name, **attrs):
        m = types.ModuleType(name)
        m.__dict__.update(attrs)
        monkeypatch.setitem(sys.modules, name, m)

    profiles = [_Profile("alice", home, description)]
    mod("hermes_yaml", safe_load=yaml.safe_load)
    mod("hermes_cli")
    mod("hermes_cli.profiles", list_profiles=lambda lazy_skill_count=False: profiles)
    mod("hermes_state", SessionDB=_DB)


def test_description_is_cut_at_280_and_the_session_model_at_120(tmp_path, monkeypatch):
    home = tmp_path / "alice"
    home.mkdir()
    for size, want in ((1000, 280), (280, 280), (279, 279)):
        _fake(monkeypatch, home, "d" * size)
        row = snap.hermes_profiles()[0]
        assert len(row["description"]) == want
    (home / "state.db").write_bytes(b"")   # the session read goes through the fake SessionDB, the file only has to exist
    sqlite3.connect(home / "state.db").close()
    row = snap.hermes_profiles()[0]
    assert row["worker"]["model"] == "m" * 120 and row["workerModel"] == "m" * 120
