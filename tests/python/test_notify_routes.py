"""Notifications: routes per type and per recipient, quiet hours, the four new types (campaign, review,
llm_cap, trophy), the test message, readable messages (5 typical cases, 3 languages) and injection per platform.
No Hermes, no network: the store, the sender and the kanban are fakes."""

import json
import re
import sqlite3
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from test_notify import BASE, NOW, N, Store, World, api_module, blocked, board, task  # noqa: F401 - the notify module as the gateway loads it

SN = N.__name__.rsplit(".", 1)[0]
T1, T2, T3 = "telegram#aaaaaaaa", "discord#bbbbbbbb", "slack#cccccccc"
TARGETS = [{"key": k, "platform": k.split("#")[0], "label": k[-4:], "source": "cron", "target": f"{k.split('#')[0]}:{i}"}
           for i, k in enumerate((T1, T2, T3), 1)]


def at(hour, minute=0):
    """An epoch whose LOCAL time (the server's) is hour:minute on a fixed day: the tests hold in any time zone."""
    return time.mktime((2026, 11, 16, hour, minute, 0, 0, 0, -1))


class W2(World):
    """A fake Hermes with several recipients and routes."""

    def __init__(self, routes, quiet=None, lang="en", start=NOW):
        super().__init__(types=())
        self.clock.t = start
        self.targets = [dict(t) for t in TARGETS]
        self.failing: set = set()
        self.store.set(N.SETTINGS_KEY, {"types": {t: True for t in routes}, "routes": routes, "quiet": quiet or N.default_quiet(), "lang": lang})

    def _send(self, target, message):
        self.sent.append((target, message))
        return {"success": target not in self.failing}

    def to(self, target):
        return [m for t, m in self.sent if t == target]


def blocked_cards(*ids, slug="b", titles=None):
    return board(slug, *[task(i, "blocked", (titles or {}).get(i, f"Card {i[-1]}")) for i in ids])


# ================================================================ migration of the settings (the single-target shape of the first version)
LEGACY_SETTINGS = {"types": {"decision": True, "silent": True, "gateway": True, "cron": True}, "target": "telegram#1a2b3c4d", "lang": "fr", "label": "Officecraft"}
LEGACY_STATE = {"armed": {"decision": True, "silent": True, "gateway": True, "cron": True},
              "seen": {"decision:alpha:t_00000001": NOW - 900, "decision:beta:t_00000002": NOW - 800, "silent:alpha:t_00000003": NOW - 700, "gateway:24680": NOW - 8900},
              "sent": [NOW - 3000, NOW - 2000, NOW - 1000], "retry_after": 0, "last": {"success": True, "count": 1, "at": NOW - 1000},
              "pid": 24680, "alive": NOW - 5, "return": {"key": "gateway:24680", "from": NOW - 9000, "to": NOW - 8900}}


def test_legacy_settings_migrate_without_losing_anything_and_nothing_is_rewritten():
    s = N.clean_settings(LEGACY_SETTINGS)
    assert s["routes"] == {**{t: ["telegram#1a2b3c4d"] for t in N.LEGACY_TYPES}, **{t: [] for t in N.TYPES[4:]}}
    assert all(s["types"][t] for t in N.LEGACY_TYPES) and not any(s["types"][t] for t in N.TYPES[4:])
    assert s["lang"] == "fr" and s["label"] == "Officecraft" and s["quiet"] == N.default_quiet() and not s["quiet"]["enabled"]
    store = Store()
    store.set(N.SETTINGS_KEY, LEGACY_SETTINGS)
    N.load_settings(store)
    N.settings_payload(store, [{"key": "telegram#1a2b3c4d", "platform": "telegram", "label": "…1234", "source": "cron", "target": "telegram:1"}])
    assert store.data[N.SETTINGS_KEY] == LEGACY_SETTINGS         # reading migrates in memory only: the stored settings are untouched (diff empty)
    # an older page still reads one ``target``
    payload = N.settings_payload(store, [{"key": "telegram#1a2b3c4d", "platform": "telegram", "label": "x", "source": "cron", "target": "telegram:1"}])
    assert payload["settings"]["target"] == "telegram#1a2b3c4d" and payload["settings"]["routes"]["decision"] == ["telegram#1a2b3c4d"]


def test_a_legacy_target_with_no_type_enabled_is_kept_for_the_four_legacy_types():
    s = N.clean_settings({"types": {}, "target": "telegram#1a2b3c4d"})
    assert [t for t in N.TYPES if s["routes"][t]] == list(N.LEGACY_TYPES)
    only = N.clean_settings({"types": {"cron": True}, "target": "telegram#1a2b3c4d"})
    assert [t for t in N.TYPES if only["routes"][t]] == ["cron"]          # the spec: the route of each ENABLED type


def test_the_legacy_memory_becomes_the_memory_of_the_recipient_and_nothing_is_said_twice():
    w = World(types=N.LEGACY_TYPES)
    w.store.set(N.SETTINGS_KEY, LEGACY_SETTINGS)
    w.targets = [{"key": "telegram#1a2b3c4d", "platform": "telegram", "label": "…1", "source": "cron", "target": "telegram:1"}]
    w.store.set(N.STATE_KEY, LEGACY_STATE)
    w.boards = [board("alpha", task("t_00000001", "blocked", "API3 — One")), board("beta", task("t_00000002", "blocked"))]
    assert w.tick() is None and w.sent == []                                  # what was already told is not told again
    state = w.store.get(N.STATE_KEY)
    assert state["v"] == 2 and state["pid"] == 24680 and state["return"]["key"] == "gateway:24680"
    assert set(state["seen"]["telegram#1a2b3c4d"]) >= {"decision:alpha:t_00000001", "decision:beta:t_00000002"}
    assert len(state["sent"]["telegram#1a2b3c4d"]) == 3                       # the hourly count follows
    w.boards.append(board("b3", task("t_00000009", "blocked", "NEW1 — New one")))
    w.tick(30)
    assert len(w.sent) == 1 and "NEW1" in w.sent[0][1]


# ================================================================ routes: one message per recipient
def test_the_facts_of_a_pass_leave_grouped_by_recipient_and_each_type_goes_where_it_is_routed():
    w = W2({"decision": [T1, T2], "silent": [T2], "cron": [T3]})
    w.boards = [board("b")]
    w.ops = {"gateway": None, "crons": []}
    w.tick()
    w.boards = [board("b", task("t_00000001", "blocked", "API3 — One"), task("t_00000002", "running", "Two", startedAt=NOW - 2000))]
    w.ops = {"gateway": None, "crons": [{"name": "digest", "profile": "default", "enabled": True, "last_status": "error", "last_run_at": NOW}]}
    w.tick(30)
    assert len(w.sent) == 3                                                    # one message per recipient, never one per fact
    assert sorted(t for t, _ in w.sent) == ["discord:2", "slack:3", "telegram:1"]
    assert "One" in w.to("telegram:1")[0] and "Two" not in w.to("telegram:1")[0]            # Telegram: decisions only
    assert "One" in w.to("discord:2")[0] and "Two" in w.to("discord:2")[0] and "digest" not in w.to("discord:2")[0]
    assert "digest" in w.to("slack:3")[0] and "One" not in w.to("slack:3")[0]
    w.tick(30)
    assert len(w.sent) == 3                                                    # no repeat, per recipient


