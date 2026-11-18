"""``GET /replay`` and ``GET /usage`` (hermes_officecraft/replay.py, usage.py) against FAKE databases on disk
(``tmp_path``; nothing real is opened): every kind of fact, the fold table, an empty and an enormous window, an unreadable
database or a changed schema (``partial``), absent usage (``null`` + a reason, never 0), the bounds, and the whitelist
(a body, a comment, a message or a prompt in the answer fails a test)."""

import importlib.util
import json
import re
import sqlite3
import sys
import time
import types
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
BASE = "/api/plugins/hermes-officecraft"
SECRET = "SECRET-DO-NOT-LEAK"
NOW = 1_800_000_000
FORBIDDEN_KEYS = {"soul", "path", "preview", "body", "result", "prompt", "summary", "payload", "instructions", "content", "text",
                  "title", "reason_text", "error", "note", "last_output", "worker_output", "session_id", "db", "workspace_path"}


def _load():
    spec = importlib.util.spec_from_file_location("replay_plugin_api", ROOT / "dashboard" / "plugin_api.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_api = _load()
R = sys.modules["_officecraft_http.replay"]
U = sys.modules["_officecraft_http.usage"]
S = sys.modules["_officecraft_http.snapshot"]
A = sys.modules["_officecraft_http.audit"]

KANBAN_SCHEMA = """
CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, assignee TEXT, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, result TEXT);
CREATE TABLE task_runs (id INTEGER PRIMARY KEY, task_id TEXT NOT NULL, profile TEXT, status TEXT, started_at INTEGER NOT NULL,
  ended_at INTEGER, outcome TEXT, summary TEXT, metadata TEXT, error TEXT);
CREATE TABLE task_events (id INTEGER PRIMARY KEY, task_id TEXT NOT NULL, run_id INTEGER, kind TEXT NOT NULL, payload TEXT,
  created_at INTEGER NOT NULL);
"""
STATE_SCHEMA = """
CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, title TEXT, started_at REAL, ended_at REAL, model TEXT,
  billing_provider TEXT, api_call_count INTEGER DEFAULT 0, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0, reasoning_tokens INTEGER DEFAULT 0,
  estimated_cost_usd REAL, actual_cost_usd REAL, cost_source TEXT, cost_status TEXT);
CREATE TABLE session_model_usage (session_id TEXT NOT NULL, model TEXT NOT NULL, billing_provider TEXT NOT NULL DEFAULT '',
  task TEXT NOT NULL DEFAULT '', api_call_count INTEGER DEFAULT 0, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0, reasoning_tokens INTEGER DEFAULT 0,
  estimated_cost_usd REAL DEFAULT 0, actual_cost_usd REAL DEFAULT 0, cost_status TEXT, cost_source TEXT);
"""


def price_probe(model, provider):
    """Stands in for Hermes' estimator: only the acme-cloud route has a price."""
    return (provider == "acme-cloud", "provider_models_api" if provider == "acme-cloud" else "none")


# ------------------------------------------------------------------ builders
def make_board(path: Path, tasks=(), events=(), runs=(), schema=KANBAN_SCHEMA) -> Path:
    con = sqlite3.connect(path)
    con.executescript(schema)
    for tid, title in tasks:
        con.execute("INSERT INTO tasks (id, title, body, assignee, status, created_at, result) VALUES (?,?,?,?,?,?,?)",
                    (tid, title, SECRET, "alice", "done", 1, SECRET))
    for tid, kind, payload, ts, *run in events:
        con.execute("INSERT INTO task_events (task_id, run_id, kind, payload, created_at) VALUES (?,?,?,?,?)",
                    (tid, run[0] if run else None, kind, json.dumps(payload) if payload is not None else None, ts))
    for rid, tid, profile, started, ended, outcome in runs:
        con.execute("INSERT INTO task_runs (id, task_id, profile, status, started_at, ended_at, outcome, summary, metadata, error) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?)", (rid, tid, profile, "x", started, ended, outcome, SECRET, SECRET, SECRET))
    con.commit()
    con.close()
    return path


def make_state(home: Path, sessions=(), usage_rows=(), schema=STATE_SCHEMA) -> Path:
    home.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(home / "state.db")
    con.executescript(schema)
    for s in sessions:
        sid, source, started, ended, model, prov, calls, tin, tout, est, act = (list(s) + [None] * 11)[:11]
        con.execute("INSERT INTO sessions (id, source, title, started_at, ended_at, model, billing_provider, api_call_count, input_tokens, "
                    "output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, estimated_cost_usd, actual_cost_usd, cost_source) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (sid, source, SECRET, started, ended, model, prov, calls, tin, tout, 7, 3, 2, est, act, "provider_models_api"))
    for u in usage_rows:
        con.execute("INSERT INTO session_model_usage (session_id, model, billing_provider, task, api_call_count, input_tokens, output_tokens, "
                    "estimated_cost_usd, actual_cost_usd, cost_source) VALUES (?,?,?,?,?,?,?,?,?,?)", u)
    con.commit()
    con.close()
    return home


def replay(boards, homes=(), frm=NOW - 86_400, to=NOW, **kw):
    kw.setdefault("now", NOW)
    kw.setdefault("prices", price_probe)
    kw.setdefault("audit_dir", Path("/nonexistent-officecraft-audit"))   # no Hermes here: the journal folder is given, and absent
    with S.partial_scope() as flags:
        body = R.read_replay(boards, list(homes), frm, to, **kw)
    return body, S.partial_list(flags)


def only(body, slug="b"):
    return next(b for b in body["boards"] if b["slug"] == slug)


def walk(node, path=()):
    if isinstance(node, dict):
        for k, v in node.items():
            yield path, k
            yield from walk(v, path + (k,))
    elif isinstance(node, list):
        for item in node:
            yield from walk(item, path + ("[]",))


# ------------------------------------------------------------------ the fold: one case per rule of the fold table
FOLD = [
    ("created", None, None, "todo"), ("created", {"status": "ready"}, None, "ready"),
    ("promoted", None, "todo", "ready"), ("promoted", {"status": "triage"}, "todo", "triage"),
    ("promoted_manual", None, "blocked", "ready"), ("review_reopened", None, "review", "ready"), ("reconciled", {"retry_status": "blocked"}, "running", "ready"),
    ("claimed", None, "ready", "running"), ("completed", None, "running", "done"),
    ("blocked", {"kind": "needs_input"}, "running", "blocked"), ("blocked", {"kind": "dependency"}, "running", "todo"),
    ("blocked", {"classified_in_place": True, "kind": "dependency"}, "blocked", "blocked"),
    ("block_loop_detected", None, "blocked", "triage"), ("gave_up", None, "running", "blocked"),
    ("unblocked", None, "blocked", "ready"), ("unblocked", {"status": "todo"}, "blocked", "todo"),
    ("dependency_wait", None, "ready", "todo"), ("specified", None, "triage", "todo"), ("decomposed", None, "triage", "todo"),
    ("claim_rejected", None, "ready", "todo"),
    ("status", {"status": "review"}, "running", "review"), ("status", {"status": "nonsense"}, "running", "running"),
    ("archived", None, "done", "archived"), ("scheduled", None, "blocked", "scheduled"), ("review_requested", None, "running", "review"),
    ("changes_requested", None, "review", "ready"), ("changes_requested", {"status": "todo"}, "review", "todo"),
    # retry_status only moves a card that is still running (a card already `blocked` stays so)
    ("timed_out", {"retry_status": "ready"}, "running", "ready"), ("timed_out", {"retry_status": "ready"}, "blocked", "blocked"),
    ("crashed", {"retry_status": "ready"}, "running", "ready"), ("rate_limited", {"retry_status": "ready"}, "running", "ready"),
    ("spawn_failed", {"retry_status": "ready"}, "ready", "ready"), ("stale", {"retry_status": "ready"}, "running", "ready"),
    ("reclaimed", {"retry_status": "ready"}, "blocked", "blocked"), ("reclaimed", {"retry_status": "ready", "manual": True}, "blocked", "ready"),
    ("timed_out", None, "running", "running"),
    # nothing else moves a card
    ("heartbeat", {"status": "done"}, "running", "running"), ("commented", None, "blocked", "blocked"), ("edited", {"status": "done"}, "todo", "todo"),
    ("linked", {"parent": "a", "child": "b"}, "todo", "todo"), ("assigned", {"assignee": "x"}, "ready", "ready"), ("brand_new_kind", None, "ready", "ready"),
]


@pytest.mark.parametrize("kind, payload, before, after", FOLD)
def test_fold_table(kind, payload, before, after):
    assert R.next_status(kind, payload, before) == after


def test_every_served_kind_is_in_the_fold_or_inert():
    # a kind served as a fact is one the page can replay: either it moves a card (above) or it is a fact that moves nothing
    inert = {"assigned", "commented", "linked", "unlinked"}
    for kind in R.SERVED_KINDS - inert:
        assert any(case[0] == kind for case in FOLD), kind


# ------------------------------------------------------------------ every kind of fact, the extras, the start state
def test_each_fact_carries_its_state_and_only_its_one_extra(tmp_path):
    ev = [("t1", "created", {"assignee": "alice", "status": "todo", "reason": SECRET}, NOW - 5000),
          ("t1", "assigned", {"assignee": "bob", "from": "alice", "reason": SECRET}, NOW - 4900),
          ("t2", "created", None, NOW - 4800),
          ("t1", "promoted", None, NOW - 4700),
          ("t1", "claimed", {"lock": SECRET, "pid": 5}, NOW - 4600),
          ("t1", "blocked", {"kind": "needs_input", "reason": SECRET}, NOW - 4500),
          ("t1", "unblocked", {"note": SECRET}, NOW - 4400),
          ("t2", "linked", {"parent": "t1", "child": "t2"}, NOW - 4300),
          ("t1", "commented", {"author": SECRET, "len": 12}, NOW - 4200),
          ("t1", "completed", {"summary": SECRET}, NOW - 4100),
          ("t1", "heartbeat", {"note": SECRET}, NOW - 4000), ("t1", "edited", {"fields": [SECRET]}, NOW - 3900)]
    body, partial = replay([("b", make_board(tmp_path / "k.db", [("t1", "One"), ("t2", "Two")], ev))])
    b = only(body)
    assert partial == []
    assert b["facts"] == [
        [NOW - 5000, "t1", "created", "todo", "alice"], [NOW - 4900, "t1", "assigned", None, "bob"],
        [NOW - 4800, "t2", "created", "todo", None], [NOW - 4700, "t1", "promoted", "ready", None],
        [NOW - 4600, "t1", "claimed", "running", None], [NOW - 4500, "t1", "blocked", "blocked", "needs_input"],
        [NOW - 4400, "t1", "unblocked", "ready", None], [NOW - 4300, "t2", "linked", None, "t1"],
        [NOW - 4200, "t1", "commented", None, None], [NOW - 4100, "t1", "completed", "done", None]]   # no heartbeat, no edited
    assert b["since"] == NOW - 5000 and b["start"] == [] and b["cards"] == {"t1": "One", "t2": "Two"}
    assert SECRET not in json.dumps(body)


def test_blocked_by_a_dependency_is_todo_not_blocked(tmp_path):
    # `blocked{kind: dependency}` leads to `todo`
    ev = [("t1", "created", {"status": "ready"}, NOW - 100), ("t1", "blocked", {"kind": "dependency"}, NOW - 90)]
    f = only(replay([("b", make_board(tmp_path / "k.db", [("t1", "One")], ev))])[0])["facts"]
    assert f[1] == [NOW - 90, "t1", "blocked", "todo", "dependency"]


def test_created_carries_its_agent_the_same_whitelist_as_assigned(tmp_path):
    # a card created in the window with an agent has one in `facts`,
    # replayed from `created.payload.assignee` and then `assigned.payload.assignee` — the same profile pattern as `assigned`
    ev = [("t1", "created", {"assignee": "alice", "status": "blocked", "reason": SECRET}, NOW - 3000),
          ("t2", "created", {"assignee": "Not A Name!!"}, NOW - 2900),
          ("t3", "created", {"assignee": 7, "reason": SECRET}, NOW - 2800),
          ("t4", "created", {"assignee": "bob", "status": "todo"}, NOW - 2700),
          ("t4", "assigned", {"assignee": "alice"}, NOW - 2600),
          ("t4", "assigned", {"assignee": None}, NOW - 2500)]
    body, _ = replay([("b", make_board(tmp_path / "k.db", [("t%d" % i, "T%d" % i) for i in range(1, 5)], ev))])
    b = only(body)
    assert [(f[1], f[4]) for f in b["facts"]] == [
        ("t1", "alice"), ("t2", None), ("t3", None), ("t4", "bob"), ("t4", "alice"), ("t4", None)]
    assert SECRET not in json.dumps(body)   # nothing else of the payload is served
    assert b["start"] == []                  # the four cards are born inside the window


def test_extras_outside_the_whitelist_are_dropped(tmp_path):
    ev = [("t1", "created", None, NOW - 100), ("t1", "assigned", {"assignee": "Not A Name!!"}, NOW - 90),
          ("t1", "blocked", {"kind": SECRET}, NOW - 80), ("t1", "linked", {"parent": SECRET + " x", "child": "t1"}, NOW - 70)]
    f = only(replay([("b", make_board(tmp_path / "k.db", [("t1", "One")], ev))])[0])["facts"]
    assert [x[4] for x in f] == [None, None, None, None]


def test_the_start_state_is_the_board_at_from_with_the_assignee(tmp_path):
    ev = [("t1", "created", {"assignee": "alice", "status": "ready"}, NOW - 9000), ("t1", "claimed", None, NOW - 8000),
          ("t1", "assigned", {"assignee": "bob"}, NOW - 7900),
          ("t2", "created", None, NOW - 9000), ("t2", "completed", None, NOW - 8000),   # done before `from`: not open at the start
          ("t3", "created", None, NOW - 100), ("t1", "completed", None, NOW - 50)]
    body, _ = replay([("b", make_board(tmp_path / "k.db", [("t1", "One"), ("t2", "Two"), ("t3", "Three")], ev))], frm=NOW - 5000)
    b = only(body)
    assert b["start"] == [["t1", "running", "bob"]]
    assert [f[1:3] for f in b["facts"]] == [["t3", "created"], ["t1", "completed"]]
    assert set(b["cards"]) == {"t1", "t3"}   # the titles of the cards the page can show, not every card of the board


def test_an_empty_window_serves_the_start_state_and_no_facts(tmp_path):
    ev = [("t1", "created", None, NOW - 9000)]
    body, partial = replay([("b", make_board(tmp_path / "k.db", [("t1", "One")], ev))], frm=NOW - 5000, to=NOW)
    b = only(body)
    assert b["facts"] == [] and b["runs"] == [] and b["silences"] == [] and b["start"] == [["t1", "todo", None]]
    assert body["orders"] == [] and body["sessions"] == [] and body["crons"] == [] and body["truncated"] is None and partial == []


def test_a_board_without_any_event_is_not_a_source(tmp_path):
    body, _ = replay([("b", make_board(tmp_path / "k.db", [], []))])
    assert body["boards"] == []


def test_titles_are_current_bounded_and_clean(tmp_path):
    ev = [("t1", "created", None, NOW - 100)]
    b = only(replay([("b", make_board(tmp_path / "k.db", [("t1", "A\x00B\x1b[31m" + "x" * 300)], ev))])[0])
    assert "\x00" not in b["cards"]["t1"] and "\x1b" not in b["cards"]["t1"] and len(b["cards"]["t1"]) == 120


# ------------------------------------------------------------------ runs, usage of a run, silences
def _run_world(tmp_path):
    ev = [("t1", "created", None, NOW - 3000),
          ("t1", "claimed", None, NOW - 2000, 1), ("t1", "owner_admitted", {"session_id": "s-ok", "db": SECRET}, NOW - 1999, 1),
          ("t1", "completed", {"summary": SECRET}, NOW - 1000, 1),
          ("t2", "created", None, NOW - 3000),
          ("t2", "claimed", None, NOW - 900, 2), ("t2", "owner_admitted", {"session_id": "s-nocalls"}, NOW - 899, 2),
          ("t3", "created", None, NOW - 3000), ("t3", "claimed", None, NOW - 800, 3),   # run 3: no owner_admitted
          ("t4", "created", None, NOW - 3000), ("t4", "claimed", None, NOW - 700, 4), ("t4", "owner_admitted", {"session_id": "s-gone"}, NOW - 699, 4),
          ("t5", "created", None, NOW - 3000), ("t5", "claimed", None, NOW - 600, 5), ("t5", "owner_admitted", {"session_id": "s-x"}, NOW - 599, 5),
          ("t6", "created", None, NOW - 3000), ("t6", "claimed", None, NOW - 500, 6), ("t6", "owner_admitted", {"session_id": "s-x"}, NOW - 499, 6)]
    runs = [(1, "t1", "alice", NOW - 2000, NOW - 1000, "completed"), (2, "t2", "alice", NOW - 900, NOW - 800, "blocked"),
            (3, "t3", "alice", NOW - 800, None, None), (4, "t4", "alice", NOW - 700, NOW - 650, "weird-outcome"),
            (5, "t5", "ghost", NOW - 600, NOW - 550, "crashed"),            # a profile with no home here
            (6, "t6", "bob", NOW - 500, NOW - 450, "completed")]               # bob has no state.db
    board = make_board(tmp_path / "k.db", [(f"t{i}", f"Card {i}") for i in range(1, 7)], ev, runs)
    alice = make_state(tmp_path / "alice", [("s-ok", "kanban", NOW - 1999, NOW - 1000, "example/x", "acme-cloud", 12, 1000, 500, 0.5, None),
                                            ("s-nocalls", "kanban", NOW - 899, NOW - 800, "example/x", "acme-cloud", 0, 0, 0, 0.0, None)])
    (tmp_path / "bob").mkdir()
    return board, [("alice", alice), ("bob", tmp_path / "bob")]


def test_runs_carry_their_usage_or_the_reason_they_have_none(tmp_path):
    board, homes = _run_world(tmp_path)
    body, partial = replay([("b", board)], homes)
    runs = {r["task"]: r for r in only(body)["runs"]}
    ok = runs["t1"]
    assert ok["usage"] == {"apiCalls": 12, "tokens": {"input": 1000, "output": 500, "cacheRead": 7, "cacheWrite": 3, "reasoning": 2},
                           "model": "example/x", "provider": "acme-cloud", "priced": True, "usd": 0.5,
                           "costSource": "provider_models_api", "costKind": "estimated"}
    assert "why" not in ok and (ok["start"], ok["end"], ok["profile"], ok["outcome"]) == (NOW - 2000, NOW - 1000, "alice", "completed")
    assert runs["t2"]["usage"] is None and runs["t2"]["why"] == "no_calls"          # a session that never reached the model: not « 0 tokens »
    assert runs["t3"]["usage"] is None and runs["t3"]["why"] == "no_session_link" and runs["t3"]["end"] is None and runs["t3"]["outcome"] is None
    assert runs["t4"]["usage"] is None and runs["t4"]["why"] == "no_calls" and runs["t4"]["outcome"] == "other"   # session not found in the store
    assert runs["t5"]["usage"] is None and runs["t5"]["why"] == "no_store"          # profile unknown to this Hermes
    assert runs["t6"]["usage"] is None and runs["t6"]["why"] == "no_store"          # profile with no state.db
    assert partial == []
    assert SECRET not in json.dumps(body) and "s-ok" not in json.dumps(body)       # the session id never leaves


def test_a_run_of_a_subscription_route_has_no_dollar_amount_even_when_one_is_recorded(tmp_path):
    ev = [("t1", "created", None, NOW - 3000), ("t1", "claimed", None, NOW - 2000, 1), ("t1", "owner_admitted", {"session_id": "s1"}, NOW - 1999, 1)]
    board = make_board(tmp_path / "k.db", [("t1", "One")], ev, [(1, "t1", "alice", NOW - 2000, NOW - 1000, "completed")])
    # Hermes recorded 168 $ of « API list-price equivalent » for the subscription route: not a spend, never served as one
    alice = make_state(tmp_path / "alice", [("s1", "kanban", NOW - 1999, None, "example/model-max", "acme-plan-x", 5, 10, 20, 168.23, None)])
    u = only(replay([("b", board)], [("alice", alice)])[0])["runs"][0]["usage"]
    assert u["priced"] is False and u["usd"] is None and u["costKind"] == "unpriced"
    assert "168" not in json.dumps(u)


def test_silences_are_gaps_over_five_minutes_between_signs_of_life(tmp_path):
    ev = [("t1", "created", None, NOW - 5000), ("t1", "claimed", None, NOW - 4000, 1),
          ("t1", "heartbeat", {"note": SECRET}, NOW - 3900, 1), ("t1", "heartbeat", None, NOW - 3800, 1),
          ("t1", "heartbeat", None, NOW - 3000, 1),          # 800 s after the last: a silence from NOW-3500 to NOW-3000
          ("t1", "completed", None, NOW - 2990, 1),
          ("t2", "created", None, NOW - 5000), ("t2", "claimed", None, NOW - 2000, 2)]
    runs = [(1, "t1", "alice", NOW - 4000, NOW - 2990, "completed"), (2, "t2", "alice", NOW - 2000, None, None)]
    body, _ = replay([("b", make_board(tmp_path / "k.db", [("t1", "One"), ("t2", "Two")], ev, runs))])
    sil = only(body)["silences"]
    # t2 is open with no heartbeat at all: silent from start + 300 s until the end of the window; t1 only for its 800 s gap
    assert ["alice", "t1", NOW - 3500, NOW - 3000] in sil and ["alice", "t2", NOW - 1700, NOW] in sil and len(sil) == 2
    assert SECRET not in json.dumps(body)


def test_a_run_outside_the_window_is_not_served(tmp_path):
    ev = [("t1", "created", None, NOW - 90_000)]
    runs = [(1, "t1", "alice", NOW - 90_000, NOW - 87_000, "completed"), (2, "t1", "alice", NOW + 5000, None, None)]
    body, _ = replay([("b", make_board(tmp_path / "k.db", [("t1", "One")], ev, runs))])
    assert only(body)["runs"] == []


# ------------------------------------------------------------------ bounds
def test_the_window_is_bounded_and_the_replay_says_where_it_stops(tmp_path, monkeypatch):
    monkeypatch.setitem(R.LIMITS, "facts", 10)
    ev = [("t1", "created", None, NOW - 10_000)] + [("t1", "commented", None, NOW - 9_000 + i) for i in range(30)]
    body, _ = replay([("b", make_board(tmp_path / "k.db", [("t1", "One")], ev))])
    f = only(body)["facts"]
    # the 11th fact is the first one dropped: the replay is complete BEFORE its time, nothing at or after it is served
    assert body["truncated"] == {"at": NOW - 9_000 + 9}
    assert [x[0] for x in f] == [NOW - 10_000] + [NOW - 9_000 + i for i in range(9)]


def test_every_list_is_cut_at_the_same_instant(tmp_path, monkeypatch):
    monkeypatch.setitem(R.LIMITS, "crons", 3)
    home = tmp_path / "alice"
    (home / "cron").mkdir(parents=True)
    (home / "cron" / "jobs.json").write_text(json.dumps({"jobs": [{"id": "j1", "name": "nightly", "prompt": SECRET}]}))
    con = sqlite3.connect(home / "cron" / "executions.db")
    con.execute("CREATE TABLE executions (id INTEGER PRIMARY KEY, job_id TEXT, status TEXT, claimed_at TEXT, finished_at TEXT, error TEXT)")
    for i in range(6):
        t = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(NOW - 6000 + 100 * i))
        con.execute("INSERT INTO executions (job_id, status, claimed_at, finished_at, error) VALUES ('j1','completed',?,?,?)", (t, t, SECRET))
    con.commit()
    con.close()
    ev = [("t1", "created", None, NOW - 7000), ("t1", "completed", None, NOW - 100)]
    body, _ = replay([("b", make_board(tmp_path / "k.db", [("t1", "One")], ev))], [("alice", home)])
    at = body["truncated"]["at"]
    assert len(body["crons"]) == 3 and all(c[2] < at for c in body["crons"])
    assert [f[2] for f in only(body)["facts"]] == ["created"]    # the later `completed` is beyond `at`: not served half-way
    assert SECRET not in json.dumps(body)


def test_the_route_refuses_a_window_outside_what_is_served(tmp_path):
    client = TestClient(_app())
    now = int(time.time())
    assert client.get(f"{BASE}/replay?from={now - 7 * 86_400}&to={now}").status_code != 422   # exactly 7 days is served
    for query in (f"from={now - 8 * 86_400}&to={now}", f"from={now}&to={now - 10}", f"from={now - 100}&to={now + 3600}",
                  "from=abc", "from=-5", f"from={SECRET}", "to=1e9", "board=Not%20A%20Slug", "board=" + SECRET.lower() + "!"):
        r = client.get(f"{BASE}/replay?{query}")
        assert r.status_code == 422, query
        assert SECRET not in r.text and SECRET.lower() not in r.text     # a refusal never echoes the input
    assert client.get(f"{BASE}/usage?from=1&to={now}").status_code == 422     # more than 31 days
    assert client.get(f"{BASE}/usage?from=-1").status_code == 422


def _app():
    app = FastAPI()
    app.include_router(_api.router, prefix=BASE)
    return app


@pytest.fixture
def fake_hermes(tmp_path, monkeypatch):
    """A fake Hermes home: two profiles, two boards, the audit journal in tmp_path; the real clock (the route reads it)."""
    now = int(time.time())
    alice = make_state(tmp_path / "alice", [("s1", "kanban", now - 4000, now - 3000, "example/x", "acme-cloud", 10, 100, 50, 0.1, None),
                                            ("s2", "cli", now - 3500, None, "example/model-max", "acme-plan-x", 4, 7, 8, 1.5, None),
                                            ("s3", "cron", now - 3400, now - 3300, "example/x", "acme-cloud", 2, 1, 1, 0.01, None),
                                            ("s4", "oneshot", now - 3300, now - 3200, "example/x", "acme-cloud", 2, 1, 1, 0.01, None)],
                       [("s1", "example/x", "acme-cloud", "", 10, 100, 50, 0.1, 0.0, "provider_models_api"),
                        ("s1", "example/x", "acme-cloud", "title_generation", 1, 5, 5, 0.01, 0.0, "provider_models_api"),
                        ("s2", "example/model-max", "acme-plan-x", "", 4, 7, 8, 1.5, 0.0, "provider_cost_api")])
    bob = tmp_path / "bob"
    bob.mkdir()
    ev = [("t1", "created", None, now - 5000), ("t1", "completed", {"summary": SECRET}, now - 100)]
    b1 = make_board(tmp_path / "b1.db", [("t1", "One")], ev)
    b2 = make_board(tmp_path / "b2.db", [("t9", "Nine")], [("t9", "created", None, now - 50)])
    modules = {}

    def mod(name, **attrs):
        m = types.ModuleType(name)
        m.__dict__.update(attrs)
        monkeypatch.setitem(sys.modules, name, m)
        modules[name] = m

    mod("hermes_cli")
    mod("hermes_cli.profiles", list_profiles=lambda lazy_skill_count=False: [types.SimpleNamespace(name="alice", path=str(alice)),
                                                                              types.SimpleNamespace(name="bob", path=str(bob))])
    mod("hermes_cli.kanban_db_boards", list_boards=lambda include_archived=False: [
        {"slug": "b1", "db_path": str(b1)}, {"slug": "b2", "db_path": str(b2)}])
    monkeypatch.setattr(A, "data_dir", lambda: tmp_path / "plugin-data")
    monkeypatch.setattr(U, "hermes_route_price", price_probe)
    U.forget_prices()
    return types.SimpleNamespace(now=now, tmp=tmp_path, alice=alice, bob=bob, b1=b1, b2=b2)


def test_the_routes_serve_the_fake_home_and_health_announces_them(fake_hermes):
    client = TestClient(_app())
    assert "replay" in client.get(f"{BASE}/health").json()["reads"] and "usage" in client.get(f"{BASE}/health").json()["reads"]
    body = client.get(f"{BASE}/replay").json()
    assert body["ok"] is True and body["partial"] == [] and body["to"] - body["from"] == 86_400
    assert {b["slug"] for b in body["boards"]} == {"b1", "b2"}
    # conversations outside the kanban: only the human one (the `kanban`, `cron` and `oneshot` sources are left out)
    assert body["sessions"] == [["alice", "cli", fake_hermes.now - 3500, None]]
    one = client.get(f"{BASE}/replay?board=b2").json()
    assert [b["slug"] for b in one["boards"]] == ["b2"]
    u = client.get(f"{BASE}/usage").json()
    assert u["ok"] is True and u["attribution"] == "session_start" and u["partial"] == []
    prof = {p["profile"]: p for p in u["profiles"]}
    assert prof["alice"]["sessions"] == 4 and prof["alice"]["apiCalls"] == 18
    assert prof["bob"]["sessions"] is None and prof["bob"]["tokens"] is None and prof["bob"]["reason"] == "missing"   # no store: absent, not 0


def test_a_replay_with_nothing_readable_says_so_and_never_500s(fake_hermes, monkeypatch):
    monkeypatch.setitem(sys.modules, "hermes_cli.kanban_db_boards", types.SimpleNamespace(list_boards=lambda include_archived=False: 1 / 0))
    body = TestClient(_app()).get(f"{BASE}/replay").json()
    assert body["ok"] is True and body["boards"] == [] and {"source": "kanban", "reason": "unreadable"} in body["partial"]
    monkeypatch.setitem(sys.modules, "hermes_cli.profiles", types.SimpleNamespace(list_profiles=lambda lazy_skill_count=False: 1 / 0))
    body = TestClient(_app()).get(f"{BASE}/replay").json()
    assert body["ok"] is False and body["partial"] == []                       # nothing to qualify: the page keeps its last answer
    assert TestClient(_app()).get(f"{BASE}/usage").json()["ok"] is False


# ------------------------------------------------------------------ a database that cannot be read, a schema that changed
def test_an_unreadable_board_is_named_and_the_others_are_served(tmp_path):
    good = make_board(tmp_path / "good.db", [("t1", "One")], [("t1", "created", None, NOW - 10)])
    bad = tmp_path / "bad.db"
    bad.write_bytes(b"this is not sqlite" * 200)
    changed = make_board(tmp_path / "changed.db", [], [],
                         schema=KANBAN_SCHEMA.replace("run_id INTEGER, ", "").replace("title TEXT NOT NULL", "label TEXT NOT NULL"))
    body, partial = replay([("good", good), ("bad", bad), ("changed", changed), ("gone", tmp_path / "nothing.db")])
    assert [b["slug"] for b in body["boards"]] == ["good"]
    assert {"source": "kanban:gone", "reason": "missing"} in partial and {"source": "kanban:changed", "reason": "schema"} in partial
    assert any(p["source"] == "kanban:bad" and p["reason"] in ("unreadable", "schema") for p in partial)
    assert len(partial) == 3


def test_an_unreadable_session_store_is_named_for_the_runs_and_the_sessions(tmp_path):
    board, homes = _run_world(tmp_path)
    (tmp_path / "alice" / "state.db").write_bytes(b"\x00garbage" * 500)
    body, partial = replay([("b", board)], homes)
    assert only(body)["runs"][0]["usage"] is None and only(body)["runs"][0]["why"] == "store_unreadable"
    assert any(p["source"] == "sessions:alice" for p in partial)
    assert body["sessions"] == []


def test_a_slow_store_gives_up_inside_the_budget(tmp_path):
    board, homes = _run_world(tmp_path)
    body, partial = replay([("b", board)], homes, budget_s=-1)          # the budget is already spent
    assert {"source": "sessions:alice", "reason": "locked"} in partial
    assert only(body)["runs"][0]["usage"] is None and only(body)["runs"][0]["why"] == "store_unreadable"


# ------------------------------------------------------------------ orders, sessions, crons
def test_orders_are_the_journal_lines_of_the_window_without_their_free_fields(tmp_path):
    folder = tmp_path / "audit"
    A.append({"ts": NOW - 100, "id": "i1", "verb": "unblock", "result": "done", "board": "b", "task": "t1", "reason": SECRET, "len": 9,
              "before": {"status": "blocked"}, "after": {"status": "ready"}, "source": "page", "request": "abcdef0123456789"}, folder)
    A.append({"ts": NOW - 90, "id": "i2", "verb": "approval", "result": "refused", "choice": "deny", "profile": "alice", "source": "page"}, folder)
    A.append({"ts": NOW - 999_999, "id": "i3", "verb": "comment", "result": "done"}, folder)     # outside the window
    with open(folder / "audit.jsonl", "a") as fh:
        fh.write("not json\n" + json.dumps({"ts": NOW - 50, "verb": "unblock"}) + "\n")           # no id: not a journal line
    body, partial = replay([], audit_dir=folder)
    assert body["orders"] == [[NOW - 100, "unblock", "done", "b", "t1", None, None, "page"],
                              [NOW - 90, "approval", "refused", None, None, "alice", "deny", "page"]]
    assert SECRET not in json.dumps(body) and partial == []


def test_an_unreadable_journal_is_named_an_absent_one_is_not(tmp_path):
    body, partial = replay([], audit_dir=tmp_path / "nothing")
    assert body["orders"] == [] and partial == []
    (tmp_path / "dir" / "audit.jsonl").mkdir(parents=True)             # exists, cannot be read as a file
    body, partial = replay([], audit_dir=tmp_path / "dir")
    assert body["orders"] == [] and partial == [{"source": "audit", "reason": "unreadable"}]


def test_crons_and_sessions_are_facts_without_prompts_titles_or_errors(tmp_path):
    home = make_state(tmp_path / "alice", [("s1", "cli", NOW - 500, NOW - 400, "m", "p", 1, 1, 1, None, None),
                                           ("s2", "tui", NOW - 300, None, "m", "p", 0, 0, 0, None, None),
                                           ("s3", "kanban", NOW - 300, None, "m", "p", 1, 1, 1, None, None),
                                           ("s4", "tool", NOW - 300, None, "m", "p", 1, 1, 1, None, None),
                                           ("s5", "cron", NOW - 300, None, "m", "p", 1, 1, 1, None, None),
                                           ("s6", "cli", NOW - 900_000, None, "m", "p", 1, 1, 1, None, None),
                                           ("s7", "Weird Source!", NOW - 200, None, "m", "p", 1, 1, 1, None, None)])
    (home / "cron").mkdir()
    (home / "cron" / "jobs.json").write_text(json.dumps({"jobs": [{"id": "j1", "name": "nightly", "prompt": SECRET, "deliver": SECRET},
                                                                  {"id": "j2", "prompt": SECRET, "skills": ["weekly-review"]}, {"id": "j3"}]}))
    con = sqlite3.connect(home / "cron" / "executions.db")
    con.execute("CREATE TABLE executions (id INTEGER PRIMARY KEY, job_id TEXT, status TEXT, claimed_at TEXT, finished_at TEXT, error TEXT)")
    iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(t))   # noqa: E731
    for job, status, t in (("j1", "completed", NOW - 600), ("j1", "failed", NOW - 300), ("j2", "completed", NOW - 200), ("j1", "running", NOW - 100),
                           ("j1", "cancelled", NOW - 90), ("j1", "completed", NOW - 900_000), ("ghost", "completed", NOW - 50)):
        con.execute("INSERT INTO executions (job_id, status, claimed_at, finished_at, error) VALUES (?,?,?,?,?)", (job, status, iso(t), iso(t), SECRET))
    con.commit()
    con.close()
    body, partial = replay([], [("alice", home)])
    assert body["sessions"] == [["alice", "cli", NOW - 500, NOW - 400], ["alice", "tui", NOW - 300, None]]   # an open session has no end
    assert body["crons"] == [["alice", "nightly", NOW - 600, 1], ["alice", "nightly", NOW - 300, 0], ["alice", "weekly-review", NOW - 200, 1]]
    assert SECRET not in json.dumps(body) and partial == []


