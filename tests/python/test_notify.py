"""Notifications: the four facts, one notification per fact, grouping, hourly cap, renotification, whitelist of the
message, sandbox exclusion, defaults OFF, the routes, and register(). No Hermes, no network: the store and the sender are
fakes."""

import importlib.util
import json
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
BASE = "/api/plugins/hermes-officecraft"
NOW = 1_800_000_000


def _load():
    spec = importlib.util.spec_from_file_location("notify_plugin_api", ROOT / "dashboard" / "plugin_api.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, sys.modules["_officecraft_http.notify"]


api_module, N = _load()


class Store:
    def __init__(self):
        self.data = {}

    def get(self, key, default=None):
        return json.loads(json.dumps(self.data.get(key, default)))

    def set(self, key, value):
        self.data[key] = json.loads(json.dumps(value))


class Clock:
    def __init__(self, t=NOW):
        self.t = t

    def __call__(self):
        return self.t


def task(id_, status, title="A card", assignee="writer", **extra):
    return {"id": id_, "title": title, "status": status, "assignee": assignee, "createdAt": NOW - 9999,
            "startedAt": extra.pop("startedAt", None), "heartbeatAt": extra.pop("heartbeatAt", None), **extra}


def board(slug, *tasks):
    return {"slug": slug, "tasks": list(tasks), "runs": [], "events": []}


class World:
    """A fake Hermes: boards, ops, targets and a recording sender, around a real Notifier."""

    def __init__(self, types=("decision",), lang="en"):
        self.store, self.clock = Store(), Clock()
        self.boards, self.ops, self.sent, self.fail = [], {"gateway": None, "crons": []}, [], False
        self.targets = [{"key": "telegram#aaaaaaaa", "platform": "telegram", "label": "…1234", "source": "cron", "target": "telegram:1234"}]
        self.store.set(N.SETTINGS_KEY, {"types": {t: True for t in types}, "target": "telegram#aaaaaaaa", "lang": lang})
        self.extra = {}    # what ``_read_extras`` would read (kanban extras, LLM budget, trophies): nothing, no Hermes here
        self.n = N.Notifier(store=self.store, send=self._send, read=lambda: (self.boards, self.ops), targets=lambda: self.targets,
                            clock=self.clock, gateway_pid=lambda: None, threaded=False, extras=lambda boards, enabled: self.extra)

    def _send(self, target, message):
        self.sent.append((target, message))
        return {"success": not self.fail}

    def tick(self, advance=0):
        self.clock.t += advance
        return self.n.tick()


def blocked(id_="t_00000001", title="Approve the plan", board_slug="oc-notify-test"):
    return board(board_slug, task(id_, "blocked", title))


# ---------------------------------------------------------------- defaults
def test_everything_is_off_by_default_and_nothing_is_sent():
    s = N.default_settings()
    assert s["types"] == {t: False for t in N.TYPES} and s["routes"] == {t: [] for t in N.TYPES} and not s["quiet"]["enabled"]
    w = World(types=())
    w.boards = [blocked()]
    for _ in range(3):
        assert w.tick(30) is None
    assert w.sent == []
    assert N.clean_settings({"types": {"decision": "yes", "x": True}, "target": "../etc", "lang": "xx", "routes": {"decision": ["../etc"]}}) == N.default_settings()


def test_no_recipient_means_nothing_leaves_even_with_a_switch_on():
    w = World()
    w.store.set(N.SETTINGS_KEY, {"types": {"decision": True}, "target": None})
    w.boards = [blocked()]
    w.tick()
    w.boards = [blocked(), board("b2", task("t_00000002", "blocked"))]
    w.tick(30)
    assert w.sent == []


# ---------------------------------------------------------------- the four facts
def test_detects_the_four_kinds_of_facts():
    ops = {"gateway": {"state": "running", "platforms": [{"name": "telegram", "state": "disconnected", "needsAttention": True}]},
           "crons": [{"name": "digest", "profile": "default", "enabled": True, "last_status": "error", "last_run_at": NOW - 60},
                     {"name": "ok", "profile": "default", "enabled": True, "last_status": "ok", "last_run_at": NOW - 60},
                     {"name": "off", "profile": "default", "enabled": False, "last_status": "error", "last_run_at": NOW - 60}]}
    boards = [board("work", task("t_00000001", "blocked", "To decide"),
                    task("t_00000002", "running", "Silent one", "dev", startedAt=NOW - 4000, heartbeatAt=NOW - 400),
                    task("t_00000003", "running", "Alive one", "dev", startedAt=NOW - 4000, heartbeatAt=NOW - 20),
                    task("t_00000004", "running", "No signal", "dev", startedAt=NOW - 301),
                    task("t_00000005", "running", "Recent one", "dev", startedAt=NOW - 100),
                    task("t_00000006", "todo"))]
    facts = N.detect(boards, ops, NOW, approvals=["r1"], gateway_return={"key": "gateway:7", "from": NOW - 600, "to": NOW - 30})
    by = {}
    for f in facts:
        by.setdefault(f["type"], []).append(f)
    assert [f["task"] for f in by["decision"] if f["state"] == "blocked"] == ["t_00000001"]
    assert [f["state"] for f in by["decision"]].count("approval") == 1
    assert sorted(f["task"] for f in by["silent"]) == ["t_00000002", "t_00000004"]
    assert next(f for f in by["silent"] if f["task"] == "t_00000002")["span"] == 400
    assert sorted(f["state"] for f in by["gateway"]) == ["degraded", "stopped"]
    assert [f["title"] for f in by["cron"]] == ["digest"]


def test_sandbox_boards_are_never_notified():
    boards = [board("sandbox-alpha", task("t_00000001", "blocked"), task("t_00000002", "running", startedAt=NOW - 9000)),
              board("sandbox-x", task("t_00000003", "blocked"))]
    assert N.detect(boards, None, NOW) == []
    w = World(types=("decision", "silent"))
    w.boards = []
    w.tick()
    w.boards = boards
    w.tick(30)
    assert w.sent == []


# ---------------------------------------------------------------- one notification per fact
def test_one_message_per_fact_not_one_per_poll():
    w = World()
    w.boards = [board("oc-notify-test")]
    assert w.tick() is None                      # armed: baseline
    w.boards = [blocked()]
    first = w.tick(30)
    assert first == {"success": True, "count": 1, "at": NOW + 30}
    for _ in range(5):                           # the next polls: same fact, nothing
        assert w.tick(30) is None
    assert len(w.sent) == 1 and w.sent[0][0] == "telegram:1234"


def test_a_fact_resolved_then_back_is_notified_again():
    w = World()
    w.boards = [board("oc-notify-test")]
    w.tick()
    w.boards = [blocked()]
    w.tick(30)
    w.boards = [board("oc-notify-test", task("t_00000001", "ready"))]    # resolved
    w.tick(30)
    assert len(w.sent) == 1
    w.boards = [blocked()]                                                # back
    w.tick(30)
    assert len(w.sent) == 2


def test_switching_a_type_on_does_not_flood_with_the_past():
    w = World()
    w.boards = [blocked("t_00000001"), blocked("t_00000002")]   # already blocked when the switch turns on
    assert w.tick() is None and w.sent == []
    w.boards.append(board("other", task("t_00000003", "blocked", "New one")))
    w.tick(30)
    assert len(w.sent) == 1 and "New one" in w.sent[0][1] and "Approve the plan" not in w.sent[0][1]


def test_switching_off_forgets_and_a_new_switch_on_starts_from_a_new_baseline():
    w = World()
    w.boards = [blocked()]
    w.tick()
    on = w.store.get(N.SETTINGS_KEY)
    w.store.set(N.SETTINGS_KEY, {**on, "types": {"decision": False}})
    w.tick(30)
    assert w.store.get(N.STATE_KEY)["armed"]["telegram#aaaaaaaa"]["decision"] is False
    w.boards = [blocked(), board("b", task("t_00000009", "blocked"))]
    w.tick(30)
    w.store.set(N.SETTINGS_KEY, on)
    w.tick(30)                                    # switched on again: what is true NOW is the baseline
    assert w.sent == []


def test_the_types_are_independent():
    w = World(types=("silent",))
    w.boards = [board("b")]
    w.tick()
    w.boards = [board("b", task("t_00000001", "blocked"))]     # a decision, but only « silent » is on
    w.tick(30)
    assert w.sent == []


# ---------------------------------------------------------------- grouping
def test_facts_that_arrive_together_leave_in_one_message():
    w = World(types=("decision", "silent", "cron"))
    w.boards = [board("b")]
    w.tick()
    w.boards = [board("b", task("t_00000001", "blocked", "One"), task("t_00000002", "blocked", "Two"),
                      task("t_00000003", "running", "Three", startedAt=NOW - 2000))]
    w.ops = {"gateway": None, "crons": [{"name": "digest", "profile": "default", "enabled": True, "last_status": "error", "last_run_at": NOW}]}
    w.tick(30)
    assert len(w.sent) == 1
    text = w.sent[0][1]
    # a first line that says the essential, then the facts grouped by type, one short line each
    assert text.startswith("<b>4 events</b> · b\n") and text.count("\n") == 4 + 3        # 4 facts + 3 group headers
    assert "⏸ <b>2 decisions</b>" in text and "🔇 <b>1 agent silent</b>" in text and "⏰ <b>1 scheduled job failed</b>" in text


def test_a_long_group_is_cut_and_counted():
    w = World()
    w.boards = [board("b")]
    w.tick()
    w.boards = [board("b", *[task(f"t_{i:08x}", "blocked", f"Card {i}") for i in range(12)])]
    w.tick(30)
    lines = w.sent[0][1].splitlines()
    assert "12 decisions" in lines[0] and len(lines) == 1 + N.MAX_LINES + 1 and lines[-1] == "+4 more"


# ---------------------------------------------------------------- hourly cap
def test_hourly_cap_holds_back_then_releases_everything_together():
    w = World()
    w.boards = [board("b")]
    w.tick()
    for i in range(N.HOURLY_CAP):
        w.boards = [board("b", *[task(f"t_{j:08x}", "blocked") for j in range(i + 1)])]
        w.tick(60)
    assert len(w.sent) == N.HOURLY_CAP
    w.boards = [board("b", *[task(f"t_{j:08x}", "blocked") for j in range(N.HOURLY_CAP + 2)])]
    for _ in range(5):
        assert w.tick(60) is None                  # capped: held back, not lost
    assert len(w.sent) == N.HOURLY_CAP
    result = w.tick(3600)                          # the hour passed
    assert len(w.sent) == N.HOURLY_CAP + 1 and result["count"] == 2     # both held facts, in ONE message
    assert w.tick(60) is None


def test_a_failed_send_is_retried_later_not_in_a_loop_and_does_not_count_for_the_cap():
    w = World()
    w.boards = [board("b")]
    w.tick()
    w.boards = [blocked()]
    w.fail = True
    assert w.tick(30)["success"] is False
    for _ in range(3):
        assert w.tick(30) is None                  # backoff: no hammering
    assert len(w.sent) == 1
    w.fail = False
    assert w.tick(N.RETRY_AFTER_S)["success"] is True
    assert len(w.sent) == 2 and w.tick(30) is None
    assert w.store.get(N.STATE_KEY)["sent"] == [w.clock.t - 0] or len(w.store.get(N.STATE_KEY)["sent"]) == 1


# ---------------------------------------------------------------- gateway: said on return
def test_gateway_return_is_notified_once_with_the_stop_window():
    w = World(types=("gateway",))
    w.n.gateway_pid = lambda: __import__("os").getpid()
    w.ops = {"gateway": {"state": "running", "platforms": [{"name": "telegram", "state": "connected"}]}, "crons": []}
    w.n.started = NOW + 5000
    w.tick()                                       # armed, alive = NOW
    state = w.store.get(N.STATE_KEY)
    assert state["pid"] and state["alive"] == NOW
    # the gateway stopped: a NEW process (another pid) comes back 100 s later, 5 s after its own start
    state["pid"] = state["pid"] + 1
    w.store.set(N.STATE_KEY, state)
    w.n.started = NOW + 95
    w.tick(100)
    assert len(w.sent) == 1
    a, b = N._clock(NOW), N._clock(NOW + 95)
    assert f"stopped {a}–{b} · 1 min" in w.sent[0][1]
    for _ in range(4):
        assert w.tick(30) is None
    assert len(w.sent) == 1


def test_gateway_tracking_only_runs_in_the_gateway_process():
    w = World(types=("gateway",))          # gateway_pid() = None: this process is not the gateway
    w.boards = []
    w.tick()
    assert "alive" not in w.store.get(N.STATE_KEY)


def test_degraded_platform_is_a_gateway_fact_and_returns_when_it_comes_back():
    w = World(types=("gateway",))
    ok = {"gateway": {"state": "running", "platforms": [{"name": "telegram", "state": "connected"}]}, "crons": []}
    bad = {"gateway": {"state": "running", "platforms": [{"name": "telegram", "state": "retrying", "needsAttention": True}]}, "crons": []}
    w.ops = ok
    w.tick()
    w.ops = bad
    w.tick(30)
    w.tick(30)
    assert len(w.sent) == 1 and "telegram" in w.sent[0][1]
    w.ops = ok
    w.tick(30)
    w.ops = bad
    w.tick(30)
    assert len(w.sent) == 2


def test_a_cron_failure_is_notified_once_and_again_for_the_next_failed_run():
    w = World(types=("cron",))
    job = {"name": "digest", "profile": "default", "enabled": True, "last_status": "ok", "last_run_at": NOW - 100}
    w.ops = {"gateway": None, "crons": [job]}
    w.tick()
    job.update(last_status="error", last_run_at=NOW)
    w.tick(30)
    w.tick(30)
    assert len(w.sent) == 1 and "digest" in w.sent[0][1]
    job.update(last_run_at=NOW + 3600)             # failed again, a new run
    w.tick(30)
    assert len(w.sent) == 2


# ---------------------------------------------------------------- whitelist of the message
SECRET = "SECRET-BODY-xyz"


def test_the_message_holds_only_whitelisted_fields():
    t = task("t_00000001", "blocked", "Visible title", "writer")
    t.update(body=SECRET, result=SECRET, comments=[SECRET], prompt=SECRET, session=SECRET, path="/home/x/" + SECRET)
    w = World()
    w.boards = [board("b")]
    w.tick()
    w.boards = [board("oc-notify-test", t)]
    w.tick(30)
    text = w.sent[0][1]
    assert SECRET not in text and "/home" not in text
    assert "oc-notify-test" in text and "t_00000001" not in text and "Visible title" in text and "writer" in text   # the code, not the raw id
    # even a fact carrying extra keys is formatted from the whitelist only
    line = N.format_line({"state": "blocked", "board": "b", "task": "t_00000001", "title": "T", "agent": "a",
                          "body": SECRET, "command": SECRET, "comment": SECRET, "prompt": SECRET, "reason": SECRET, "summary": SECRET})
    assert SECRET not in line


def test_the_formatter_validates_what_it_prints():
    line = N.format_line({"state": "blocked", "board": "Bad Board\n", "task": "../../x", "title": "a\nb\x07c" + "x" * 200,
                          "agent": "evil\nagent"})
    assert "\n" not in line and "\x07" not in line and "Bad" not in line and "../" not in line and "evil" not in line
    assert len(line) < 80      # the title is cut at ~50 characters
    assert N.format_line({"state": "whatever"}) == ""
    assert N.format_message([], "en", label="bad\nlabel", test=True).startswith("[test Officecraft]")


def test_the_approval_notification_never_carries_its_command():
    w = World()
    w.boards = [board("b")]
    w.tick()
    w.n.on_approval(surface="gateway", command="rm -rf " + SECRET, description=SECRET, session_key=SECRET, pattern_key=SECRET)
    w.n.on_approval(surface="smart", command=SECRET)      # the automatic approver is not a human decision
    w.tick(30)
    assert len(w.sent) == 1 and SECRET not in w.sent[0][1] and "approval request waiting" in w.sent[0][1]
    w.tick(30)
    assert len(w.sent) == 1
    w.n.on_approval_done(surface="gateway", choice="deny")
    w.tick(30)
    w.n.on_approval(surface="cli")
    w.tick(30)
    assert len(w.sent) == 2


def test_messages_speak_the_page_language():
    w = World(lang="fr")
    w.boards = [board("b")]
    w.tick()
    w.boards = [blocked()]
    w.tick(30)
    assert "1 décision vous attend" in w.sent[0][1]
    assert "silencieux" not in w.sent[0][1] and "depuis 6\u00a0min" in N.format_line({"state": "silent", "span": 400, "title": "A card"}, "fr")
    assert "desde hace 6 min" in N.format_line({"state": "silent", "span": 400, "title": "A card"}, "es")


# ---------------------------------------------------------------- recipients, routes, hooks
def test_known_targets_never_expose_a_chat_id():
    known = N.known_targets({"platforms": {"telegram": [{"id": "987654321", "name": "Me", "type": "dm"}]}},
                            ["telegram:555123456", "local", "origin", None], ["telegram"])
    assert {t["source"] for t in known} == {"directory", "cron", "home"}
    public = json.dumps(N.public_targets(known))
    assert "987654321" not in public and "555123456" not in public and "target" not in public
    assert all(len(t["key"]) < 50 for t in known)


@pytest.fixture
def client(monkeypatch):
    store = Store()
    known = [{"key": "telegram#aaaaaaaa", "platform": "telegram", "label": "…1234", "source": "cron", "target": "telegram:1234"}]
    monkeypatch.setattr(N, "_state_store", lambda: store)
    monkeypatch.setattr(N, "hermes_targets", lambda: known)
    app = FastAPI()
    app.include_router(api_module.router, prefix=BASE)
    c = TestClient(app)
    c.store = store
    return c


def test_get_notify_defaults_all_off(client):
    body = client.get(f"{BASE}/notify").json()
    assert body["ok"] and body["settings"]["types"] == {t: False for t in N.TYPES} and body["settings"]["routes"] == {t: [] for t in N.TYPES}
    assert body["settings"]["target"] is None and body["settings"]["quiet"]["enabled"] is False and body["targets"][0]["key"] == "telegram#aaaaaaaa" and "target" not in body["targets"][0]
    assert "notify" in client.get(f"{BASE}/health").json()["reads"]


def test_post_notify_saves_server_side_and_refuses_an_unknown_recipient(client):
    ok = client.post(f"{BASE}/notify", json={"types": {"decision": True}, "target": "telegram#aaaaaaaa", "lang": "fr"})
    assert ok.status_code == 200 and ok.json()["settings"]["types"]["decision"] is True and ok.json()["settings"]["lang"] == "fr"
    assert client.store.data[N.SETTINGS_KEY]["types"]["decision"] is True        # on the server, not in a browser
    assert client.get(f"{BASE}/notify").json()["settings"]["target"] == "telegram#aaaaaaaa"
    bad = client.post(f"{BASE}/notify", json={"types": {}, "target": "telegram#bbbbbbbb"})
    assert bad.status_code == 422 and bad.json() == {"ok": False, "reason": "unknown_target"}
    assert client.get(f"{BASE}/notify").json()["settings"]["types"]["decision"] is True   # untouched by the refusal
    assert client.post(f"{BASE}/notify", json={"types": {"nope": True}}).status_code == 422
    assert client.post(f"{BASE}/notify", json={"types": {}, "target": "telegram:1234"}).status_code == 422   # a raw chat id is never accepted


def test_register_hangs_the_three_hooks_and_does_nothing_else():
    spec = importlib.util.spec_from_file_location("officecraft_root", ROOT / "__init__.py")
    root = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(root)
    seen = []

    class Ctx:
        def register_hook(self, name, cb):
            seen.append((name, cb))

        def register_auxiliary_task(self, key, **kw):   # the only other call, the LLM functions' task
            assert key == "officecraft"

        llm = None   # ctx.llm: handed to the LLM module, which calls nothing at registration

        def __getattr__(self, name):
            raise AssertionError(f"register() must not call ctx.{name}")

    assert root.register(Ctx()) is None
    assert [n for n, _ in seen] == ["on_kanban_dispatch_tick", "pre_approval_request", "post_approval_response"]
    n = N.notifier()
    assert seen[0][1] == n.on_tick


def test_on_tick_returns_at_once_and_is_throttled(monkeypatch):
    calls = []
    n = N.Notifier(store=Store(), send=lambda *_: {"success": True}, threaded=False, every=3600)
    monkeypatch.setattr(n, "tick", lambda: calls.append(1))
    for _ in range(10):
        n.on_tick(board="x", profile_name="p", dry_run=False)
    assert calls == [1]
    n2 = N.Notifier(store=Store(), threaded=False)
    monkeypatch.setattr(n2, "tick", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    n2.on_tick()      # a broken tick never reaches the dispatcher


def test_an_automatic_or_transport_verdict_never_resolves_a_human_approval():
    """post_approval_response also fires for the smart approver (``surface="smart"``) and plugin transports
    (``surface="transport:…"``, tools/approval_smart.py:169, approval_prompt.py) whose pre-hook is ignored; such a
    verdict must not pop a waiting human approval, else the NEXT one is popped by the real answer and never told."""
    w = World()
    w.boards = [board("b")]
    w.tick()
    w.n.on_approval(surface="gateway")                              # A waits
    w.tick(30)
    assert len(w.sent) == 1
    w.n.on_approval_done(surface="smart", choice="smart_approve")  # the automatic approver, another command
    w.n.on_approval_done(surface="transport:x", choice="once")
    w.n.on_approval(surface="gateway")                              # B waits
    w.n.on_approval_done(surface="gateway", choice="once")          # A answered
    w.tick(30)
    assert len(w.sent) == 2, "B was dropped by a verdict that was not a human answer"


def test_each_language_writes_its_own_punctuation_and_words():
    """A message is a native text per language (quotes, colon spacing, same facts), and a cron failure is
    called a scheduled job like the settings page does."""
    fact = {"state": "cron_failed", "board": "b", "title": "Nightly", "agent": "a", "since": NOW - 720}
    assert N.format_line(fact, "en", now=NOW) == "Nightly · a · 12 min ago"
    assert N.format_line(fact, "fr", now=NOW) == "Nightly · a · il y a 12\u00a0min"      # the number and its unit stay together in French
    assert N.format_line(fact, "es", now=NOW) == "Nightly · a · hace 12 min"
    degraded = {"state": "degraded", "title": "telegram"}
    assert N.format_line(degraded, "fr") == "la messagerie telegram est en difficulté"
    assert N.format_line(degraded, "es") == "la app de mensajería telegram necesita atención"
    assert set(N.WORDS["en"]) == set(N.WORDS["fr"]) == set(N.WORDS["es"])