def test_a_recipient_that_fails_does_not_hold_the_others_back():
    w = W2({"decision": [T1, T2]})
    w.boards = [board("b")]
    w.tick()
    w.failing = {"discord:2"}
    w.boards = [blocked_cards("t_00000001")]
    w.tick(30)
    assert len(w.to("telegram:1")) == 1 and len(w.to("discord:2")) == 1
    state = w.store.get(N.STATE_KEY)
    assert state["retry_after"][T2] > 0 and not state["retry_after"].get(T1) and len(state["sent"][T1]) == 1 and len(state["sent"].get(T2, [])) == 0
    w.boards = [blocked_cards("t_00000001", "t_00000002")]
    w.tick(30)                                                                 # Telegram keeps going; Discord waits for its backoff
    assert len(w.to("telegram:1")) == 2 and len(w.to("discord:2")) == 1
    w.failing = set()
    w.tick(N.RETRY_AFTER_S)                                                    # the backoff over: Discord gets BOTH facts, together
    assert len(w.to("discord:2")) == 2 and "2 decisions" in w.to("discord:2")[1].replace("**", "")
    assert len(w.to("telegram:1")) == 2


def test_a_sender_that_raises_holds_back_only_its_own_recipient_whatever_the_order():
    """The failing recipient sorts AFTER the healthy one here, and its send raises instead of answering."""
    w = W2({"decision": [T1, T2]})
    w.boards = [board("b")]
    w.tick()

    def send(target, message):
        w.sent.append((target, message))
        if target == "telegram:1":
            raise ConnectionError("telegram down")
        return {"success": True}
    w.n.send = send
    for i in range(1, 3):
        w.boards = [blocked_cards(*[f"t_0000000{j}" for j in range(1, i + 1)])]
        w.tick(30)
        assert len(w.to("discord:2")) == i                                     # Discord keeps going on every pass
    state = w.store.get(N.STATE_KEY)
    assert state["retry_after"][T1] > 0 and not state["retry_after"].get(T2) and len(w.to("telegram:1")) == 1


def test_a_blocked_card_of_the_test_pool_is_never_a_decision():
    facts = N.detect([board("b", task("t_00000001", "blocked", "[POOL] blocked test 1"), task("t_00000002", "blocked", "API3 — real one"))], {}, NOW)
    assert [f["task"] for f in facts if f["type"] == "decision"] == ["t_00000002"]


def test_the_hourly_cap_is_per_recipient():
    w = W2({"decision": [T1], "silent": [T2]})
    w.boards = [board("b")]
    w.tick()
    for i in range(N.HOURLY_CAP):
        w.boards = [board("b", *[task(f"t_{j:08x}", "blocked") for j in range(i + 1)])]
        w.tick(60)
    assert len(w.to("telegram:1")) == N.HOURLY_CAP
    w.boards = [board("b", *[task(f"t_{j:08x}", "blocked") for j in range(N.HOURLY_CAP + 1)],
                      task("t_ffffff01", "running", "Silent one", startedAt=int(w.clock.t) - 4000)) ]
    w.tick(60)
    assert len(w.to("telegram:1")) == N.HOURLY_CAP                             # Telegram is at its cap: held back, not lost
    assert len(w.to("discord:2")) == 1                                         # Discord has its own count
    w.tick(3600)
    assert len(w.to("telegram:1")) == N.HOURLY_CAP + 1


def test_a_recipient_added_to_a_route_starts_from_its_own_baseline():
    w = W2({"decision": [T1]})
    w.boards = [blocked_cards("t_00000001")]
    w.tick()
    w.boards = [blocked_cards("t_00000001", "t_00000002")]
    w.tick(30)
    assert len(w.to("telegram:1")) == 1
    s = w.store.get(N.SETTINGS_KEY)
    w.store.set(N.SETTINGS_KEY, {**s, "routes": {"decision": [T1, T2]}})
    w.tick(30)
    assert w.to("discord:2") == []                                             # the past is not told to the newcomer
    w.boards = [blocked_cards("t_00000001", "t_00000002", "t_00000003")]
    w.tick(30)
    assert len(w.to("discord:2")) == 1 and len(w.to("telegram:1")) == 2


def test_unknown_routes_are_dropped_and_a_type_without_a_route_sends_nothing():
    assert N._route_list([T1, T1, "../x", T2, T3, "a#bbbbbbbb", "b#bbbbbbbb", "c#bbbbbbbb"]) == [T1, T2, T3, "a#bbbbbbbb"]   # 4 at most, no duplicate
    w = W2({"decision": ["telegram#deadbeef"]})                                # a recipient Hermes no longer knows
    w.boards = [board("b")]
    w.tick()
    w.boards = [blocked_cards("t_00000001")]
    assert w.tick(30) is None and w.sent == []


# ================================================================ the routes of the settings
@pytest.fixture
def client(monkeypatch):
    store = Store()
    monkeypatch.setattr(N, "_state_store", lambda: store)
    monkeypatch.setattr(N, "hermes_targets", lambda: [dict(t) for t in TARGETS])
    app = FastAPI()
    app.include_router(api_module.router, prefix=BASE)
    c = TestClient(app)
    c.store = store
    return c


def test_post_notify_saves_routes_and_quiet_hours_and_refuses_what_hermes_does_not_know(client):
    body = {"types": {"decision": True, "review": True}, "routes": {"decision": [T1, T2], "review": [T3]}, "lang": "fr",
            "quiet": {"enabled": True, "from": "23:00", "to": "06:30", "urgent": ["gateway", "cron"]}}
    ok = client.post(f"{BASE}/notify", json=body)
    assert ok.status_code == 200
    s = ok.json()["settings"]
    assert s["routes"]["decision"] == [T1, T2] and s["routes"]["review"] == [T3] and s["routes"]["cron"] == []
    assert s["quiet"] == {"enabled": True, "from": "23:00", "to": "06:30", "urgent": ["gateway", "cron"]} and s["types"]["review"] is True
    assert ok.json()["timezone"]["offset"] and ok.json()["testLimits"] == {"perMinute": 1, "perDay": 10} and ok.json()["maxRoutes"] == 4
    assert client.store.data[N.SETTINGS_KEY]["routes"]["decision"] == [T1, T2]
    # a body that does not name routes or quiet keeps them
    again = client.post(f"{BASE}/notify", json={"types": {"decision": True}, "lang": "en"}).json()["settings"]
    assert again["routes"]["decision"] == [T1, T2] and again["quiet"]["enabled"] is True and again["types"]["review"] is False
    for bad in ({"types": {}, "routes": {"decision": ["telegram#bbbbbbbb"]}},        # unknown to Hermes
                ):
        r = client.post(f"{BASE}/notify", json=bad)
        assert r.status_code == 422 and r.json() == {"ok": False, "reason": "unknown_target"}
    for bad in ({"types": {}, "routes": {"decision": [T1, T2, T3, T1, T2]}},           # more than 4
                {"types": {}, "routes": {"decision": ["telegram:1234"]}},                # a raw chat id
                {"types": {}, "routes": {"ci": [T1]}},                                   # a type that does not exist (no « CI red »)
                {"types": {"ci": True}},
                {"types": {}, "quiet": {"enabled": True, "from": "25:00", "to": "06:00"}},
                {"types": {}, "quiet": {"enabled": True, "urgent": ["nope"]}}):
        assert client.post(f"{BASE}/notify", json=bad).status_code == 422, bad
    assert client.get(f"{BASE}/notify").json()["settings"]["routes"]["decision"] == [T1, T2]      # untouched by the refusals