def test_a_cron_store_with_another_schema_is_named(tmp_path):
    home = tmp_path / "alice"
    (home / "cron").mkdir(parents=True)
    sqlite3.connect(home / "cron" / "executions.db").executescript("CREATE TABLE executions (id INTEGER PRIMARY KEY, other TEXT);")
    body, partial = replay([], [("alice", home)])
    assert body["crons"] == [] and partial == [{"source": "cron:alice", "reason": "schema"}]


# ------------------------------------------------------------------ usage
def usage_of(homes, frm=NOW - 86_400, to=NOW, **kw):
    with S.partial_scope() as flags:
        body = U.read_usage(homes, frm, to, prices=price_probe, **kw)
    return body, S.partial_list(flags)


def test_usage_totals_breakdown_and_routes(tmp_path):
    home = make_state(tmp_path / "alice",
                      [("s1", "kanban", NOW - 500, None, "example/x", "acme-cloud", 10, 100, 50, 0.1, None),
                       ("s2", "cli", NOW - 400, None, "example/model-max", "acme-plan-x", 4, 7, 8, 168.23, None),
                       ("s3", "cli", NOW - 300, None, "example/x", "acme-cloud", 0, 0, 0, None, None),         # no model call: no usage
                       ("s4", "cli", NOW - 900_000, None, "example/x", "acme-cloud", 9, 9, 9, 9.0, None)],    # outside the window
                      [("s1", "example/x", "acme-cloud", "", 10, 100, 50, 0.1, 0.0, "provider_models_api"),
                       ("s1", "example/x", "acme-cloud", "title_generation", 1, 5, 5, 0.02, 0.0, "provider_models_api"),
                       ("s2", "example/model-max", "acme-plan-x", "", 4, 7, 8, 168.23, 0.0, "provider_cost_api")])
    body, partial = usage_of([("alice", home)])
    assert partial == []
    p = body["profiles"][0]
    assert p["sessions"] == 2 and p["apiCalls"] == 14                  # s3 (no call) and s4 (outside) are not counted
    assert p["tokens"] == {"input": 107, "output": 58, "cacheRead": 14, "cacheWrite": 6, "reasoning": 4}   # the total is `sessions`, not the breakdown
    rows = {(m["model"], m["task"]): m for m in p["models"]}
    assert rows[("example/x", "")]["priced"] is True and rows[("example/x", "")]["usd"] == 0.1 and rows[("example/x", "")]["costKind"] == "estimated"
    assert rows[("example/x", "title_generation")]["usd"] == 0.02 and rows[("example/x", "title_generation")]["apiCalls"] == 1
    sub = rows[("example/model-max", "")]
    assert sub["priced"] is False and sub["usd"] is None and sub["costKind"] == "unpriced" and sub["costSource"] == "provider_cost_api"
    assert "168" not in json.dumps(body)                               # the subscription's list-price equivalent is never served as a cost
    assert {(r["model"], r["priced"]) for r in body["routes"]} == {("example/x", True), ("example/model-max", False)}
    assert "usd" not in body and "usd" not in p                        # never a sum across priced and unpriced routes


