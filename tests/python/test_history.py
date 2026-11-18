"""`GET /history` end to end against a fake Hermes (profiles, sessions, kanban boards on disk):
shape, whitelist (recursive deny-list of keys and of planted secrets), tolerance, and speed."""

import importlib.util
import json
import os
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
NOW = 1_800_000_000.0
SECRET = "SECRET-DO-NOT-LEAK"
# Keys that must never appear anywhere in the payload, whatever the nesting.
FORBIDDEN_KEYS = {"soul", "path", "preview", "body", "result", "prompt", "summary", "payload", "instructions", "content", "text"}

SCHEMA = """
CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, assignee TEXT, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER, last_heartbeat_at INTEGER, result TEXT);
CREATE TABLE task_runs (id INTEGER PRIMARY KEY, task_id TEXT, profile TEXT, status TEXT, started_at INTEGER,
  ended_at INTEGER, outcome TEXT, summary TEXT);
CREATE TABLE task_events (id INTEGER PRIMARY KEY, task_id TEXT, kind TEXT, payload TEXT, created_at INTEGER);
"""


def _skill(home: Path, rel: str, header: str, mtime: float = NOW - 86_400):
    d = home / "skills" / rel
    d.mkdir(parents=True)
    md = d / "SKILL.md"
    md.write_text(f"---\n{header}\n---\n# {SECRET} body, never read\n")
    os.utime(md, (mtime, mtime))


def _sessions_db(home: Path):
    con = sqlite3.connect(home / "state.db")
    con.execute("CREATE TABLE sessions (id TEXT, source TEXT, title TEXT, started_at REAL, input_tokens INTEGER, cache_read_tokens INTEGER)")
    con.execute("INSERT INTO sessions VALUES ('s1', 'cli', 'Fix it', ?, 100, 40)", (NOW - 5000,))
    con.execute("INSERT INTO sessions VALUES ('s2', 'kanban', 'Worker', ?, 1, 1)", (NOW - 100,))
    con.commit()
    con.close()


class FakeDB:
    """Stands in for hermes_state.SessionDB: rows carry previews that must not leave the process."""

    def __init__(self, db_path=None, read_only=False):
        self.rows = [
            {"id": "s2", "source": "kanban", "title": "Worker", "last_active": NOW - 100, "started_at": NOW - 200, "preview": SECRET,
             "model": "example/model-large", "model_config": SECRET},
            {"id": "s1", "source": "cli", "title": "Fix it", "last_active": NOW - 5000, "started_at": NOW - 6000, "preview": SECRET},
        ]

    def list_sessions_rich(self, **_):
        return self.rows

    def close(self):
        pass


class FakeProfile:
    def __init__(self, name, path, default=False):
        self.name, self.path, self.is_default = name, path, default
        self.model, self.provider = "m", "p"
        self.description = f"{name} designs interfaces."
        self.display_name, self.skill_count = name.title(), 2


@pytest.fixture
def fake_hermes(tmp_path, monkeypatch):
    homes = {}
    for name in ("alice", "bob"):
        home = tmp_path / "profiles" / name
        home.mkdir(parents=True)
        homes[name] = home
        _sessions_db(home)
    _skill(homes["alice"], "design/figma-pro", "name: figma-pro\ndescription: " + SECRET + "\nmetadata:\n  hermes:\n    tags: [UI, Brand]")
    _skill(homes["alice"], "writing/old-one", "name: old-one", mtime=NOW - 30 * 86_400)
    _skill(homes["bob"], "ops/docker-ops", "name: docker-ops\ndescription: " + SECRET)
    # No other config key may ever leave the process: the secrets below sit beside the model block.
    (homes["alice"] / "config.yaml").write_text(
        "model:\n  default: example/model-fast\n  provider: acme-cloud\n"
        f"  api_key: {SECRET}\n  base_url: {SECRET}\n")
    (homes["bob"] / "config.yaml").write_text("model: example/model-large\nskills:\n  disabled: [docker-ops]\n")

    board_dir = tmp_path / "kanban"
    board_dir.mkdir()
    con = sqlite3.connect(board_dir / "kanban.db")
    con.executescript(SCHEMA)
    con.execute("INSERT INTO tasks (id, title, body, assignee, status, created_at, result) VALUES ('t1', 'Ship it', ?, 'alice', 'done', 10, ?)", (SECRET, SECRET))
    con.execute("INSERT INTO task_runs (task_id, profile, status, started_at, ended_at, outcome, summary) VALUES ('t1', 'alice', 'done', 1, 2, 'completed', ?)", (SECRET,))
    con.execute("INSERT INTO task_events (task_id, kind, payload, created_at) VALUES ('t1', 'completed', ?, 3)", (SECRET,))
    con.commit()
    con.close()

    def mod(name, **attrs):
        m = types.ModuleType(name)
        m.__dict__.update(attrs)
        monkeypatch.setitem(sys.modules, name, m)
        return m

    profiles = [FakeProfile("alice", homes["alice"], True), FakeProfile("bob", homes["bob"])]
    mod("hermes_yaml", safe_load=yaml.safe_load)
    mod("hermes_cli")
    mod("hermes_cli.profiles", list_profiles=lambda lazy_skill_count=False: profiles)
    mod("hermes_cli.kanban_db_boards", list_boards=lambda include_archived=False: [
        {"slug": "default", "db_path": str(board_dir / "kanban.db"), "created_at": None}])
    mod("hermes_state", SessionDB=FakeDB)
    mod("tui_gateway")
    mod("tui_gateway.methods_session", _denied_source=lambda row: row.get("source") == "kanban")
    return homes