def test_an_older_page_still_works_with_its_single_target(client):
    r = client.post(f"{BASE}/notify", json={"types": {"decision": True, "cron": True}, "target": T1, "lang": "fr"})
    assert r.status_code == 200 and r.json()["settings"]["target"] == T1
    assert r.json()["settings"]["routes"]["decision"] == [T1] and r.json()["settings"]["routes"]["cron"] == [T1]
    assert client.post(f"{BASE}/notify", json={"types": {}, "target": None}).json()["settings"]["routes"]["decision"] == []


# ================================================================ quiet hours
QUIET = {"enabled": True, "from": "22:00", "to": "07:00", "urgent": []}


def test_the_quiet_range_may_cross_midnight_and_an_empty_range_has_no_effect():
    q = QUIET
    assert N.in_quiet(q, at(23, 0)) and N.in_quiet(q, at(0, 0)) and N.in_quiet(q, at(6, 59)) and N.in_quiet(q, at(22, 0))
    assert not N.in_quiet(q, at(7, 0)) and not N.in_quiet(q, at(12, 0)) and not N.in_quiet(q, at(21, 59))
    day = {**QUIET, "from": "13:00", "to": "14:00"}                            # a range inside the day
    assert N.in_quiet(day, at(13, 30)) and not N.in_quiet(day, at(14, 0)) and not N.in_quiet(day, at(12, 59))
    assert not N.in_quiet({**QUIET, "from": "08:00", "to": "08:00"}, at(8, 0))   # from == to: empty, no effect (as the night replay)
    assert not N.in_quiet({**QUIET, "enabled": False}, at(23, 0)) and not N.in_quiet(N.default_settings()["quiet"], at(23, 0))
    assert not N.in_quiet({"enabled": True, "from": "99:00", "to": "07:00"}, at(23, 0)) and not N.in_quiet(None, at(23, 0))


def test_during_quiet_hours_facts_are_kept_then_one_summary_leaves_at_the_end():
    w = W2({"decision": [T1, T2]}, quiet=QUIET, lang="fr", start=at(21, 0))
    w.boards = [board("b")]
    w.tick()
    w.clock.t = at(22, 30)                                                      # the night begins
    w.boards = [blocked_cards("t_00000001", "t_00000002", "t_00000003", titles={"t_00000001": "API3 — One", "t_00000002": "API4 — Two", "t_00000003": "API5 — Three"})]
    for _ in range(3):
        w.tick(600)
    assert w.sent == []                                                         # kept, not sent
    assert len(w.store.get(N.STATE_KEY)["held"][T1]) == 3
    w.boards = [blocked_cards("t_00000001", "t_00000003", titles={"t_00000001": "API3 — One", "t_00000003": "API5 — Three"})]   # API4 was resolved
    w.clock.t = at(6, 50)
    w.tick(0)
    assert w.sent == []                                                         # still quiet at 06:50
    w.clock.t = at(7, 5)
    w.tick(0)
    assert len(w.sent) == 2                                                     # ONE summary per recipient
    for _, text in w.sent:
        assert "Heures calmes 22:00–07:00" in text and "2 à voir" in text and "1 résolu entre-temps" in text
        assert "API3" in text and "API5" in text and "API4" not in text        # only what is still true
    w.tick(30)
    assert len(w.sent) == 2 and w.store.get(N.STATE_KEY)["held"][T1] == {}
    # the next fact of the day leaves at once, as a normal message
    w.boards = [blocked_cards("t_00000001", "t_00000003", "t_00000004", titles={"t_00000004": "API6 — Four"})]
    w.tick(30)
    assert len(w.sent) == 4 and "Pendant" not in w.sent[2][1] and "API6" in w.sent[2][1]


def test_when_everything_was_resolved_during_the_night_no_summary_is_sent():
    w = W2({"decision": [T1]}, quiet=QUIET, start=at(22, 30))
    w.boards = [board("b")]
    w.tick()
    w.boards = [blocked_cards("t_00000001")]
    w.tick(60)
    w.boards = [board("b")]
    w.clock.t = at(8, 0)
    w.tick(0)
    w.tick(30)
    assert w.sent == [] and w.store.get(N.STATE_KEY)["held"][T1] == {}


def test_urgent_types_leave_at_once_during_quiet_hours_the_others_wait():
    w = W2({"decision": [T1], "cron": [T1]}, quiet={**QUIET, "urgent": ["cron"]}, start=at(23, 0))
    w.boards = [board("b")]
    w.ops = {"gateway": None, "crons": []}
    w.tick()
    w.boards = [blocked_cards("t_00000001")]
    w.ops = {"gateway": None, "crons": [{"name": "digest", "profile": "default", "enabled": True, "last_status": "error", "last_run_at": int(w.clock.t)}]}
    w.tick(30)
    assert len(w.sent) == 1 and "digest" in w.sent[0][1] and "Card 1" not in w.sent[0][1]
    w.clock.t = at(7, 1)
    w.tick(0)
    assert len(w.sent) == 2 and "Card 1" in w.sent[1][1]


def test_quiet_hours_are_per_recipient_and_a_recipient_in_backoff_keeps_its_summary():
    w = W2({"decision": [T1, T2]}, quiet=QUIET, start=at(23, 0))
    w.boards = [board("b")]
    w.tick()
    w.boards = [blocked_cards("t_00000001")]
    w.tick(30)
    w.clock.t = at(7, 5)
    w.failing = {"discord:2"}
    w.tick(0)
    assert len(w.to("telegram:1")) == 1 and len(w.to("discord:2")) == 1          # the summary was tried on both
    assert w.store.get(N.STATE_KEY)["held"][T2] != {}                              # Discord's stays kept
    w.failing = set()
    w.tick(N.RETRY_AFTER_S)
    assert len(w.to("discord:2")) == 2 and len(w.to("telegram:1")) == 1


# ================================================================ the new types
def test_no_ci_type_exists():
    assert N.TYPES == ("decision", "silent", "gateway", "cron", "campaign", "review", "llm_cap", "trophy") and not any("ci" == t for t in N.TYPES)
    assert all(v is False for v in N.default_settings()["types"].values())      # every one OFF by default


def kdb(path, tasks, events=(), links=()):
    """A kanban database as Hermes writes it (the columns the readers use)."""
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, status TEXT, assignee TEXT, created_at INT, started_at INT, completed_at INT, last_heartbeat_at INT, idempotency_key TEXT, created_by TEXT)")
    con.execute("CREATE TABLE task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, run_id INT, kind TEXT, payload TEXT, created_at INT)")
    con.execute("CREATE TABLE task_links (parent_id TEXT, child_id TEXT)")
    for t in tasks:
        con.execute("INSERT INTO tasks (id, title, status, assignee, created_at, idempotency_key, created_by) VALUES (?,?,?,?,?,?,?)",
                    (t[0], t[1], t[2], t[3] if len(t) > 3 else None, NOW - 9999, t[4] if len(t) > 4 else None, t[5] if len(t) > 5 else None))
    for e in events:
        con.execute("INSERT INTO task_events (task_id, run_id, kind, payload, created_at) VALUES (?,?,?,?,?)", (e[0], e[1], e[2], json.dumps(e[3]) if e[3] is not None else None, e[4]))
    con.executemany("INSERT INTO task_links VALUES (?,?)", links)
    con.commit()
    con.close()


CID = "0123abcd-0123-4abc-8abc-0123456789ab"
OFFICECRAFT = "officecraft"