def test_a_real_cost_is_served_as_actual(tmp_path):
    home = make_state(tmp_path / "a", [("s1", "cli", NOW - 5, None, "example/x", "acme-cloud", 1, 1, 1, 0.1, 0.25)],
                      [("s1", "example/x", "acme-cloud", "", 1, 1, 1, 0.1, 0.25, "provider_cost_api")])
    m = usage_of([("a", home)])[0]["profiles"][0]["models"][0]
    assert (m["usd"], m["costKind"], m["priced"]) == (0.25, "actual", True)


def test_absent_usage_is_null_with_a_reason_never_zero(tmp_path):
    (tmp_path / "never-ran").mkdir()
    empty = make_state(tmp_path / "empty", [("s1", "cli", NOW - 900_000, None, "m", "p", 3, 1, 1, None, None)])
    nulls = make_state(tmp_path / "nulls", [("s1", "cli", NOW - 5, None, "m", "p", 3, None, -5, None, None)])   # NULL and a negative count: absent
    nobreak = make_state(tmp_path / "nobreak", [("s1", "cli", NOW - 5, None, "m", "p", 3, 4, 5, None, None)], schema=STATE_SCHEMA.split("CREATE TABLE session_model_usage")[0])
    body, partial = usage_of([("never-ran", tmp_path / "never-ran"), ("empty", empty), ("nulls", nulls), ("nobreak", nobreak)])
    by = {p["profile"]: p for p in body["profiles"]}
    assert (by["never-ran"]["sessions"], by["never-ran"]["tokens"], by["never-ran"]["reason"]) == (None, None, "missing")
    assert (by["empty"]["sessions"], by["empty"]["apiCalls"], by["empty"]["tokens"], by["empty"]["reason"]) == (0, None, None, "no_sessions")
    assert by["nulls"]["tokens"]["input"] is None and by["nulls"]["tokens"]["output"] is None and by["nulls"]["apiCalls"] == 3   # a NULL column is not 0
    assert by["nobreak"]["models"] is None and by["nobreak"]["reason"] == "no_breakdown" and by["nobreak"]["tokens"]["input"] == 4
    assert partial == [{"source": "sessions:nobreak", "reason": "schema"}]     # the missing store is said, not flagged: nothing was unreadable


