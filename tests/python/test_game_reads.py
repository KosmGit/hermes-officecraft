"""Achievements: the three small reads the game needs, whitelisted and tolerant.
- boards[].links      parent -> child card ids from `task_links`, only between served (non-archived) cards
- boards[].runs[].task  the card id of a run (`task_runs.task_id`)
- crons               outcome history of each cron job (`<profile>/cron/executions.db`, table `executions`): job name, time, ok flag
Nothing else of a card, a run or an execution leaves the process (no error text, no output file, no prompt)."""

import importlib.util
import json
import sqlite3
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("officecraft_snapshot_game", ROOT / "hermes_officecraft" / "snapshot.py")
assert spec is not None and spec.loader is not None
snap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snap)

SCHEMA = """
CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, assignee TEXT, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER, last_heartbeat_at INTEGER, result TEXT);
CREATE TABLE task_runs (id INTEGER PRIMARY KEY, task_id TEXT, profile TEXT, status TEXT, started_at INTEGER,
  ended_at INTEGER, outcome TEXT, summary TEXT, error TEXT);
CREATE TABLE task_events (id INTEGER PRIMARY KEY, task_id TEXT, kind TEXT, payload TEXT, created_at INTEGER);
CREATE TABLE task_links (parent_id TEXT NOT NULL, child_id TEXT NOT NULL, PRIMARY KEY (parent_id, child_id));
"""


def _board(tmp_path, schema=SCHEMA, links=True, run_col="task_id"):
    db = tmp_path / "kanban.db"
    con = sqlite3.connect(db)
    con.executescript(schema)
    con.executemany("INSERT INTO tasks (id, title, status, created_at) VALUES (?,?,?,?)",
                    [("a", "Card A", "done", 1), ("b", "Card B", "done", 2), ("c", "Card C", "running", 3), ("z", "old", "archived", 0)])
    con.execute(f"INSERT INTO task_runs ({run_col}, profile, status, started_at, ended_at, outcome, summary, error) VALUES ('a','bot','done',1,2,'completed','SECRET','SECRET')")
    if links and "task_links" in schema:
        con.executemany("INSERT INTO task_links VALUES (?,?)", [("a", "b"), ("b", "c"), ("z", "a"), ("a", "ghost")])
    con.commit()
    con.close()
    return db


def test_links_are_the_ids_between_served_cards_only(tmp_path):
    board = snap.read_board(_board(tmp_path), "demo")
    assert board["links"] == [["a", "b"], ["b", "c"]]   # the archived card and the unknown one are dropped
    assert board["runs"][0]["task"] == "a"
    assert "SECRET" not in json.dumps(board)


def test_links_are_absent_without_the_table_or_without_history(tmp_path):
    no_table = _board(tmp_path, schema=SCHEMA.replace("CREATE TABLE task_links (parent_id TEXT NOT NULL, child_id TEXT NOT NULL, PRIMARY KEY (parent_id, child_id));", ""))
    assert "links" not in snap.read_board(no_table, "demo")   # not served is not « no link »: the front says « unavailable », never guesses
    other = tmp_path / "other"
    other.mkdir()
    assert "links" not in snap.read_board(_board(other), "demo", history=False)   # /live never carries them


def test_runs_without_a_task_column_still_work(tmp_path):
    schema = SCHEMA.replace("task_id TEXT, profile TEXT", "ztask TEXT, profile TEXT")
    board = snap.read_board(_board(tmp_path, schema=schema, run_col="ztask"), "demo")
    assert board["runs"] == [{"profile": "bot", "startedAt": 1, "endedAt": 2, "outcome": "completed"}]


def _executions(home: Path, rows, jobs):
    cron = home / "cron"
    cron.mkdir(parents=True)
    (cron / "jobs.json").write_text(json.dumps({"jobs": jobs}))
    con = sqlite3.connect(cron / "executions.db")
    con.execute("CREATE TABLE executions (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, status TEXT NOT NULL, claimed_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, error TEXT, output_file TEXT)")
    con.executemany("INSERT INTO executions (id, job_id, status, claimed_at, finished_at, error) VALUES (?,?,?,?,?,?)", rows)
    con.commit()
    con.close()


def test_cron_runs_give_name_time_and_ok_flag_only(tmp_path):
    rows = [(f"e{i}", "j1", "completed" if i != 3 else "failed", f"2026-11-0{1 + i % 8}T10:0{i}:00+01:00", f"2026-11-0{1 + i % 8}T10:0{i}:30+01:00", "SECRET") for i in range(6)]
    rows += [("x1", "j1", "running", "2026-11-09T10:00:00+01:00", None, None), ("x2", "j1", "cancelled", "2026-11-09T10:01:00+01:00", "2026-11-09T10:01:05+01:00", None),
             ("y1", "gone", "completed", "2026-11-05T10:00:00+01:00", "2026-11-05T10:00:05+01:00", None)]
    _executions(tmp_path, rows, [{"id": "j1", "name": "nightly", "prompt": "SECRET PROMPT"}])
    out = snap.read_cron_runs("default", tmp_path)
    assert [j["name"] for j in out] == ["nightly"]   # a job that no longer exists has no name: skipped
    assert out[0]["profile"] == "default"
    flags = [ok for _, ok in out[0]["runs"]]
    assert flags == [1, 1, 1, 0, 1, 1]   # running and cancelled executions are not terminal outcomes
    assert [at for at, _ in out[0]["runs"]] == sorted(at for at, _ in out[0]["runs"])
    assert "SECRET" not in json.dumps(out)
    assert set(out[0]) == {"profile", "name", "runs"}


def test_cron_runs_keep_the_newest_per_job_and_survive_a_missing_or_broken_store(tmp_path):
    rows = [(f"e{i}", "j1", "completed", f"2026-10-{1 + i // 24:02d}T{i % 24:02d}:00:00+01:00", f"2026-10-{1 + i // 24:02d}T{i % 24:02d}:00:10+01:00", None) for i in range(130)]
    _executions(tmp_path, rows, [{"id": "j1", "name": "n"}])
    kept = snap.read_cron_runs("default", tmp_path)[0]["runs"]
    assert len(kept) == snap.CRON_RUNS_PER_JOB
    # the NEWEST ones are kept (not the oldest 120), oldest first
    newest = sorted(snap.iso_to_epoch(r[4]) for r in rows)[-snap.CRON_RUNS_PER_JOB:]
    assert [at for at, _ in kept] == newest
    assert snap.read_cron_runs("none", tmp_path / "missing") == []
    broken = tmp_path / "broken"
    (broken / "cron").mkdir(parents=True)
    (broken / "cron" / "executions.db").write_text("not a database")
    assert snap.read_cron_runs("b", broken) == []