def test_the_reader_finds_the_real_kanban_sources_of_a_refused_review(tmp_path):
    """``kanban_request_changes`` appends a ``changes_requested`` event (kanban_db.py request_changes); a reviewer that blocks
    ``needs_input`` leaves a ``blocked`` event whose run was claimed from ``review`` (``source_status``)."""
    from importlib import import_module
    snap = import_module(SN + ".snapshot")
    db = tmp_path / "kanban.db"
    kdb(db, [("t_00000001", "R1 — a", "ready", "backend"), ("t_00000002", "R2 — b", "blocked", "reviewer"), ("t_00000003", "R3 — c", "blocked", "frontend"),
             ("t_00000004", "R4 — d", "review", "reviewer"), ("t_00000005", "R5 — e", "done", "backend"), ("t_00000006", "R6 — f", "ready", "backend")],
         events=[("t_00000001", 5, "changes_requested", {"reason": "SECRET-REASON", "implementer": "backend"}, NOW - 600),
                 ("t_00000002", 7, "claimed", {"source_status": "review"}, NOW - 900),
                 ("t_00000002", 7, "blocked", {"reason": "SECRET-REASON", "kind": "needs_input", "source_status": "running"}, NOW - 500),
                 ("t_00000003", 8, "claimed", {"source_status": "ready"}, NOW - 900),
                 ("t_00000003", 8, "blocked", {"reason": "x", "kind": "needs_input", "source_status": "running"}, NOW - 400),
                 ("t_00000004", 9, "changes_requested", {}, NOW - 800), ("t_00000004", 9, "review_requested", {}, NOW - 100),     # re-submitted
                 ("t_00000005", 9, "changes_requested", {}, NOW - 800), ("t_00000005", 9, "completed", {}, NOW - 100),            # finished
                 ("t_00000006", 9, "changes_requested", {}, NOW - 9 * 86400)])                                                    # old news
    ex = snap.read_notify_extras(db, "work", now=NOW)
    assert sorted((r["task"], r["kind"]) for r in ex["reviews"]) == [("t_00000001", "changes"), ("t_00000002", "blocked")]
    assert ex["blockedAt"] == {"t_00000002": NOW - 500, "t_00000003": NOW - 400}
    assert "SECRET-REASON" not in json.dumps(ex)                                      # ids, kinds and times only


@pytest.mark.parametrize("word", ["Guard", "Garde"])   # what is written now, and what earlier campaigns hold
def test_the_reader_finds_campaigns_ready_to_launch_and_finished(tmp_path, word):
    from importlib import import_module
    snap = import_module(SN + ".snapshot")
    k = lambda ref: f"oc-camp:{CID}:{ref}"    # noqa: E731
    db = tmp_path / "kanban.db"
    kdb(db, [("t_g0000000", f"{word} — Onboarding redesign", "blocked", None, k("G0"), OFFICECRAFT),
             ("t_g0000001", f"{word} phase B — The page", "blocked", None, k("G1"), OFFICECRAFT),
             ("t_c0000001", "Card 1", "done", "backend", k("c1"), OFFICECRAFT), ("t_c0000002", "Card 2", "done", "backend", k("c2"), OFFICECRAFT),
             ("t_c0000003", "Card 3", "todo", "frontend", k("c3"), OFFICECRAFT),
             ("t_f0000000", "Fake guard", "blocked", None, k("G2"), "someone-else")],       # not written by Officecraft: ignored
         links=[("t_g0000000", "t_c0000001"), ("t_g0000000", "t_c0000002"), ("t_c0000001", "t_g0000001"), ("t_c0000002", "t_g0000001"), ("t_g0000001", "t_c0000003")])
    (camp,) = snap.read_notify_extras(db, "work")["campaigns"]
    assert camp["name"] == "Onboarding redesign" and camp["cards"] == 3 and camp["done"] is False
    assert [(p["phase"], p["name"], p["count"]) for p in camp["phases"]] == [(0, "", 2), (1, "The page", 1)]    # head ready; phase B ready: its cards are done
    # the last card of phase A is not finished: phase B is not ready
    con = sqlite3.connect(db)
    con.execute("UPDATE tasks SET status='running' WHERE id='t_c0000002'")
    con.commit()
    con.close()
    assert [p["phase"] for p in snap.read_notify_extras(db, "work")["campaigns"][0]["phases"]] == [0]
    con = sqlite3.connect(db)
    con.execute("UPDATE tasks SET status='done' WHERE idempotency_key LIKE '%:c%'")
    con.execute("UPDATE tasks SET status='done' WHERE idempotency_key LIKE '%:G%'")
    con.commit()
    con.close()
    (camp,) = snap.read_notify_extras(db, "work")["campaigns"]
    assert camp["done"] is True and camp["phases"] == []


def facts_of(w_extra, boards=None, **kw):
    return N.detect(boards or [], {"gateway": None, "crons": []}, NOW, extras=w_extra, **kw)


def test_campaign_facts_ready_phase_and_finished_with_their_fields_and_exclusions():
    ex = [{"slug": "alpha", "campaigns": [{"id": "0123abcd", "name": "Redesign", "cards": 6, "done": False,
                                                 "phases": [{"phase": 0, "name": "", "count": 2}, {"phase": 1, "name": "The page", "count": 4}]},
                                                {"id": "ffffffff", "name": "Finished", "cards": 3, "done": True, "phases": []},
                                                {"id": "eeeeeeee", "name": "[test] throwaway", "cards": 1, "done": True, "phases": []}]},
          {"slug": "sandbox-alpha", "campaigns": [{"id": "dddddddd", "name": "Sandbox", "cards": 1, "done": True, "phases": []}]}]
    boards = [board("alpha"), board("sandbox-alpha")]
    f = [x for x in facts_of(ex, boards) if x["type"] == "campaign"]
    assert sorted((x["state"], x.get("phase"), x["count"], x["name"]) for x in f) == [("camp_done", None, 3, "Finished"), ("camp_ready", 0, 2, "Redesign"), ("camp_ready", 1, 4, "Redesign")]
    assert all(x["board"] == "alpha" for x in f)                                 # sandbox excluded; the test campaign excluded


def test_a_ready_guard_is_said_by_the_campaign_type_and_not_twice_as_a_decision():
    guard = {**task("t_g0000000", "blocked", "Guard — Redesign", None), "guard": True, "head": True, "campaign": "0123abcd"}
    ex = [{"slug": "alpha", "campaigns": [{"id": "0123abcd", "name": "Redesign", "cards": 2, "done": False, "phases": [{"phase": 0, "name": "", "count": 2}]}]}]
    w = W2({"decision": [T1], "campaign": [T1]})
    w.boards = [board("alpha")]
    w.tick()
    w.boards = [board("alpha", guard)]
    w.extra = {"extras": ex}
    w.tick(30)
    assert len(w.sent) == 1 and "1 campaign update" in w.sent[0][1] and "decision" not in w.sent[0][1]
    w2 = W2({"decision": [T1]})                                                         # campaigns not routed: the guard stays a decision (as before)
    w2.boards = [board("alpha")]
    w2.tick()
    w2.boards = [board("alpha", guard)]
    w2.extra = {"extras": ex}
    w2.tick(30)
    assert len(w2.sent) == 1 and "1 decision is waiting for you" in w2.sent[0][1]


