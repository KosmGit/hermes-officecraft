"""Backend reads (hermes_officecraft/snapshot.py): whitelists, tolerance, and a contract test
against the real kanban schema when Hermes is importable."""

import importlib.util
import json
import sqlite3
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("officecraft_snapshot", ROOT / "hermes_officecraft" / "snapshot.py")
assert spec is not None and spec.loader is not None
snap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snap)

MINI_SCHEMA = """
CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, assignee TEXT, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER, last_heartbeat_at INTEGER, result TEXT);
CREATE TABLE task_runs (id INTEGER PRIMARY KEY, task_id TEXT, profile TEXT, status TEXT, started_at INTEGER,
  ended_at INTEGER, outcome TEXT, summary TEXT);
CREATE TABLE task_events (id INTEGER PRIMARY KEY, task_id TEXT, kind TEXT, payload TEXT, created_at INTEGER);
"""


def _board(tmp_path, schema=MINI_SCHEMA):
    db = tmp_path / "kanban.db"
    con = sqlite3.connect(db)
    con.executescript(schema)
    con.executemany("INSERT INTO tasks (id, title, body, assignee, status, created_at, started_at, last_heartbeat_at, result) VALUES (?,?,?,?,?,?,?,?,?)", [
        ("t1", "Ship it", "SECRET BODY", "builder", "running", 10, 20, 30, "SECRET RESULT"),
        ("t2", "Old", "x", None, "archived", 5, None, None, None),
        ("t3", "Blocked one", "x", "writer", "blocked", 11, None, 99, None),
    ])
    con.execute("INSERT INTO task_runs (task_id, profile, status, started_at, ended_at, outcome, summary) VALUES ('t1','builder','done',1,2,'completed','SECRET')")
    con.execute("INSERT INTO task_runs (task_id, profile, status, started_at, ended_at, outcome) VALUES ('t1','builder','x',1,3,'weird')")
    con.execute("INSERT INTO task_events (task_id, kind, payload, created_at) VALUES ('t3','blocked','{\"reason\":\"SECRET\"}',12)")
    con.execute("INSERT INTO task_events (task_id, kind, payload, created_at) VALUES ('t3','commented','SECRET',13)")
    con.commit()
    con.close()
    return db


def test_board_keeps_whitelisted_fields_only(tmp_path):
    board = snap.read_board(_board(tmp_path), "demo")
    assert [t["id"] for t in board["tasks"]] == ["t1", "t3"]   # archived card dropped
    assert "SECRET" not in json.dumps(board)
    t1, t3 = board["tasks"]
    assert t1["heartbeatAt"] == 30 and t3["heartbeatAt"] is None   # heartbeat only for running cards
    assert board["runs"] == [{"profile": "builder", "startedAt": 1, "endedAt": 2, "outcome": "completed", "task": "t1"}]   # the card of the run
    assert board["events"] == [{"task": "t3", "kind": "blocked", "ts": 12}]


def test_board_without_history_and_empty_or_missing_board(tmp_path):
    db = _board(tmp_path)
    assert snap.read_board(db, "demo", history=False)["runs"] == []
    assert snap.read_board(tmp_path / "missing.db", "ghost")["tasks"] == []
    empty = tmp_path / "e"
    empty.mkdir()
    con = sqlite3.connect(empty / "kanban.db")
    con.executescript(MINI_SCHEMA)
    con.close()
    assert snap.read_board(empty / "kanban.db", "empty") == {"slug": "empty", "createdAt": None, "tasks": [], "runs": [], "events": []}


def test_board_survives_an_older_schema(tmp_path):
    old = "CREATE TABLE tasks (id TEXT, title TEXT, status TEXT, created_at INTEGER);"
    db = tmp_path / "old.db"
    con = sqlite3.connect(db)
    con.executescript(old)
    con.execute("INSERT INTO tasks VALUES ('a','A','todo',1)")
    con.commit()
    con.close()
    board = snap.read_board(db, "old")
    assert board["tasks"][0]["assignee"] is None and board["runs"] == [] and board["events"] == []