def test_a_changed_or_unreadable_state_db_is_named(tmp_path):
    changed = tmp_path / "changed"
    changed.mkdir()
    sqlite3.connect(changed / "state.db").executescript("CREATE TABLE sessions (id TEXT, started_at REAL);")
    broken = tmp_path / "broken"
    broken.mkdir()
    (broken / "state.db").write_bytes(b"\x01not sqlite" * 400)
    good = make_state(tmp_path / "good", [("s1", "cli", NOW - 5, None, "m", "p", 1, 1, 1, None, None)])
    body, partial = usage_of([("changed", changed), ("broken", broken), ("good", good)])
    by = {p["profile"]: p for p in body["profiles"]}
    assert by["changed"]["reason"] == "schema" and by["changed"]["tokens"] is None
    assert by["broken"]["reason"] in ("unreadable", "schema") and by["broken"]["sessions"] is None and by["broken"]["tokens"] is None
    assert by["good"]["sessions"] == 1
    assert {"source": "sessions:changed", "reason": "schema"} in partial and any(p["source"] == "sessions:broken" for p in partial)


def test_the_breakdown_is_bounded_and_folds_the_rest(tmp_path):
    rows = [("s1", f"model-{i:02d}", "acme-cloud", "", 1, 100 - i, 1, 0.01, 0.0, "provider_models_api") for i in range(30)]
    home = make_state(tmp_path / "a", [("s1", "cli", NOW - 5, None, "m", "p", 30, 1, 1, None, None)], rows)
    p = usage_of([("a", home)])[0]["profiles"][0]
    assert len(p["models"]) == U.MAX_MODEL_ROWS and p["models"][-1]["task"] == "other" and p["models"][-1]["model"] is None
    assert p["models"][-1]["apiCalls"] == 30 - (U.MAX_MODEL_ROWS - 1)
    assert p["models"][0]["model"] == "model-00"                       # the biggest first
    assert p["models"][-1]["priced"] is True and p["models"][-1]["usd"] == 0.11   # every folded row is priced: their sum; mixed would be none
    mixed = [("s1", f"m{i}", "acme-cloud" if i % 2 else "sub", "", 1, 100 - i, 1, 0.01, 0.0, "x") for i in range(30)]
    home = make_state(tmp_path / "b", [("s1", "cli", NOW - 5, None, "m", "p", 30, 1, 1, None, None)], mixed)
    other = usage_of([("b", home)])[0]["profiles"][0]["models"][-1]
    assert other["priced"] is False and other["usd"] is None