def test_review_facts_come_from_the_events_and_the_test_pool_and_sandbox_are_excluded():
    boards = [board("alpha", task("t_00000001", "ready", "API3 — One", "backend"), task("t_00000002", "blocked", "R2 — Two", "reviewer"),
                    task("t_00000003", "ready", "[POOL] comment test 1", "backend")),
              board("sandbox-alpha", task("t_00000004", "ready", "[S2.2] x", "backend"))]
    ex = [{"slug": "alpha", "blockedAt": {"t_00000002": NOW - 500},
           "reviews": [{"task": "t_00000001", "event": 12, "ts": NOW - 600, "kind": "changes"}, {"task": "t_00000002", "event": 13, "ts": NOW - 500, "kind": "blocked"},
                       {"task": "t_00000003", "event": 14, "ts": NOW - 500, "kind": "changes"}]},
          {"slug": "sandbox-alpha", "reviews": [{"task": "t_00000004", "event": 1, "ts": NOW, "kind": "changes"}]}]
    facts = facts_of(ex, boards)
    reviews = sorted((x["state"], x["task"]) for x in facts if x["type"] == "review")
    assert reviews == [("review_blocked", "t_00000002"), ("review_changes", "t_00000001")]
    decision = next(x for x in facts if x["type"] == "decision")
    assert decision["covered_by"] == "review" and decision["since"] == NOW - 500          # the same card is not said twice
    assert not any("POOL" in (x.get("title") or "") for x in facts)


def test_the_llm_cap_at_90_percent_then_at_the_cap_once_per_month_and_per_cap():
    spend = lambda usd, calls=0, month="2026-11": {"month": month, "usd": usd, "calls": calls}     # noqa: E731
    cfg = {"capUsd": 5.0, "callCap": 100}
    assert N.llm_cap_facts({"spend": spend(4.0), "settings": cfg}) == []
    (f,) = N.llm_cap_facts({"spend": spend(4.5), "settings": cfg})
    assert f["state"] == "llm_90" and f["kind"] == "usd" and f["pct"] == 90 and f["key"] == "llm_cap:2026-11:usd:90"
    (f,) = N.llm_cap_facts({"spend": spend(5.0), "settings": cfg})
    assert f["state"] == "llm_cap" and f["key"] == "llm_cap:2026-11:usd:cap"
    both = N.llm_cap_facts({"spend": spend(1.0, calls=100), "settings": cfg})
    assert [(x["kind"], x["state"]) for x in both] == [("calls", "llm_cap")]
    assert N.llm_cap_facts({"spend": spend(9.0), "settings": {"capUsd": 0, "callCap": 0}}) == []     # no budget to watch
    assert N.llm_cap_facts({"spend": spend(float("nan")), "settings": cfg}) == [] and N.llm_cap_facts(None) == []
    w = W2({"llm_cap": [T1]})
    w.boards = [board("b")]
    w.extra = {"llm": {"spend": spend(1.0), "settings": cfg}}
    w.tick()
    w.extra = {"llm": {"spend": spend(4.6), "settings": cfg}}
    w.tick(30)
    w.tick(30)
    assert len(w.sent) == 1 and "💳" in w.sent[0][1] and "92%" in w.sent[0][1] and "$4.6 of $5" in w.sent[0][1]
    w.extra = {"llm": {"spend": spend(5.2), "settings": cfg}}
    w.tick(30)
    assert len(w.sent) == 2 and "cap reached" in w.sent[1][1]
    w.extra = {"llm": {"spend": spend(0.2, month="2026-12"), "settings": cfg}}          # a new month starts again
    w.tick(30)
    w.extra = {"llm": {"spend": spend(5.1, month="2026-12"), "settings": cfg}}
    w.tick(30)
    assert len(w.sent) == 3


def test_the_trophy_route_is_idempotent_whitelisted_and_only_a_page_open_can_feed_it(client):
    client.post(f"{BASE}/notify", json={"types": {"trophy": True}, "routes": {"trophy": [T1]}})
    one = {"trophies": [{"id": "zero_fail", "name": "Clean sweep", "tier": "silver"}]}
    a = client.post(f"{BASE}/notify/trophy", json=one).json()
    b = client.post(f"{BASE}/notify/trophy", json=one).json()                              # a second tab sees the same trophy
    assert a == {"ok": True, "recorded": 1, "notify": 1, "firstSync": False} and b["recorded"] == 0 and b["notify"] == 0
    assert len(client.store.data[N.TROPHY_KEY]["pending"]) == 1
    for bad in ({"trophies": [{"id": "../x", "name": "n"}]}, {"trophies": [{"id": "a", "name": "n", "tier": "diamond"}]},
                {"trophies": [{"id": "a", "name": "n", "body": "SECRET"}]}, {"trophies": [{"id": "a", "name": ""}]},
                {"trophies": [{"id": f"a{i}", "name": "n"} for i in range(13)]}, {"x": 1}):
        assert client.post(f"{BASE}/notify/trophy", json=bad).status_code == 422
    # a trophy reported while the type is off is remembered (no flood on switch-on) but never notified
    off = Store()
    out = N.record_trophies(N.TrophiesIn(trophies=[{"id": "early", "name": "Early"}]), off, now=NOW)
    assert out["recorded"] == 1 and out["notify"] == 0 and off.data[N.TROPHY_KEY]["pending"] == []
    # more than TROPHY_FIRST_SYNC new at once = the first sync of the page, not news
    st = Store()
    st.set(N.SETTINGS_KEY, {"types": {"trophy": True}, "routes": {"trophy": [T1]}})
    burst = N.record_trophies(N.TrophiesIn(trophies=[{"id": f"t{i}", "name": f"T{i}"} for i in range(N.TROPHY_FIRST_SYNC + 1)]), st, now=NOW)
    assert burst["firstSync"] is True and burst["notify"] == 0 and st.data[N.TROPHY_KEY]["pending"] == []
    # exactly TROPHY_FIRST_SYNC new at once is still news (the bound itself, not only « more »)
    edge = Store()
    edge.set(N.SETTINGS_KEY, {"types": {"trophy": True}, "routes": {"trophy": [T1]}})
    three = N.record_trophies(N.TrophiesIn(trophies=[{"id": f"e{i}", "name": f"E{i}"} for i in range(N.TROPHY_FIRST_SYNC)]), edge, now=NOW)
    assert three["firstSync"] is False and three["notify"] == N.TROPHY_FIRST_SYNC and len(edge.data[N.TROPHY_KEY]["pending"]) == N.TROPHY_FIRST_SYNC


def test_a_trophy_is_notified_once_per_recipient_and_says_the_desk_must_be_open():
    w = W2({"trophy": [T1, T2]})
    w.boards = [board("b")]
    w.tick()
    pending = [{"id": "zero_fail", "name": "Clean sweep", "tier": "gold", "ts": int(w.clock.t)}]
    w.extra = {"trophies": pending}
    w.tick(30)
    w.tick(30)
    assert len(w.to("telegram:1")) == 1 and len(w.to("discord:2")) == 1
    assert "🏆" in w.sent[0][1] and "Clean sweep" in w.sent[0][1] and "gold tier" in w.sent[0][1]
    w.extra = {"trophies": [{**pending[0], "ts": int(w.clock.t) - N.TROPHY_TTL_S - 1}]}   # expired: forgotten
    w.tick(30)
    assert len(w.sent) == 2


# ================================================================ the test message
def run_test(known=None, **kw):
    store = kw.pop("store", Store())
    journal = []
    sent = []
    status, body = N.run_test(kw.pop("target", T1), known if known is not None else [dict(t) for t in TARGETS], store=store,
                              send=kw.pop("send", lambda t, m: sent.append((t, m)) or {"success": True}), now=kw.pop("now", NOW),
                              connected=kw.pop("connected", lambda p: True), journal=journal.append)
    return status, body, store, journal, sent