def test_cards_carry_the_model_they_pin_and_tolerate_boards_without_the_columns(tmp_path):
    # a board without the override columns (older Hermes): fields present, None, nothing fails
    plain = snap.read_board(_board(tmp_path), "plain")
    assert all(t["modelOverride"] is None and t["providerOverride"] is None for t in plain["tasks"])
    # a board with them: exact strings, empty string = no override, only those two new keys leave the row
    sub = tmp_path / "with"
    sub.mkdir()
    db = _board(sub, MINI_SCHEMA.replace("result TEXT)", "result TEXT, model_override TEXT, provider_override TEXT, reasoning_effort TEXT)"))
    con = sqlite3.connect(db)
    con.execute("UPDATE tasks SET model_override='large', provider_override='acme', reasoning_effort='SECRET' WHERE id='t1'")
    con.execute("UPDATE tasks SET model_override='' WHERE id='t3'")
    con.commit()
    con.close()
    board = snap.read_board(db, "with", history=False)
    t1, t3 = board["tasks"]
    assert (t1["modelOverride"], t1["providerOverride"]) == ("large", "acme")   # not normalised
    assert (t3["modelOverride"], t3["providerOverride"]) == (None, None)
    assert "SECRET" not in json.dumps(board)
    assert set(t1) == {"id", "title", "status", "assignee", "createdAt", "startedAt", "completedAt", "heartbeatAt", "modelOverride", "providerOverride"}


def test_ops_whitelist_and_profile_crons(tmp_path):
    (tmp_path / "cron").mkdir()
    (tmp_path / "gateway_state.json").write_text(json.dumps({
        "gateway_state": "running", "updated_at": "2026-11-08T10:00:00+00:00", "active_agents": 1, "pid": 42,
        "platforms": {"telegram": {"state": "connected", "needs_attention": False, "token": "SECRET"}}}))
    (tmp_path / "cron" / "jobs.json").write_text(json.dumps({"jobs": [
        {"name": "digest", "enabled": True, "prompt": "SECRET", "script": "x.py", "deliver": "telegram", "last_run_at": "2026-11-08T09:00:00+00:00"},
        "junk"]}))
    ops = snap.read_ops([("default", tmp_path), ("other", tmp_path / "nope")], tmp_path)
    assert "SECRET" not in json.dumps(ops) and "pid" not in ops["gateway"]
    assert ops["gateway"]["platforms"] == [{"name": "telegram", "state": "connected", "needsAttention": False}]
    assert ops["crons"][0]["name"] == "digest" and ops["crons"][0]["profile"] == "default"
    assert isinstance(ops["crons"][0]["last_run_at"], float)
    assert snap.read_ops([], tmp_path / "nowhere") == {"gateway": None, "crons": []}


def _skill(root, rel, header):
    d = root / "skills" / rel
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text(f"---\n{header}\n---\n# Body\nSECRET INSTRUCTIONS\n")


def test_skills_read_header_only_and_shape(tmp_path):
    a, b, c = tmp_path / "a", tmp_path / "b", tmp_path / "c"
    for home in (a, b, c):
        _skill(home, "productivity/bundled-one", "name: bundled-one\ndescription: SECRET")
    _skill(a, "research/arxiv-plus", "name: arxiv-plus\ndescription: SECRET\nmetadata:\n  hermes:\n    tags: [Research, Papers]")
    _skill(a, "loose", "name: loose")
    _skill(a, ".archive/old", "name: old")
    (a / "config.yaml").write_text("skills:\n  disabled: [loose]\n")
    raw = {n: snap.read_skills(h, yaml.safe_load) for n, h in (("a", a), ("b", b), ("c", c))}
    assert "SECRET" not in json.dumps(raw)
    names = {i["name"]: i for i in raw["a"]["items"]}
    assert set(names) == {"bundled-one", "arxiv-plus", "loose"}   # dot-folders skipped
    assert names["arxiv-plus"]["category"] == "research" and names["arxiv-plus"]["tags"] == ["research", "papers"]
    assert names["loose"]["enabled"] is False and names["loose"]["category"] == ""
    shaped = snap.shape_skills(raw)
    assert shaped["a"]["enabled"] == 2 and shaped["a"]["disabled"] == 1
    assert [s["name"] for s in shaped["a"]["own"]] == ["arxiv-plus", "bundled-one"]   # small set: all enabled ones


def test_big_profiles_only_show_rare_unseeded_skills(tmp_path):
    raw = {}
    for n in "abcdef":
        items = [{"name": f"common-{i}", "category": "", "tags": [], "enabled": True, "mtime": 1} for i in range(20)]
        if n == "a":
            items.append({"name": "rare", "category": "web", "tags": [], "enabled": True, "mtime": 2})
        raw[n] = {"items": items, "bundled": ["common-0"]}
    shaped = snap.shape_skills(raw)
    assert [s["name"] for s in shaped["a"]["own"]] == ["rare"]
    assert shaped["b"]["own"] == []


def test_iso_to_epoch():
    assert snap.iso_to_epoch(None) is None and snap.iso_to_epoch("garbage") is None
    assert snap.iso_to_epoch(12) == 12.0
    from datetime import datetime, timezone
    assert snap.iso_to_epoch("2026-11-08T00:00:00+00:00") == datetime(2026, 11, 8, tzinfo=timezone.utc).timestamp()