def test_profiles_are_bounded(tmp_path):
    homes = [(f"p{i:02d}", tmp_path / f"p{i}") for i in range(45)]
    assert len(usage_of(homes)[0]["profiles"]) == U.MAX_PROFILES


def test_an_estimator_that_fails_means_price_unknown(tmp_path):
    def boom(model, provider):
        raise RuntimeError("no network")
    home = make_state(tmp_path / "a", [("s1", "cli", NOW - 5, None, "example/x", "acme-cloud", 1, 1, 1, 0.1, None)],
                      [("s1", "example/x", "acme-cloud", "", 1, 1, 1, 0.1, 0.0, "provider_models_api")])
    with S.partial_scope():
        m = U.read_usage([("a", home)], NOW - 100, NOW, prices=boom)["profiles"][0]["models"][0]
    assert m["priced"] is False and m["usd"] is None


# ------------------------------------------------------------------ the whitelist
def test_nothing_of_the_content_reaches_the_answer(fake_hermes):
    """Every place Hermes keeps content carries SECRET (card bodies and results, event payloads, run summaries and metadata,
    session titles, cron prompts and errors, audit reasons): the answers must not hold it, nor a forbidden key."""
    audit_dir = fake_hermes.tmp / "plugin-data"
    A.append({"ts": fake_hermes.now - 10, "id": "o1", "verb": "comment", "result": "done", "board": "b1", "task": "t1", "reason": SECRET, "len": 3}, audit_dir)
    client = TestClient(_app())
    for url in (f"{BASE}/replay", f"{BASE}/usage", f"{BASE}/replay?board=b1"):
        raw = client.get(url).text
        body = json.loads(raw)
        assert body["ok"] is True
        assert SECRET not in raw, url
        assert not FORBIDDEN_KEYS & {k for _, k in walk(body)}, (url, FORBIDDEN_KEYS & {k for _, k in walk(body)})
    replay_body = client.get(f"{BASE}/replay").json()
    assert replay_body["orders"] and all(len(o) == 8 for o in replay_body["orders"])
    for b in replay_body["boards"]:
        assert set(b) == {"slug", "since", "start", "cards", "facts", "runs", "silences"}
        assert all(len(f) == 5 for f in b["facts"]) and all(len(s) == 3 for s in b["start"])
        for r in b["runs"]:
            assert set(r) <= {"start", "end", "profile", "task", "outcome", "usage", "why"}
    assert set(replay_body) == {"ok", "at", "from", "to", "boards", "orders", "sessions", "crons", "truncated", "partial"}
    usage_body = client.get(f"{BASE}/usage").json()
    assert set(usage_body) == {"ok", "at", "from", "to", "attribution", "profiles", "routes", "partial"}
    for p in usage_body["profiles"]:
        assert set(p) == {"profile", "sessions", "apiCalls", "tokens", "models", "reason"}


