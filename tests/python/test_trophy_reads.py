"""Trophies: what the four new trophies read is already served, and what the dropped one would have needed is not.

- `scribe` is dropped: a `commented` event carries no field that tells the user from a bot (Hermes writes it with
  ``run_id`` NULL and ``{author, len}``, never served). The event kind stays out of ``/history``, and neither the
  comment text nor its author ever leaves the process.
- `twin`, `quiet`, `comeback` read runs (profile, card, outcome, end) and `blocked` events only, and must not be lost
  when a card is archived: the runs and events of an archived card are still served (the card itself is not).
- `fastlane` reads the served cards: an archived card is not served (same known limit as `owl`, `quickstart`, `chain`).
"""

import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_history import SECRET, _client, _snapshot_module, fake_hermes  # noqa: E402,F401  (fixture re-exported)
from test_game_reads import snap  # noqa: E402

GAME_EVENT_KINDS = ("blocked", "unblocked", "review_requested", "changes_requested", "completed", "crashed", "timed_out")
COMMENT_AUTHOR = "AUTHOR-SECRET-7f3a"


def _board_db(fake_hermes_home: Path) -> Path:
    # the fake Hermes of test_history keeps its one board next to the profiles
    return fake_hermes_home.parent.parent / "kanban" / "kanban.db"


def _plant_comment(db: Path):
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE task_comments (id INTEGER PRIMARY KEY, task_id TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)")
    con.execute("INSERT INTO task_comments (task_id, author, body, created_at) VALUES ('t1', ?, ?, 5)", (COMMENT_AUTHOR, f"token={SECRET}"))
    # exactly what kanban_db.add_comment appends (hermes_cli/kanban_db.py:1685): kind `commented`, payload {author, len}, run_id NULL
    con.execute("INSERT INTO task_events (task_id, kind, payload, created_at) VALUES ('t1', 'commented', ?, 5)",
                (json.dumps({"author": COMMENT_AUTHOR, "len": 20}),))
    con.commit()
    con.close()


def test_a_comment_never_reaches_history_nor_live(fake_hermes):
    _plant_comment(_board_db(fake_hermes["alice"]))
    client = _client()
    for route in ("history", "live"):
        raw = client.get(f"/api/plugins/hermes-officecraft/{route}").text
        assert SECRET not in raw and COMMENT_AUTHOR not in raw, route
        assert '"commented"' not in raw, route   # scribe dropped: not even the kind and the time
    body = client.get("/api/plugins/hermes-officecraft/history").json()
    assert body["boards"][0]["events"] == [{"task": "t1", "kind": "completed", "ts": 3}]   # same shape as before the new trophies


def test_the_game_event_kinds_are_unchanged():
    # Adding a kind changes every trophy that reads all events (noqueue's « active days ») and the size of /history:
    # it needs a contract line and a decision first (`commented` was measured: more events, a bigger answer, nothing it could prove).
    assert snap.EVENT_KINDS == GAME_EVENT_KINDS
    assert _snapshot_module().EVENT_KINDS == GAME_EVENT_KINDS


SCHEMA = """
CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, assignee TEXT, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER, last_heartbeat_at INTEGER);
CREATE TABLE task_runs (id INTEGER PRIMARY KEY, task_id TEXT, profile TEXT, status TEXT, started_at INTEGER,
  ended_at INTEGER, outcome TEXT, summary TEXT, error TEXT);
CREATE TABLE task_events (id INTEGER PRIMARY KEY, task_id TEXT, kind TEXT, payload TEXT, created_at INTEGER);
"""


def _archived_board(tmp_path) -> Path:
    db = tmp_path / "kanban.db"
    con = sqlite3.connect(db)
    con.executescript(SCHEMA)
    con.executemany("INSERT INTO tasks (id, title, status, created_at, completed_at) VALUES (?,?,?,?,?)",
                    [("gone", "Archived card", "archived", 100, 400), ("live", "Live card", "done", 500, 520)])
    con.executemany("INSERT INTO task_runs (task_id, profile, status, started_at, ended_at, outcome, error) VALUES (?,?,?,?,?,?,?)",
                    [("gone", "alice", "crashed", 110, 200, "crashed", SECRET),      # alice's run crashes...
                     ("gone", "bob", "done", 210, 390, "completed", None),          # ...bob finishes the card (a twin)
                     ("live", "bob", "done", 505, 519, "completed", None),
                     ("live", "", "done", 505, 506, "completed", None)])            # a « Launch » (no profile): never served
    con.executemany("INSERT INTO task_events (task_id, kind, payload, created_at) VALUES (?,?,?,?)",
                    [("gone", "blocked", json.dumps({"reason": SECRET}), 150), ("gone", "unblocked", None, 160),
                     ("gone", "completed", json.dumps({"summary": SECRET}), 400)])
    con.commit()
    con.close()
    return db


def test_runs_and_events_of_an_archived_card_are_still_served(tmp_path):
    board = snap.read_board(_archived_board(tmp_path), "demo")
    assert [t["id"] for t in board["tasks"]] == ["live"]   # the archived card is not served (fastlane's known limit)
    # twin / quiet / comeback read only these: archiving a card must not take a trophy back
    assert board["runs"] == [
        {"profile": "alice", "startedAt": 110, "endedAt": 200, "outcome": "crashed", "task": "gone"},
        {"profile": "bob", "startedAt": 210, "endedAt": 390, "outcome": "completed", "task": "gone"},
        {"profile": "bob", "startedAt": 505, "endedAt": 519, "outcome": "completed", "task": "live"}]
    assert board["events"] == [{"task": "gone", "kind": "blocked", "ts": 150}, {"task": "gone", "kind": "unblocked", "ts": 160},
                               {"task": "gone", "kind": "completed", "ts": 400}]
    assert SECRET not in json.dumps(board)


def test_fastlane_reads_creation_and_completion_of_each_served_card(tmp_path):
    board = snap.read_board(_archived_board(tmp_path), "demo", history=False)   # /live: the cards the game reads
    card = board["tasks"][0]
    assert (card["createdAt"], card["completedAt"], card["status"]) == (500, 520, "done")
    assert board["runs"] == [] and board["events"] == []   # /live carries no history


def test_sandbox_boards_are_served_and_left_to_the_page_to_drop(fake_hermes, monkeypatch):
    # gameFacts (src/core/game.js) drops `sandbox-*` from every trophy; the agent half serves the board as it is
    db = str(_board_db(fake_hermes["alice"]))
    monkeypatch.setattr(sys.modules["hermes_cli.kanban_db_boards"], "list_boards",
                        lambda include_archived=False: [{"slug": "sandbox-alpha", "db_path": db, "created_at": None}])
    body = _client().get("/api/plugins/hermes-officecraft/history").json()
    assert [b["slug"] for b in body["boards"]] == ["sandbox-alpha"]