def test_the_test_message_is_one_realistic_message_marked_as_a_test():
    store = Store()
    store.set(N.SETTINGS_KEY, {"types": {}, "lang": "fr", "label": "Officecraft"})
    status, body, _, journal, sent = run_test(store=store)
    assert (status, body) == (200, {"ok": True, "error": None}) and len(sent) == 1 and sent[0][0] == "telegram:1"
    text = sent[0][1]
    assert text.startswith("[test Officecraft] 4 événements") is False and "[test Officecraft]" in text.splitlines()[0]
    assert "TEST-1" in text and "TEST-2" in text and "Exemple de décision" in text and "il y a 3\u00a0min" in text
    assert text.count("\n") >= 6 and "<b>" in text                                          # the real format (Telegram: bold headings)
    assert journal and journal[0]["verb"] == "notify_test" and journal[0]["result"] == "done" and journal[0]["id"] == T1
    assert "TEST-" not in json.dumps(journal) and "Exemple" not in json.dumps(journal)       # the journal never holds the content


def test_the_test_message_is_limited_to_one_per_minute_and_ten_per_day():
    store = Store()
    assert run_test(store=store, now=NOW)[0] == 200
    status, body, *_ = run_test(store=store, now=NOW + 30)
    assert status == 429 and body["error"] == "rate_limited" and body["ok"] is False and 0 < body["retryAfter"] <= 60
    for i in range(1, N.TEST_PER_DAY):
        assert run_test(store=store, now=NOW + i * 61)[0] == 200
    status, body, _, journal, sent = run_test(store=store, now=NOW + N.TEST_PER_DAY * 61)
    assert status == 429 and body["error"] == "daily_limit" and sent == [] and journal[0]["result"] == "refused" and journal[0]["reason"] == "daily_limit"
    assert run_test(store=store, now=NOW + 86400 + 100)[0] == 200                               # a day later


def test_the_test_message_says_why_it_did_not_leave():
    assert run_test(target="telegram#bbbbbbbb")[:2] == (422, {"ok": False, "error": "unknown_target"})
    status, body, store, journal, sent = run_test(connected=lambda p: False)
    assert (status, body) == (409, {"ok": False, "error": "platform_not_connected"}) and sent == [] and not store.data.get(N.TEST_KEY)   # no try used
    status, body, _, journal, _ = run_test(send=lambda t, m: {"success": False, "error": "x"})
    assert (status, body) == (502, {"ok": False, "error": "send_failed"}) and journal[0]["result"] == "failed"
    status, body, *_ = run_test(send=lambda t, m: (_ for _ in ()).throw(RuntimeError("SECRET-TOKEN")))
    assert (status, body) == (502, {"ok": False, "error": "send_failed"}) and "SECRET" not in json.dumps(body)
    assert run_test(connected=lambda p: None)[0] == 200                                           # Hermes cannot say: the send is tried


def test_post_notify_test_route(client, monkeypatch):
    sent, journal = [], []
    monkeypatch.setattr(N, "hermes_connected", lambda p: True)
    monkeypatch.setattr(N, "hermes_send", lambda t, m: sent.append((t, m)) or {"success": True})
    monkeypatch.setattr(N.audit, "append", lambda e, directory=None: journal.append(e))
    r = client.post(f"{BASE}/notify/test", json={"target": T1})
    assert r.status_code == 200 and r.json() == {"ok": True, "error": None} and len(sent) == 1 and sent[0][0] == "telegram:1"
    assert journal[0]["verb"] == "notify_test"
    again = client.post(f"{BASE}/notify/test", json={"target": T1})                              # the limit holds through the route too
    assert again.status_code == 429 and again.json()["error"] == "rate_limited" and len(sent) == 1
    assert client.post(f"{BASE}/notify/test", json={"target": "telegram#bbbbbbbb"}).json() == {"ok": False, "error": "unknown_target"}
    assert client.post(f"{BASE}/notify/test", json={"target": "telegram:1234"}).status_code == 422
    assert client.post(f"{BASE}/notify/test", json={"target": T1, "message": "mine"}).status_code == 422      # the text is never the caller's


def test_the_test_audit_line_is_whitelisted_and_kept_out_of_the_replay(tmp_path):
    from importlib import import_module
    audit, replay = import_module(SN + ".audit"), import_module(SN + ".replay")
    audit.append({"verb": "notify_test", "id": T1, "result": "done", "source": "page", "risk": "safe", "text": "SECRET", "ts": NOW}, tmp_path)
    audit.append({"verb": "comment", "id": "x", "result": "done", "ts": NOW}, tmp_path)
    tail = audit.read_tail(10, tmp_path)
    assert [e["verb"] for e in tail] == ["comment", "notify_test"] or [e["verb"] for e in tail] == ["notify_test", "comment"]
    assert "SECRET" not in json.dumps(tail)
    assert [row[1] for row in replay.read_orders_window(NOW - 10, NOW + 10, tmp_path)] == ["comment"]


# ================================================================ readable messages: 5 typical cases, 3 languages
def card(state, board_, title, agent, mins=None, **kw):
    f = {"state": state, "board": board_, "task": "t_ab12cd34", "title": title, "agent": agent, **kw}
    if mins is not None:
        f["since"] = NOW - mins * 60
    return f


D1 = card("blocked", "alpha", "API3 — Leftovers of S4 : launches, preview and settings to redo before the review", "frontend", 12)
D2 = card("blocked", "alpha", "DOCS1 — User guide 2 : the agent half and readable examples", "backend", 185)
D3 = card("blocked", "beta", "Q7 — Choose the icon set of screen 3", "design", 47)
SILENT = card("silent", "alpha", "DOCS2 — The page", "frontend", 7)
CRON = {"state": "cron_failed", "title": "nightly-digest", "agent": "digest", "since": NOW - 180}
CAMP = {"state": "camp_ready", "board": "alpha", "name": "Onboarding redesign", "phase": 1, "title": "The page", "count": 4}
REVIEW = card("review_changes", "alpha", "R-DOCS1 — Review of the agent half", "backend", 4)
QUIET_HEAD = {"from": "22:00", "to": "07:00", "resolved": 2}


def msg(facts, lang="fr", platform=None, **kw):
    return N.format_message(facts, lang, "Officecraft", platform=platform, now=NOW, **kw)


def test_case_1_one_decision_reads_in_two_lines_with_the_code_not_the_id():
    assert msg([D1], "fr") == ("⏸ 1 décision vous attend · alpha\n"
                               "API3 Leftovers of S4 : launches, preview and settings… · frontend · depuis 12\u00a0min")
    assert msg([D1], "en") == "⏸ 1 decision is waiting for you · alpha\nAPI3 Leftovers of S4 : launches, preview and settings… · frontend · for 12 min"
    assert msg([D1], "es") == "⏸ 1 decisión te espera · alpha\nAPI3 Leftovers of S4 : launches, preview and settings… · frontend · desde hace 12 min"
    assert "t_ab12cd34" not in msg([D1]) and "[" not in msg([D1]) and msg([D1]).count("\n") == 1


def test_case_2_three_decisions_on_two_projects_name_the_project_on_each_line():
    fr = msg([D1, D2, D3], "fr").splitlines()
    assert fr[0] == "⏸ 3 décisions vous attendent · 2 projets" and len(fr) == 4
    assert fr[2] == "DOCS1 User guide 2 : the agent half and readable… · backend · depuis 3\u00a0h\u00a05\u00a0min · alpha"
    assert fr[3] == "Q7 Choose the icon set of screen 3 · design · depuis 47\u00a0min · beta"
    assert msg([D1], "fr").count("alpha") == 1                                  # a single project is said once, in the first line
    assert msg([D1, D2, D3], "en").splitlines()[0] == "⏸ 3 decisions are waiting for you · 2 projects"
    assert msg([D1, D2, D3], "es").splitlines()[0] == "⏸ 3 decisiones te esperan · 2 proyectos"