def test_a_content_leak_would_be_caught(tmp_path, monkeypatch):
    """The whitelist test is not decorative: an extra that carried a payload text (the mutation this test stands for) is seen."""
    monkeypatch.setattr(R, "_extra", lambda kind, payload, task: (payload or {}).get("reason"))
    ev = [("t1", "created", None, NOW - 100), ("t1", "blocked", {"kind": "needs_input", "reason": SECRET}, NOW - 90)]
    body, _ = replay([("b", make_board(tmp_path / "k.db", [("t1", "One")], ev))])
    assert SECRET in json.dumps(body)


def test_the_module_reads_no_content_column():
    """The SQL of both modules never names a column that holds content."""
    text = "\n".join((ROOT / "hermes_officecraft" / name).read_text() for name in ("replay.py", "usage.py"))
    sql = " ".join(re.findall(r'"(SELECT[^"]*)"|f"(SELECT[^"]*)"', text, flags=re.S) and re.findall(r"SELECT[^\"]*", text))
    for column in ("body", "result", "summary", "metadata", "error", "title", "preview", "system_prompt", "model_config", "last_output"):
        if column == "title":
            continue   # `tasks.title` IS served (the card's current title); sessions.title never is: checked below
        assert not re.search(rf"\b{column}\b", sql), column
    assert not re.search(r"SELECT[^\"]*\btitle\b[^\"]*FROM sessions", text)


