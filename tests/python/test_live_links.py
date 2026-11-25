"""The links `/live` serves (`links` of a board): only the ones that still hold a card back, ids only, bounded, and what that costs."""

import importlib.util
import json
import sqlite3
import statistics
import sys
import time
import types
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from hermes_officecraft import snapshot as snap   # noqa: E402

SCHEMA = """
CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, assignee TEXT, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER, last_heartbeat_at INTEGER, result TEXT);
CREATE TABLE task_links (parent_id TEXT NOT NULL, child_id TEXT NOT NULL, PRIMARY KEY (parent_id, child_id));
CREATE INDEX idx_links_child ON task_links(child_id);
CREATE INDEX idx_links_parent ON task_links(parent_id);
"""


def _db(tmp_path, cards, links, schema=SCHEMA, name="kanban.db"):
    """cards: [(id, status)]; links: [(parent, child)]"""
    db = tmp_path / name
    if db.exists():
        db.unlink()
    con = sqlite3.connect(db)
    con.executescript(schema)
    con.executemany("INSERT INTO tasks (id, title, assignee, status, created_at) VALUES (?, ?, 'alpha', ?, ?)",
                    [(cid, f"Card {cid}", status, 10 + i) for i, (cid, status) in enumerate(cards)])
    if links:
        con.executemany("INSERT INTO task_links (parent_id, child_id) VALUES (?, ?)", links)
    con.commit()
    con.close()
    return db


def _live(db):
    with snap.partial_scope() as flags:
        board = snap.read_board(db, "demo", history=False, reasons=True, links=True)
    return board, flags


def test_only_the_links_that_still_hold_a_card_back_are_served(tmp_path):
    cards = [("a", "running"), ("b", "todo"), ("c", "todo"), ("d", "done"), ("e", "todo"), ("f", "archived"), ("g", "done"), ("h", "ready")]
    links = [("a", "b"),    # a running parent holds its todo child back: served
             ("b", "c"),    # a chain: served
             ("d", "e"),    # a finished parent holds nothing back
             ("a", "g"),    # a finished child is not waiting any more
             ("f", "h"),    # an archived parent is finished
             ("a", "f"),    # an archived child
             ("a", "ghost")]   # a link to a card that does not exist
    board, flags = _live(_db(tmp_path, cards, links))
    assert board["links"] == [["a", "b"], ["b", "c"]] and not flags


def test_the_links_are_ids_only(tmp_path):
    board, _ = _live(_db(tmp_path, [("a", "running"), ("b", "todo")], [("a", "b")]))
    assert board["links"] == [["a", "b"]]
    assert all(isinstance(x, str) for pair in board["links"] for x in pair)


def test_the_order_is_stable(tmp_path):
    cards = [(c, "todo") for c in "abcdef"]
    links = [("c", "f"), ("a", "e"), ("b", "e"), ("a", "d")]
    first, _ = _live(_db(tmp_path, cards, links))
    second, _ = _live(_db(tmp_path, cards, list(reversed(links))))
    assert first["links"] == second["links"] == [["a", "d"], ["a", "e"], ["b", "e"], ["c", "f"]]


def test_a_board_without_links_serves_an_empty_list(tmp_path):
    board, flags = _live(_db(tmp_path, [("a", "todo")], []))
    assert board["links"] == [] and not flags


@pytest.mark.parametrize("schema", [
    "CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, assignee TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL);",   # no task_links table
    "CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, assignee TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL); CREATE TABLE task_links (a TEXT, b TEXT);",   # not the table Hermes writes
])
def test_an_older_schema_serves_an_empty_list_without_an_error_or_a_flag(tmp_path, schema):
    board, flags = _live(_db(tmp_path, [("a", "todo")], [], schema=schema))
    assert board["links"] == [] and not flags and [t["id"] for t in board["tasks"]] == ["a"]


def test_past_the_cap_the_board_is_flagged_and_the_rest_is_not_served(tmp_path, monkeypatch):
    monkeypatch.setattr(snap, "LIVE_LINKS_MAX", 5)
    cards = [("root", "running")] + [(f"c{i:02d}", "todo") for i in range(8)]
    board, flags = _live(_db(tmp_path, cards, [("root", f"c{i:02d}") for i in range(8)]))
    assert len(board["links"]) == 5 and board["links"][0] == ["root", "c00"]
    assert flags == [{"source": "kanban:demo", "reason": "unreadable"}]
    # exactly the cap is not past it
    board, flags = _live(_db(tmp_path, cards[:6], [("root", f"c{i:02d}") for i in range(5)]))
    assert len(board["links"]) == 5 and not flags