def test_case_3_silence_and_cron_are_grouped_by_type_with_one_symbol_each():
    assert msg([SILENT, CRON], "fr") == ("2 événements · alpha\n🔇 1 agent silencieux\nDOCS2 The page · frontend · depuis 7\u00a0min\n"
                                         "⏰ 1 tâche planifiée en échec\nnightly-digest · digest · il y a 3\u00a0min")
    assert msg([SILENT, CRON], "en").splitlines()[0] == "2 events · alpha" and "🔇 1 agent silent" in msg([SILENT, CRON], "en")
    assert "⏰ 1 tarea programada fallida" in msg([SILENT, CRON], "es") and "hace 3 min" in msg([SILENT, CRON], "es")


def test_case_4_the_summary_of_the_end_of_quiet_hours_says_what_is_left_and_what_was_resolved():
    facts = [card("blocked", "alpha", "API3 — Leftovers of S4 : launches", "frontend", 410), card("silent", "alpha", "OPS9 — Cleanup", "devops", 95), CRON]
    fr = msg(facts, "fr", quiet=QUIET_HEAD).splitlines()
    assert fr[0] == "🌙 Heures calmes 22:00–07:00\u00a0: 3 à voir · 2 résolus entre-temps · alpha"
    assert fr[1:] == ["⏸ 1 décision", "API3 Leftovers of S4 : launches · frontend · depuis 6\u00a0h\u00a050\u00a0min", "🔇 1 agent silencieux",
                      "OPS9 Cleanup · devops · depuis 1\u00a0h\u00a035\u00a0min", "⏰ 1 tâche planifiée en échec", "nightly-digest · digest · il y a 3\u00a0min"]
    assert msg(facts, "en", quiet=QUIET_HEAD).splitlines()[0] == "🌙 Quiet hours 22:00–07:00: 3 to review · 2 resolved since · alpha"
    assert msg(facts, "es", quiet=QUIET_HEAD).splitlines()[0].startswith("🌙 Horas de silencio 22:00–07:00: 3 por revisar · 2 resueltos entretanto")
    assert "résolus" not in msg(facts, "fr", quiet={**QUIET_HEAD, "resolved": 0})


def test_one_resolved_is_singular_in_every_language():
    """« 1 résolus entre-temps » / « 1 resueltos » read wrong."""
    one = {**QUIET_HEAD, "resolved": 1}
    facts = [card("blocked", "alpha", "API3 — Leftovers", "frontend", 10)]
    assert msg(facts, "fr", quiet=one).splitlines()[0].endswith(": 1 à voir · 1 résolu entre-temps · alpha")
    assert " · 1 resuelto entretanto · " in msg(facts, "es", quiet=one).splitlines()[0]
    assert " · 1 resolved since · " in msg(facts, "en", quiet=one).splitlines()[0]


def test_a_duration_in_hours_never_reads_as_a_time_of_day():
    """« depuis 6 h 50 » reads « since 6:50 » on a phone; a duration says its minutes (« 6 h 50 min ») or none (« 5 h »)."""
    assert N.format_line(card("blocked", "b", "API3 — x", "y", 410), "fr", now=NOW).endswith("depuis 6\u00a0h\u00a050\u00a0min")
    assert N.format_line(card("blocked", "b", "API3 — x", "y", 300), "fr", now=NOW).endswith("depuis 5\u00a0h")
    assert [N.format_line(card("blocked", "b", "x", "y", 185), lang, now=NOW).rsplit(" · ", 1)[1] for lang in ("en", "es")] == ["for 3 h 5 min", "desde hace 3 h 5 min"]


def test_case_5_a_campaign_ready_and_a_refused_review():
    fr = msg([CAMP, REVIEW], "fr")
    assert fr == ("2 événements · alpha\n🚀 1 nouveauté de campagne\nOnboarding redesign · phase B (The page) prête à lancer · 4 cartes\n"
                  "↩ 1 revue refusée\nR-DOCS1 Review of the agent half · backend · il y a 4\u00a0min")
    done = msg([{"state": "camp_done", "board": "alpha", "name": "Redesign", "count": 12}], "en")
    assert done == "🚀 1 campaign update · alpha\nRedesign · finished · 12 cards"
    head = msg([{**CAMP, "phase": 0}], "es")
    assert "lista para lanzar · 4 tarjetas" in head and "↩" not in head


def test_the_other_lines_numbers_lead_and_french_typography_holds():
    llm = {"state": "llm_90", "kind": "usd", "pct": 91, "used": 4.55, "cap": 5}
    assert msg([llm], "fr") == "💳 1 alerte de budget LLM\n91\u00a0% du plafond · 4,55\u00a0$ sur 5\u00a0$"
    assert msg([{**llm, "state": "llm_cap", "pct": 100, "used": 5.0}], "en").endswith("cap reached · $5 of $5")
    assert msg([{"state": "stopped", "start": NOW - 600, "end": NOW - 30}], "fr").splitlines()[1].endswith("· 9\u00a0min")
    gold = {"state": "trophy", "name": "Clean sweep", "tier": "gold"}
    assert msg([gold], "fr").splitlines()[1] == "Clean sweep · palier or" and msg([gold], "es").splitlines()[1] == "Clean sweep · categoría oro"
    for lang in ("fr", "es", "en"):
        for line in msg([D1, D2, SILENT, CRON, CAMP, REVIEW, llm, gold], lang).splitlines():
            assert len(line) <= 120, line                                               # short lines on a phone
    assert re.search(r"\w\s[:;?!]", msg([D1], "fr")) is not None                       # the title's own « : » is its writer's; ours uses a no-break space
    assert "\u00a0: " in msg(facts_quiet(), "fr", quiet=QUIET_HEAD)


def facts_quiet():
    return [D1]


def test_the_title_is_cut_cleanly_at_a_word_and_the_code_is_the_first_word():
    code, rest = N.__dict__["format_line"].__globals__["split_title"]("API2-B2 — Bot sessions : no read at all")
    assert (code, rest) == ("API2-B2", "Bot sessions : no read at all")
    split = N.__dict__["format_line"].__globals__["split_title"]
    assert split("S4.1 — Campaign") == ("S4.1", "Campaign") and split("R-DOCS1 — Review") == ("R-DOCS1", "Review")
    assert split("Approve the plan") == (None, "Approve the plan") and split("OK") == ("OK", "")
    cut = N.__dict__["format_line"].__globals__["cut"]
    out = cut("A really very long title that goes far beyond the fifty characters allowed")
    assert len(out) <= 50 and out.endswith("…") and not out[:-1].endswith(" ") and "characters" not in out
    assert cut("short") == "short" and len(cut("x" * 200)) == 50