def test_the_replay_is_read_only(tmp_path):
    board = make_board(tmp_path / "k.db", [("t1", "One")], [("t1", "created", None, NOW - 10)])
    before = board.read_bytes()
    replay([("b", board)])
    assert board.read_bytes() == before
    con = S._ro(board)
    with pytest.raises(sqlite3.OperationalError):
        con.execute("DELETE FROM tasks")
    con.close()


# ------------------------------------------------------------------ edge cases
def test_the_windows_are_bounded_to_the_second():
    """7 days and 31 days exactly are served, one second more is refused (the `8 days` case let `> longest + 1` pass)."""
    client = TestClient(_app())
    now = int(time.time())
    assert client.get(f"{BASE}/replay?from={now - 7 * 86_400 - 1}&to={now}").status_code == 422
    assert client.get(f"{BASE}/usage?from={now - 31 * 86_400}&to={now}").status_code != 422
    assert client.get(f"{BASE}/usage?from={now - 31 * 86_400 - 1}&to={now}").status_code == 422


def test_a_silence_starts_after_five_minutes_not_ten(tmp_path):
    """A 400 s gap between two heartbeats is a silence (five minutes), a 300 s gap is not."""
    ev = [("t1", "created", None, NOW - 5000), ("t1", "claimed", None, NOW - 4000, 1),
          ("t1", "heartbeat", None, NOW - 3700, 1),          # 300 s after the start: not a silence
          ("t1", "heartbeat", None, NOW - 3300, 1),          # 400 s later: silent from NOW-3400 to NOW-3300
          ("t1", "completed", None, NOW - 3290, 1)]
    body, _ = replay([("b", make_board(tmp_path / "k.db", [("t1", "One")], ev, [(1, "t1", "alice", NOW - 4000, NOW - 3290, "completed")]))])
    assert only(body)["silences"] == [["alice", "t1", NOW - 3400, NOW - 3300]]


def test_a_run_opened_just_before_to_keeps_its_session_link(tmp_path):
    """Hermes writes `owner_admitted` a second or two after `claimed`: a run opened just before the end of a past window is
    still linked to its session (its usage is served), never said `no_session_link`."""
    ev = [("t1", "created", None, NOW - 3000), ("t1", "claimed", None, NOW - 1, 1), ("t1", "owner_admitted", {"session_id": "s1"}, NOW + 2, 1)]
    board = make_board(tmp_path / "k.db", [("t1", "One")], ev, [(1, "t1", "alice", NOW - 1, None, None)])
    alice = make_state(tmp_path / "alice", [("s1", "kanban", NOW + 2, None, "example/x", "acme-cloud", 3, 10, 20, 0.01, None)])
    run = only(replay([("b", board)], [("alice", alice)], now=NOW + 60)[0])["runs"][0]
    assert run["usage"] is not None and run["usage"]["apiCalls"] == 3 and "why" not in run