def _client():
    spec = importlib.util.spec_from_file_location("floor_plugin_api_hist", ROOT / "dashboard" / "plugin_api.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    app = FastAPI()
    app.include_router(module.router, prefix="/api/plugins/hermes-officecraft")
    return TestClient(app)


def _walk(node, path=()):
    """Every (container path, key) of the payload."""
    if isinstance(node, dict):
        for k, v in node.items():
            yield path, k
            yield from _walk(v, path + (k,))
    elif isinstance(node, list):
        for item in node:
            yield from _walk(item, path + ("[]",))


def test_history_has_no_forbidden_key_and_no_secret(fake_hermes):
    body = _client().get("/api/plugins/hermes-officecraft/history").json()
    assert body["ok"] is True, body
    keys = {k for _, k in _walk(body)}
    assert not FORBIDDEN_KEYS & keys, FORBIDDEN_KEYS & keys
    # `description` exists only as the profile's own role text (profiles[].description), never on a skill
    for path, k in _walk(body):
        if k == "description":
            assert path == ("profiles", "[]"), path
    # planted in card bodies, results, previews, event payloads, run summaries and SKILL.md descriptions/bodies
    assert SECRET not in json.dumps(body)
    assert all(len(p["description"]) <= 280 for p in body["profiles"])


def test_history_shape_matches_what_the_front_reads(fake_hermes):
    body = _client().get("/api/plugins/hermes-officecraft/history").json()
    by = {p["name"]: p for p in body["profiles"]}
    alice, bob = by["alice"], by["bob"]
    assert set(alice) == {"name", "isDefault", "model", "provider", "defaultModel", "defaultProvider", "description",
                          "lastSession", "lastNonEmptySession", "worker", "workerModel", "stats", "skills"}
    # default model of the bot from its raw config.yaml (profiles.list sends an empty model in the webapp):
    # dict form for alice, bare-string form for bob
    assert alice["defaultModel"] == "example/model-fast" and alice["defaultProvider"] == "acme-cloud"
    assert bob["defaultModel"] == "example/model-large" and bob["defaultProvider"] is None
    assert alice["lastSession"] == {"title": "Fix it", "last_active": NOW - 5000, "source": "cli"}
    assert alice["worker"]["source"] == "kanban"
    # model the worker session really ran with (sessions.model), exact string; the human session carries none
    assert alice["workerModel"] == "example/model-large" and alice["worker"]["model"] == "example/model-large"
    assert alice["stats"] == {"firstSeen": NOW - 5000, "inputTokens": 101, "cacheReadTokens": 41}
    assert set(alice["skills"]) == {"count", "enabled", "disabled", "categories", "own", "names", "recent"}
    own = {s["name"]: s for s in alice["skills"]["own"]}
    assert set(own["figma-pro"]) == {"name", "category", "tags"} and own["figma-pro"]["tags"] == ["ui", "brand"]
    assert alice["skills"]["recent"][0]["name"] == "figma-pro"      # newest own skill first
    assert bob["skills"]["enabled"] == 0 and bob["skills"]["disabled"] == 1 and bob["skills"]["own"] == []
    board = body["boards"][0]
    assert board["runs"] == [{"profile": "alice", "startedAt": 1, "endedAt": 2, "outcome": "completed", "task": "t1"}]   # the card of the run
    assert board["events"] == [{"task": "t1", "kind": "completed", "ts": 3}]
    # the cron history is served beside profiles and boards (no cron dir in this fake home: an empty list, never a missing key);
    # a board whose schema has no `task_links` table serves no `links` key (« not served », never « no link »)
    assert body["crons"] == []
    assert "links" not in board


def test_history_still_answers_when_the_cron_source_fails(fake_hermes, monkeypatch):
    snapshot = _snapshot_module()   # the module the mounted route actually uses
    monkeypatch.setattr(snapshot, "hermes_cron_runs", lambda: (_ for _ in ()).throw(RuntimeError("locked")))
    body = _client().get("/api/plugins/hermes-officecraft/history").json()
    assert body["ok"] is True and body["crons"] == [] and body["profiles"] and body["boards"]


def test_history_survives_broken_sessions_and_config(fake_hermes):
    class Boom(FakeDB):
        def list_sessions_rich(self, **_):
            raise RuntimeError("locked")
    sys.modules["hermes_state"].SessionDB = Boom
    (fake_hermes["bob"] / "state.db").write_bytes(b"not sqlite")
    (fake_hermes["bob"] / "config.yaml").write_text(": : :\n\t- [")
    body = _client().get("/api/plugins/hermes-officecraft/history").json()
    assert body["ok"] is True
    bob = {p["name"]: p for p in body["profiles"]}["bob"]
    assert bob["lastSession"] is None and bob["worker"] is None and bob["stats"] == {}
    # an unreadable config.yaml costs the bot its default model, never the row
    assert bob["defaultModel"] is None and bob["defaultProvider"] is None


def test_history_answers_ok_false_when_every_read_fails(fake_hermes):
    def boom(**_):
        raise OSError("no home")
    sys.modules["hermes_cli.profiles"].list_profiles = boom
    sys.modules["hermes_cli.kanban_db_boards"].list_boards = boom
    body = _client().get("/api/plugins/hermes-officecraft/history").json()
    assert body["ok"] is False and body["error"] == "OSError" and "profiles" not in body


def test_history_serves_the_boards_when_only_the_profiles_read_fails(fake_hermes):
    """Each source on its own (a single-source failure must not hide the other one)."""
    def boom(**_):
        raise OSError("no home")
    sys.modules["hermes_cli.profiles"].list_profiles = boom
    body = _client().get("/api/plugins/hermes-officecraft/history").json()
    assert body["ok"] is True and body["profiles"] == [] and body["boards"]


def test_history_is_fast_on_a_large_roster(fake_hermes, tmp_path):
    """13 profiles x 60 skills, cold cache: far inside the 1.5 s budget."""
    profiles = []
    for i in range(13):
        home = tmp_path / "big" / f"p{i}"
        home.mkdir(parents=True)
        _sessions_db(home)
        for j in range(60):
            _skill(home, f"cat{j % 6}/skill-{j}", f"name: skill-{j}\ndescription: {SECRET}\ntags: [t{j}]")
        profiles.append(FakeProfile(f"p{i}", home))
    sys.modules["hermes_cli.profiles"].list_profiles = lambda lazy_skill_count=False: profiles
    client = _client()
    t0 = time.perf_counter()
    body = client.get("/api/plugins/hermes-officecraft/history").json()
    elapsed = time.perf_counter() - t0
    assert body["ok"] is True and len(body["profiles"]) == 13
    assert elapsed < 1.5, elapsed


def test_header_cache_never_keeps_descriptions_and_reparses_changes(tmp_path):
    spec = importlib.util.spec_from_file_location("officecraft_snapshot_hist", ROOT / "hermes_officecraft" / "snapshot.py")
    snap = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(snap)
    _skill(tmp_path / "a", "x/one", f"name: one\ndescription: {SECRET}\ntags: [Alpha]")
    md = tmp_path / "a" / "skills" / "x" / "one" / "SKILL.md"
    assert snap._header_tags(md, yaml.safe_load) == ["alpha"]
    assert SECRET not in json.dumps([list(v) for v in snap._TAGS_CACHE.values()])
    md.write_text("---\nname: one\ntags: [Beta]\n---\nbody")
    assert snap._header_tags(md, yaml.safe_load) == ["beta"]      # a changed header is parsed again
    assert snap._header_tags(tmp_path / "missing.md", yaml.safe_load) == []


def test_default_model_reads_only_the_model_names_from_the_raw_config(tmp_path):
    """`defaultModel`/`defaultProvider` come from the profile's raw config.yaml, like
    `hermes_cli/profiles.py::_read_config_model`, and nothing else of that file escapes."""
    spec = importlib.util.spec_from_file_location("officecraft_snapshot_model", ROOT / "hermes_officecraft" / "snapshot.py")
    snap = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(snap)

    n = 0

    def reader(cfg: str | None):
        nonlocal n
        n += 1
        home = tmp_path / f"p{n}"
        home.mkdir()
        if cfg is not None:
            (home / "config.yaml").write_text(cfg, encoding="utf-8")
        return snap.read_default_model(home, yaml.safe_load)

    assert reader("model:\n  default: example/model-large\n  provider: acme-cloud\n") == ("example/model-large", "acme-cloud")
    assert reader("model:\n  model: model-5\n") == ("model-5", None)              # `model.model` works too
    assert reader("model: example/model-fast\n") == ("example/model-fast", None)
    assert reader("model:\n  default: \"  spaced  \"\n  provider: \"\"\n") == ("spaced", None)   # trimmed, empty -> null
    assert reader("model:\n  default: " + "x" * 300 + "\n") == ("x" * 120, None)              # bounded
    assert reader("skills:\n  disabled: []\n") == (None, None)               # model key absent
    assert reader(None) == (None, None)                                      # no config.yaml at all
    assert reader("model:\n  default: a\n  api_key: " + SECRET + "\n  base_url: " + SECRET + "\n") == ("a", None)
    assert reader(": : :\n\t- [") == (None, None)                            # unreadable YAML
    # a `model` block that is neither a string nor a mapping carries no model name
    assert reader("model:\n  - a\n  - b\n") == (None, None)


# Keys of the files /live reads that must never leave the process: cron prompt/script/target,
# gateway pid/tokens, card columns outside the whitelist.
LIVE_FORBIDDEN_KEYS = FORBIDDEN_KEYS | {"script", "deliver", "workdir", "base_url", "last_error", "token", "pid",
                                        "reasoning_effort", "model_config", "comments", "messages"}


def test_live_has_no_forbidden_key_and_no_secret(fake_hermes, tmp_path, monkeypatch):
    """The real /live route (boards + gateway + crons), walked recursively like /history."""
    alice = fake_hermes["alice"]
    (alice / "gateway_state.json").write_text(json.dumps({
        "gateway_state": "running", "updated_at": "2026-11-08T10:00:00+00:00", "active_agents": 1, "pid": 4242,
        "token": SECRET, "platforms": {"telegram": {"state": "connected", "needs_attention": False, "token": SECRET}}}))
    (alice / "cron").mkdir()
    (alice / "cron" / "jobs.json").write_text(json.dumps({"jobs": [{
        "name": "digest", "enabled": True, "prompt": SECRET, "script": SECRET, "deliver": SECRET, "workdir": SECRET,
        "base_url": SECRET, "last_error": SECRET, "last_status": "ok", "last_run_at": "2026-11-08T09:00:00+00:00"}]}))
    con = sqlite3.connect(tmp_path / "kanban" / "kanban.db")
    for col in ("model_override", "provider_override", "reasoning_effort"):
        con.execute(f"ALTER TABLE tasks ADD COLUMN {col} TEXT")
    con.execute("UPDATE tasks SET status = 'running', model_override = 'large', reasoning_effort = ?", (SECRET,))
    con.commit()
    con.close()
    hc = types.ModuleType("hermes_constants")
    hc.get_hermes_home = lambda: alice
    monkeypatch.setitem(sys.modules, "hermes_constants", hc)

    body = _client().get("/api/plugins/hermes-officecraft/live").json()
    assert body["ok"] is True, body
    assert body["boards"][0]["tasks"][0]["modelOverride"] == "large"          # the fixture really went through
    assert body["ops"]["crons"][0]["name"] == "digest" and body["ops"]["gateway"]["state"] == "running"
    keys = {k for _, k in _walk(body)}
    assert not LIVE_FORBIDDEN_KEYS & keys, LIVE_FORBIDDEN_KEYS & keys
    assert "description" not in keys
    assert SECRET not in json.dumps(body)


def _snapshot_module():
    """The snapshot module the mounted route actually uses (loaded by dashboard/plugin_api.py)."""
    _client()   # importing the route loads hermes_officecraft.snapshot under its private name
    for name, module in list(sys.modules.items()):
        # not the plain `hermes_officecraft.snapshot` that other test modules import for direct calls
        if name.endswith(".snapshot") and not name.startswith("hermes_officecraft.") \
                and module is not None and getattr(module, "hermes_profiles", None):
            return module
    raise AssertionError("the route did not load a snapshot module")


def test_a_wedged_session_store_costs_its_bot_its_sessions_not_the_route(fake_hermes, monkeypatch):
    """The first /history blew the front's 10 s timeout and the journal only arrived ~70 s
    later, because Hermes's own reader waits 5 s per busy state.db. A store that does not answer must
    cost that bot its session facts for this round: the page still gets skills, roles and models."""
    calls = []

    class Wedged(FakeDB):
        def list_sessions_rich(self, **_):
            calls.append(1)
            time.sleep(2.0)          # what a busy store looks like through hermes_state's 5 s timeout
            return self.rows

    sys.modules["hermes_state"].SessionDB = Wedged
    client = _client()
    snap = _snapshot_module()
    monkeypatch.setattr(snap, "SESSION_READ_TIMEOUT_S", 0.15)
    monkeypatch.setattr(snap, "SESSIONS_BUDGET_S", 0.4)   # room for a whole slot per bot (a bot cut by the budget is not skipped)
    monkeypatch.setattr(snap, "_SLOW_SESSIONS", {})

    t0 = time.perf_counter()
    body = client.get("/api/plugins/hermes-officecraft/history").json()
    elapsed = time.perf_counter() - t0
    assert elapsed < 1.5, elapsed
    assert body["ok"] is True and len(body["profiles"]) == 2
    alice = {p["name"]: p for p in body["profiles"]}["alice"]
    assert alice["lastSession"] is None and alice["worker"] is None
    # the aggregates are our own bounded read (0.2 s), so they may still arrive; the session rows may not
    # everything the page needs for the scene survives: role, skills, model
    assert alice["description"] and alice["defaultModel"] == "example/model-fast"
    assert alice["skills"]["own"] and alice["skills"]["count"] == 2
    # the wedged store is remembered, so the next read does not queue behind it again
    assert calls and str((fake_hermes["alice"] / "state.db").resolve()) in snap._SLOW_SESSIONS
    before = len(calls)
    t0 = time.perf_counter()
    client.get("/api/plugins/hermes-officecraft/history").json()
    assert time.perf_counter() - t0 < 1.0
    assert len(calls) == before, "a store that just missed its slot must be left alone"


def test_one_config_yaml_parse_per_bot(fake_hermes, monkeypatch):
    """`/history` used to parse each bot's config.yaml twice (skills' disabled list + model block),
    a third of the cold read. The route parses it once and feeds both readers."""
    client = _client()
    snap = _snapshot_module()
    seen = []
    real = snap.read_profile_config
    monkeypatch.setattr(snap, "read_profile_config", lambda home, loader: seen.append(str(home)) or real(home, loader))
    body = client.get("/api/plugins/hermes-officecraft/history").json()
    assert body["ok"] is True
    assert sorted(seen) == sorted([str(fake_hermes["alice"]), str(fake_hermes["bob"])])
    by = {p["name"]: p for p in body["profiles"]}
    assert by["bob"]["skills"]["disabled"] == 1 and by["bob"]["defaultModel"] == "example/model-large"


def test_slow_skills_and_config_reads_never_spend_the_session_budget(fake_hermes, tmp_path, monkeypatch):
    """`SESSIONS_BUDGET_S` clocks the session phase alone, not the per-bot skills/config reads
    (~0.1 s) that run between two bots' session reads: 13 bots whose config/skills reads are slow
    keep all their session facts (`lastSession`, `worker`, `workerModel`, `stats`)."""
    profiles = []
    for i in range(13):
        home = tmp_path / "qa7" / f"p{i:02d}"
        home.mkdir(parents=True)
        _sessions_db(home)                       # every bot has a human and a worker session
        (home / "config.yaml").write_text(f"model: model-{i}\n", encoding="utf-8")
        _skill(home, "own/one", f"name: one-{i}")
        profiles.append(FakeProfile(f"p{i:02d}", home))
    sys.modules["hermes_cli.profiles"].list_profiles = lambda lazy_skill_count=False: profiles
    client = _client()
    snap = _snapshot_module()
    real = snap.read_profile_config

    def slow(home, loader):
        time.sleep(0.1)                          # roughly what reading a bot's config.yaml + skills costs
        return real(home, loader)

    monkeypatch.setattr(snap, "read_profile_config", slow)
    monkeypatch.setattr(snap, "_SLOW_SESSIONS", {})

    body = client.get("/api/plugins/hermes-officecraft/history").json()
    assert body["ok"] is True and len(body["profiles"]) == 13
    for p in body["profiles"]:
        assert p["lastSession"] and p["lastSession"]["title"] == "Fix it", p["name"]
        assert p["worker"] and p["worker"]["title"] == "Worker", p["name"]
        # the model the worker session really ran with, and the aggregates behind the trophies
        assert p["workerModel"] == "example/model-large", p["name"]
        assert p["stats"] == {"firstSeen": NOW - 5000, "inputTokens": 101, "cacheReadTokens": 41}, p["name"]