def test_only_live_asks_for_them(tmp_path):
    db = _db(tmp_path, [("a", "running"), ("b", "todo")], [("a", "b")])
    assert "links" not in snap.read_board(db, "demo", history=False, reasons=True)
    assert "links" not in snap.read_board(db, "demo", history=False)
    # /history keeps its own reading (every link between the cards served), whether or not the flag is given
    assert snap.read_board(db, "demo", history=True)["links"] == snap.read_board(db, "demo", history=True, links=True)["links"] == [["a", "b"]]


def test_live_cannot_leak_a_title_or_a_body_through_links(tmp_path):
    db = _db(tmp_path, [("a", "running"), ("b", "todo")], [("a", "b")])
    con = sqlite3.connect(db)
    con.execute("UPDATE tasks SET body = 'SECRET-BODY', result = 'SECRET-RESULT'")
    con.commit()
    con.close()
    board, _ = _live(db)
    assert "SECRET" not in json.dumps(board)


# ------------------------------------------------------------------ the route

@pytest.fixture
def live_client(tmp_path, monkeypatch):
    db = _db(tmp_path, [("a", "running"), ("b", "todo"), ("c", "done")], [("a", "b"), ("c", "b")])

    def mod(name, **attrs):
        m = types.ModuleType(name)
        m.__dict__.update(attrs)
        monkeypatch.setitem(sys.modules, name, m)

    mod("hermes_cli")
    mod("hermes_cli.kanban_db_boards", list_boards=lambda include_archived=False: [{"slug": "demo", "db_path": str(db), "created_at": None}])
    mod("hermes_cli.profiles", list_profiles=lambda lazy_skill_count=False: [])
    mod("hermes_yaml", safe_load=lambda s: {})
    s = importlib.util.spec_from_file_location("officecraft_plugin_api_links", ROOT / "dashboard" / "plugin_api.py")
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    app = FastAPI()
    app.include_router(m.router, prefix="/api/plugins/hermes-officecraft")
    return TestClient(app)


def test_the_live_route_serves_the_links_of_each_board(live_client):
    live = live_client.get("/api/plugins/hermes-officecraft/live").json()
    assert live["ok"] is True and not [p for p in live["partial"] if p["source"].startswith("kanban")] and live["boards"][0]["links"] == [["a", "b"]]


# ------------------------------------------------------------------ what it costs

def _big(tmp_path, cards=3000, links=5000, statuses=("done", "todo", "running", "ready", "blocked")):
    """A board of `cards` cards and `links` random links (parent before child: no loop)."""
    import random
    rnd = random.Random(7)
    rows = [(f"t{i:05d}", statuses[i % len(statuses)]) for i in range(cards)]
    seen = set()
    while len(seen) < links:
        p, c = sorted(rnd.sample(range(cards), 2))   # parent < child: no cycle
        seen.add((f"t{p:05d}", f"t{c:05d}"))
    return _db(tmp_path, rows, sorted(seen), name="big.db")


def _median_ms(fn, n=15):
    fn()   # warm the page cache
    out = []
    for _ in range(n):
        t0 = time.perf_counter()
        fn()
        out.append((time.perf_counter() - t0) * 1000)
    return statistics.median(out)


@pytest.mark.parametrize("name, statuses", [
    ("worst case: 80 % of the cards still open, the cap is reached", ("done", "todo", "running", "ready", "blocked")),
    ("a campaign well under way: 80 % done", ("done", "done", "done", "done", "todo", "running", "ready", "blocked", "done", "done")),
])
def test_serving_the_links_costs_a_few_milliseconds_on_3000_cards_and_5000_links(tmp_path, capsys, name, statuses):
    db = _big(tmp_path, statuses=statuses)
    before = _median_ms(lambda: snap.read_board(db, "big", history=False, reasons=True))
    after = _median_ms(lambda: snap.read_board(db, "big", history=False, reasons=True, links=True))
    board, flags = _live(db)
    with capsys.disabled():
        print(f"\n/live board read, 3000 cards / 5000 links, {name}: {before:.1f} ms without links, {after:.1f} ms with ({len(board['links'])} links served)")
    assert len(board["links"]) <= snap.LIVE_LINKS_MAX and board["links"]
    assert after - before < 25, (before, after)   # a few milliseconds measured; the margin is for a loaded host