# ================================================================ injection, platform by platform
HOSTILE = [
    '<b onclick="x">bold</b> <a href="https://evil.invalid">link</a> <tg-spoiler>s</tg-spoiler>',
    "[open](https://evil.invalid/x) [[as_document]] [[audio_as_voice]]",
    "MEDIA:/home/user/.env media:/etc/passwd **MEDIA:~/x.png",
    "@everyone @here @channel <!channel> <!everyone> <@U123> <@&456> <#C789>",
    "https://evil.invalid/x ftp://x.y file:///etc/passwd tg://user?id=1 mailto:a@b.c javascript://x",
    "*bold* _italic_ ~strike~ `code` ||spoiler|| > quote # heading \\ backslash & ampersand",
    "line 1\nline 2\r\n\x07\x1b[31mred\u202ereversed\u200bzero",
]
TELEGRAM_TAG = re.compile(r"<(?!/?b>)[^>]*>")
MEDIA = re.compile(r"""[`"'*_]{0,3}MEDIA:\s*""", re.IGNORECASE)   # what Hermes reads (gateway/platforms/base.py MEDIA_TAG_CLEANUP_RE)


def hostile_message(title, platform, lang="fr", **kw):
    fact = {"state": "blocked", "board": "alpha", "task": "t_0123abcd", "title": "API9 — " + title, "agent": "backend", "since": NOW - 60}
    return msg([fact, {"state": "silent", "board": "alpha", "title": title, "agent": "frontend", "span": 400}], lang, platform, **kw)


@pytest.mark.parametrize("title", HOSTILE)
@pytest.mark.parametrize("platform", ["telegram", "discord", "slack", "email", None])
def test_a_hostile_title_stays_text_on_every_platform(title, platform):
    text = hostile_message(title, platform)
    flat = text.replace("<b>", "").replace("</b>", "")
    assert not MEDIA.search(flat) and "[[" not in text
    assert not re.search(r"\[[^\]]*\]\([^)]*\)", flat) and "@everyone" not in text and "@here" not in text and "@channel" not in text
    assert not re.search(r"(?i)[a-z][a-z0-9+.-]*://", text) and "<!" not in text and "<@" not in text
    assert "\x07" not in text and "\x1b" not in text and "\u202e" not in text and "\r" not in text
    assert len(text.splitlines()) == 1 + 2 + 2 or len(text.splitlines()) == 1 + 2 + 2 + 0                # no line smuggled in by the title
    if platform == "telegram":
        assert not TELEGRAM_TAG.search(text), text                                         # only OUR <b> tags: nothing else can switch or open anything
        assert "<" not in flat and ">" not in flat.replace("‹", "").replace("›", "")
    else:
        assert "<b>" not in text and "</b>" not in text


def test_telegram_escapes_html_and_discord_escapes_markdown_but_slack_and_email_stay_plain():
    t = "A & B <c> *d* _e_"
    fact = {"state": "blocked", "board": "b", "title": "API1 — " + t, "agent": "my_agent", "since": NOW - 60}
    tg, ds, sl, em = (msg([fact], "en", p) for p in ("telegram", "discord", "slack", "email"))
    assert "<b>1 decision is waiting for you</b>" in tg and "A &amp; B ‹c› *d* _e_" in tg and "<b>API1</b>" in tg
    assert "**1 decision is waiting for you**" in ds and "A & B ‹c› \\*d\\* \\_e\\_" in ds and "my\\_agent" in ds and "**API1**" in ds
    assert "*" not in sl.replace("*d*", "") and "<b>" not in sl and "**" not in em and "<b>" not in em and "A & B ‹c› *d* _e_" in em
    assert sl == em                                                                          # plain text: the same words everywhere it is not rendered safely


def test_the_message_of_the_poll_goes_to_each_platform_in_its_own_form():
    w = W2({"decision": [T1, T2, T3]})
    w.boards = [board("b")]
    w.tick()
    w.boards = [blocked_cards("t_00000001", titles={"t_00000001": "API3 — <b>x</b> @everyone"})]
    w.tick(30)
    tg, ds, sl = w.to("telegram:1")[0], w.to("discord:2")[0], w.to("slack:3")[0]
    assert "<b>" in tg and "**" in ds and "<b>" not in sl and "**" not in sl
    assert all("@everyone" not in m and "<b>x" not in m for m in (tg, ds, sl))


@pytest.mark.parametrize("platform", ["telegram", "discord", "slack", "email", None])
def test_an_agent_name_cannot_carry_a_mass_mention_either(platform):
    """An assignee is free text in Hermes' kanban (only lower-cased), and the name pattern lets ``@`` and a space
    through: the agent of a card, of a review and of a cron is made inert like a title."""
    facts = [{"state": "blocked", "board": "b", "title": "API1 x", "agent": "ops @everyone", "since": NOW - 60},
             {"state": "review_changes", "board": "b", "title": "R-API1 y", "agent": "rev @here", "since": NOW - 60},
             {"state": "cron_failed", "title": "nightly", "agent": "cron @channel", "since": NOW - 60}]
    text = msg(facts, "en", platform)
    assert "@everyone" not in text and "@here" not in text and "@channel" not in text
    assert "ops @\u200beveryone" in text.replace("\\", "")                                     # still readable


def test_inert_is_still_the_name_of_the_old_helper_and_keeps_its_guarantees():
    assert N._inert("<a>[x](y) MEDIA:/z @everyone https://x.y") == "‹a›(x)(y) MEDIA :/z @\u200beveryone https:\u200b//x.y"
    assert N.inert is N._inert


def test_the_message_holds_only_whitelisted_fields_for_the_new_types_too():
    secret = "SECRET-BODY-xyz"
    facts = [{**CAMP, "body": secret, "comment": secret}, {**REVIEW, "reason": secret, "summary": secret, "result": secret},
             {"state": "llm_90", "kind": "usd", "pct": 90, "used": 4.5, "cap": 5, "prompt": secret}, {"state": "trophy", "name": "N", "tier": "gold", "path": "/home/" + secret}]
    for platform in ("telegram", "discord", None):
        assert secret not in msg(facts, "fr", platform) and "/home" not in msg(facts, "fr", platform)


# ================================================================ a store that refuses the write
class Refusing:
    """Wraps the store of a world: ``set`` of the notification state raises while ``broken`` is true."""

    def __init__(self, inner):
        self.inner, self.broken, self.refused = inner, False, 0

    def get(self, key, default=None):
        return self.inner.get(key, default)

    def set(self, key, value):
        if self.broken and key == N.STATE_KEY:
            self.refused += 1
            raise OSError("quota")
        return self.inner.set(key, value)


def test_a_state_that_cannot_be_written_sends_nothing_rather_than_the_same_message_at_every_pass():
    w = W2({"decision": [T1]})
    store = w.n.store = Refusing(w.store)
    w.boards = [board("b")]
    w.tick()
    store.broken = True
    w.boards = [blocked_cards("t_00000001")]
    for _ in range(30):
        w.tick(30)
    assert w.to("telegram:1") == [] and store.refused >= 30, "nothing leaves while what was sent cannot be remembered"
    store.broken = False
    w.tick(30)
    assert len(w.to("telegram:1")) == 1, "the store is back: the fact leaves, once"
    for _ in range(5):
        w.tick(30)
    assert len(w.to("telegram:1")) == 1


def test_a_write_refused_after_the_sends_keeps_the_memory_of_the_pass():
    w = W2({"decision": [T1]})
    store = w.n.store = Refusing(w.store)
    w.boards = [board("b")]
    w.tick()
    w.boards = [blocked_cards("t_00000001")]
    real_send = w.n.send

    def send_then_break(target, message):
        out = real_send(target, message)
        store.broken = True   # the store fails between the write before the sends and the one after
        return out

    w.n.send = send_then_break
    w.tick(30)
    assert len(w.to("telegram:1")) == 1
    w.n.send = real_send
    for _ in range(10):
        w.tick(30)
    assert len(w.to("telegram:1")) == 1, "sent once: the pass is remembered in memory while the file is refused"
