"""Orders (unblock, comment), the audit journal and its routes, against a FAKE ``kanban_db`` backed by real
sqlite files (copies of nothing real: every database lives in ``tmp_path``). CI has no Hermes, so this is the
suite that always runs."""

import contextlib
import importlib.util
import json
import re
import sqlite3
import sys
import threading
import types
import uuid
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
BASE = "/api/plugins/hermes-officecraft"
SLUG = re.compile(r"^[a-z0-9][a-z0-9\-_]{0,63}$")


def _router_module():
    spec = importlib.util.spec_from_file_location("orders_plugin_api", ROOT / "dashboard" / "plugin_api.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _m(name):
    """The package is loaded by file path under a private name (dashboard/plugin_api.py): patch THAT copy."""
    _router_module()
    return sys.modules[f"_officecraft_http.{name}"]


class FakeKanban:
    """The part of ``hermes_cli.kanban_db`` / ``kanban_db_connect`` the orders use, with Hermes' semantics:
    ``unblock_task`` acts on blocked/scheduled only and returns False otherwise; ``add_comment`` refuses blank
    text, strips it and has no condition; ``write_txn`` is IMMEDIATE, nested = savepoint only on request."""

    SCHEMA = """CREATE TABLE tasks (id TEXT PRIMARY KEY, status TEXT NOT NULL, title TEXT, assignee TEXT);
        CREATE TABLE task_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, author TEXT, body TEXT);
        CREATE TABLE task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, kind TEXT, payload TEXT);
        CREATE TABLE task_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT);"""

    def __init__(self, root: Path):
        self.root = root
        self.boards: dict[str, bool] = {}   # slug -> archived
        self.make_board("default")
        self.before_write = None            # hook for the race test

    def path(self, slug):
        return self.root / f"{slug}.db"

    def make_board(self, slug, archived=False, with_db=True):
        self.boards[slug] = archived
        if with_db:
            con = sqlite3.connect(self.path(slug))
            con.executescript(self.SCHEMA)
            con.commit()
            con.close()

    def add_task(self, slug, tid, status, title="t", assignee=None):
        con = sqlite3.connect(self.path(slug))
        con.execute("INSERT INTO tasks (id, status, title, assignee) VALUES (?, ?, ?, ?)", (tid, status, title, assignee))
        con.commit()
        con.close()

    def rows(self, slug, sql, *args):
        con = sqlite3.connect(self.path(slug))
        try:
            return con.execute(sql, args).fetchall()
        finally:
            con.close()

    def status(self, slug, tid):
        return self.rows(slug, "SELECT status FROM tasks WHERE id=?", tid)[0][0]

    def modules(self):
        fake = self
        kb = types.ModuleType("hermes_cli.kanban_db")
        kb.DEFAULT_BOARD = "default"

        def normalize(slug):
            s = str(slug).strip().lower() if slug is not None else ""
            if not s:
                return None
            if not SLUG.match(s):
                raise ValueError("invalid board slug")
            return s

        kb._normalize_board_slug = normalize
        kb.board_exists = lambda slug=None: slug in fake.boards
        kb.read_board_metadata = lambda slug=None: {"archived": fake.boards.get(slug, False)}
        kb.kanban_db_path = lambda board=None: fake.path(board)

        def unblock_task(conn, tid):
            with kbc.write_txn(conn):
                cur = conn.execute("UPDATE tasks SET status='ready' WHERE id=? AND status IN ('blocked','scheduled')", (tid,))
                if cur.rowcount != 1:
                    return False
                conn.execute("INSERT INTO task_events (task_id, kind) VALUES (?, 'unblocked')", (tid,))
                return True

        def add_comment(conn, tid, author, body):
            if not body or not body.strip():
                raise ValueError("comment body is required")
            with kbc.write_txn(conn, allow_nested=True):
                if not conn.execute("SELECT 1 FROM tasks WHERE id=?", (tid,)).fetchone():
                    raise ValueError(f"unknown task {tid}")
                conn.execute("INSERT INTO task_comments (task_id, author, body) VALUES (?, ?, ?)", (tid, author.strip(), body.strip()))
                conn.execute("INSERT INTO task_events (task_id, kind, payload) VALUES (?, 'commented', ?)", (tid, json.dumps({"author": author, "len": len(body)})))

        kb.unblock_task, kb.add_comment = unblock_task, add_comment

        kbc = types.ModuleType("hermes_cli.kanban_db_connect")

        @contextlib.contextmanager
        def connect_closing(db_path=None, *, board=None):
            conn = sqlite3.connect(fake.path(board), isolation_level=None)
            conn.row_factory = sqlite3.Row
            try:
                yield conn
            finally:
                conn.close()

        @contextlib.contextmanager
        def write_txn(conn, *, allow_nested=False):
            if conn.in_transaction:
                if not allow_nested:
                    raise RuntimeError("write_txn: already inside a transaction")
                conn.execute("SAVEPOINT nested")
                yield conn
                conn.execute("RELEASE nested")
                return
            if fake.before_write:
                fake.before_write()
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
            except Exception:
                conn.execute("ROLLBACK")
                raise
            conn.execute("COMMIT")

        kbc.connect_closing, kbc.write_txn = connect_closing, write_txn
        pkg = types.ModuleType("hermes_cli")
        pkg.kanban_db, pkg.kanban_db_connect = kb, kbc
        return {"hermes_cli": pkg, "hermes_cli.kanban_db": kb, "hermes_cli.kanban_db_connect": kbc}


@pytest.fixture
def world(tmp_path, monkeypatch):
    fake = FakeKanban(tmp_path)
    for name, module in fake.modules().items():
        monkeypatch.setitem(sys.modules, name, module)
    mod = _router_module()
    app = FastAPI()
    app.include_router(mod.router, prefix=BASE)
    audit, orders = _m("audit"), _m("orders")
    monkeypatch.setattr(audit, "data_dir", lambda: tmp_path / "plugin-data")
    orders.reset()
    fake.make_board("sandbox")
    fake.make_board("other")
    fake.make_board("tomb", archived=True)
    fake.make_board("nodb", with_db=False)
    fake.add_task("sandbox", "t_00000001", "blocked")
    fake.add_task("sandbox", "t_00000002", "ready")
    fake.add_task("sandbox", "t_00000003", "running", assignee="someone")
    fake.add_task("sandbox", "t_00000004", "archived")
    fake.add_task("sandbox", "t_00000005", "todo")
    fake.add_task("sandbox", "t_00000006", "scheduled")   # Hermes' unblock_task would act on it: the order must not
    fake.add_task("other", "t_0000000a", "blocked")
    client = TestClient(app)
    client.fake, client.audit_dir = fake, tmp_path / "plugin-data"
    yield client
    orders.reset()


def order(client, verb, task, board="sandbox", text=None, oid=None):
    body = {"id": oid or str(uuid.uuid4()), "verb": verb, "board": board, "task": task}
    if text is not None:
        body["text"] = text
    return client.post(f"{BASE}/orders", json=body)


def journal(client):
    path = client.audit_dir / "audit.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


# ------------------------------------------------------------------ health

def test_health_capabilities_are_exactly_the_implemented_orders(world):
    orders = _m("orders")
    body = world.get(f"{BASE}/health").json()
    assert body["capabilities"] == [*orders.VERBS, "campaign"] and list(orders.VERBS) == ["unblock", "comment", "launch", "cancel_campaign"]
    assert "orders" in body["reads"]   # GET /orders (the journal) is a read the page can gate on


# ------------------------------------------------------------------ unblock x (success, precondition, unknown card, unknown board, replay)

def test_unblock_success_rereads_the_card_and_journals(world):
    r = order(world, "unblock", "t_00000001")
    body = r.json()
    assert r.status_code == 200 and body["ok"] is True and body["result"] == "done" and body["risk"] == "final"
    assert body["before"] == {"status": "blocked"} and body["after"] == {"status": "ready", "comments": 0}
    assert world.fake.status("sandbox", "t_00000001") == "ready"
    line = journal(world)[-1]
    assert (line["verb"], line["result"], line["risk"], line["source"]) == ("unblock", "done", "final", "agent")
    assert line["before"] == {"status": "blocked"} and line["after"] == {"status": "ready"}


@pytest.mark.parametrize("task,reason", [("t_00000002", "not_blocked"), ("t_00000005", "not_blocked"),
                                         ("t_00000006", "not_blocked"),   # scheduled: not_blocked
                                         ("t_00000003", "running"), ("t_00000004", "archived_task")])
def test_unblock_wrong_status_is_refused_and_the_card_is_untouched(world, task, reason):
    before = world.fake.status("sandbox", task)
    body = order(world, "unblock", task).json()
    assert (body["ok"], body["result"], body["reason"]) == (False, "refused", reason)
    assert world.fake.status("sandbox", task) == before
    assert world.fake.rows("sandbox", "SELECT COUNT(*) FROM task_events WHERE task_id=?", task) == [(0,)]


def test_unblock_unknown_card_unknown_board_archived_board_no_database(world):
    assert order(world, "unblock", "t_deadbeef").json()["reason"] == "unknown_task"
    assert order(world, "unblock", "t_0000000a").json()["reason"] == "unknown_task"   # a card of ANOTHER board
    assert order(world, "unblock", "t_00000001", board="nope").json()["reason"] == "unknown_board"
    assert order(world, "unblock", "t_00000001", board="tomb").json()["reason"] == "archived_board"
    assert order(world, "unblock", "t_00000001", board="nodb").json()["reason"] == "unknown_task"
    assert not world.fake.path("nodb").exists()   # refusing never creates a database
    assert world.fake.status("sandbox", "t_00000001") == "blocked"


def test_unblock_replay_with_the_same_id_acts_once(world):
    oid = str(uuid.uuid4())
    first = order(world, "unblock", "t_00000001", oid=oid).json()
    again = order(world, "unblock", "t_00000001", oid=oid).json()
    assert again["replayed"] is True and again["result"] == "done" and again["after"] == first["after"]
    assert world.fake.rows("sandbox", "SELECT COUNT(*) FROM task_events WHERE kind='unblocked'") == [(1,)]
    assert len(journal(world)) == 1   # a replay is not a second attempt


def test_unblock_never_touches_another_board(world):
    order(world, "unblock", "t_00000001")
    assert world.fake.status("other", "t_0000000a") == "blocked"
    assert world.fake.rows("other", "SELECT COUNT(*) FROM task_events") == [(0,)]


# ------------------------------------------------------------------ comment x (...)

def test_comment_success_author_strip_len_and_reread(world):
    r = order(world, "comment", "t_00000001", text="  note  ")
    body = r.json()
    assert r.status_code == 200 and body["result"] == "done" and body["after"] == {"status": "blocked", "comments": 1}
    assert world.fake.rows("sandbox", "SELECT author, body FROM task_comments") == [("officecraft", "note")]
    line = journal(world)[-1]
    assert line["verb"] == "comment" and line["len"] == 8 and line["risk"] == "final"
    assert "note" not in json.dumps(line)


@pytest.mark.parametrize("task,reason", [("t_00000003", "running"), ("t_00000004", "archived_task")])
def test_comment_wrong_status_is_refused(world, task, reason):
    body = order(world, "comment", task, text="hello").json()
    assert (body["result"], body["reason"]) == ("refused", reason)
    assert world.fake.rows("sandbox", "SELECT COUNT(*) FROM task_comments") == [(0,)]


def test_comment_unknown_card_unknown_board_blank_text(world):
    assert order(world, "comment", "t_deadbeef", text="x").json()["reason"] == "unknown_task"
    assert order(world, "comment", "t_00000002", board="nope", text="x").json()["reason"] == "unknown_board"
    assert order(world, "comment", "t_00000002", board="tomb", text="x").json()["reason"] == "archived_board"
    assert order(world, "comment", "t_00000002", text=" \n\t ").json()["reason"] == "empty_text"
    assert world.fake.rows("sandbox", "SELECT COUNT(*) FROM task_comments") == [(0,)]


def test_comment_text_bounds_422_beyond_4000_and_accepted_at_4000(world):
    assert order(world, "comment", "t_00000002", text="x" * 4000).json()["result"] == "done"
    too_long = order(world, "comment", "t_00000002", text="x" * 4001)
    assert too_long.status_code == 422
    assert world.fake.rows("sandbox", "SELECT COUNT(*) FROM task_comments") == [(1,)]
    assert len(journal(world)) == 1   # a body that does not validate is not an order tried


def test_comment_replay_with_the_same_id_writes_one_comment(world):
    oid = str(uuid.uuid4())
    order(world, "comment", "t_00000002", text="once", oid=oid)
    again = order(world, "comment", "t_00000002", text="once", oid=oid).json()
    assert again["replayed"] is True
    assert world.fake.rows("sandbox", "SELECT COUNT(*) FROM task_comments") == [(1,)]


def test_comment_is_checked_and_written_in_one_transaction(world):
    """A card that starts running between the first read and the write must still be refused."""
    def go_running():
        world.fake.before_write = None
        con = sqlite3.connect(world.fake.path("sandbox"))
        con.execute("UPDATE tasks SET status='running' WHERE id='t_00000002'")
        con.commit()
        con.close()
    world.fake.before_write = go_running
    body = order(world, "comment", "t_00000002", text="late").json()
    assert (body["result"], body["reason"]) == ("refused", "running")
    assert world.fake.rows("sandbox", "SELECT COUNT(*) FROM task_comments") == [(0,)]


# ------------------------------------------------------------------ validation, replay across restart, busy, hermes errors

@pytest.mark.parametrize("patch", [
    {"verb": "block"}, {"verb": "reblock"}, {"board": "../etc"}, {"board": "A"}, {"board": ""}, {"task": "t_1"},
    {"task": "t_00000001; DROP TABLE tasks"}, {"task": "../../x"}, {"id": "not-a-uuid"}, {"extra": 1}, {"text": "x"},
])
def test_invalid_bodies_are_422_and_nothing_runs(world, patch):
    body = {"id": str(uuid.uuid4()), "verb": "unblock", "board": "sandbox", "task": "t_00000001", **patch}
    assert world.post(f"{BASE}/orders", json=body).status_code == 422
    assert world.fake.status("sandbox", "t_00000001") == "blocked"
    assert journal(world) == []


def test_comment_without_text_is_422(world):
    assert order(world, "comment", "t_00000002").status_code == 422


def test_get_is_not_an_order(world):
    assert world.get(f"{BASE}/orders", params={"verb": "unblock"}).status_code == 200   # GET /orders only lists the journal
    assert world.fake.status("sandbox", "t_00000001") == "blocked"


def test_body_beyond_the_size_bound_is_413(world):
    body = {"id": str(uuid.uuid4()), "verb": "comment", "board": "sandbox", "task": "t_00000002", "text": "é" * 4000, "pad": "x" * 30000}
    assert world.post(f"{BASE}/orders", json=body).status_code == 413


def test_replay_survives_a_restart_through_the_journal(world):
    orders = _m("orders")
    oid = str(uuid.uuid4())
    order(world, "comment", "t_00000002", text="once", oid=oid)
    orders.reset()   # a new process: only the journal remains
    again = order(world, "comment", "t_00000002", text="once", oid=oid)
    assert again.status_code == 200 and again.json()["replayed"] is True
    assert world.fake.rows("sandbox", "SELECT COUNT(*) FROM task_comments") == [(1,)]
    assert len(journal(world)) == 1


def test_same_id_for_another_order_is_refused_not_replayed(world):
    oid = str(uuid.uuid4())
    order(world, "unblock", "t_00000001", oid=oid)
    r = order(world, "comment", "t_00000002", text="x", oid=oid)
    assert r.status_code == 409 and r.json()["reason"] == "id_conflict"
    assert world.fake.rows("sandbox", "SELECT COUNT(*) FROM task_comments") == [(0,)]


def test_a_second_order_while_one_runs_gets_busy_409(world):
    orders = _m("orders")
    seen = {}

    def inner():
        seen["r"] = order(world, "comment", "t_00000002", text="second")

    def slow_write():
        world.fake.before_write = None
        t = threading.Thread(target=inner)
        t.start()
        t.join()

    world.fake.before_write = slow_write
    first = order(world, "comment", "t_00000005", text="first")
    assert first.json()["result"] == "done"
    assert seen["r"].status_code == 409 and seen["r"].json()["result"] == "busy"
    assert world.fake.rows("sandbox", "SELECT task_id FROM task_comments") == [("t_00000005",)]
    assert not orders._run_lock.locked()


def test_a_hermes_failure_is_a_code_never_a_500_or_a_leak(world, monkeypatch):
    kb = sys.modules["hermes_cli.kanban_db"]

    def boom(conn, tid):
        raise PermissionError("secret path /home/someone/.hermes/kanban.db")

    monkeypatch.setattr(kb, "unblock_task", boom)
    r = order(world, "unblock", "t_00000001")
    body = r.json()
    assert r.status_code == 200 and (body["result"], body["reason"]) == ("failed", "hermes_error")
    assert "secret" not in r.text and "/home" not in r.text
    assert "secret" not in json.dumps(journal(world)) and journal(world)[-1]["reason"] == "hermes_error"
    assert world.fake.status("sandbox", "t_00000001") == "blocked"


def test_hermes_missing_is_a_failure_code_not_a_crash(world, monkeypatch):
    monkeypatch.setitem(sys.modules, "hermes_cli", None)   # `import hermes_cli` -> ImportError
    r = order(world, "unblock", "t_00000001")
    assert r.status_code == 200 and r.json()["reason"] == "hermes_error"


def test_the_answer_is_the_reread_state_not_the_assumed_one(world, monkeypatch):
    """unblock_task says True but the card lands in `todo` (parent open): the answer carries what the database holds."""
    kb = sys.modules["hermes_cli.kanban_db"]
    real = kb.unblock_task

    def to_todo(conn, tid):
        ok = real(conn, tid)
        conn.execute("UPDATE tasks SET status='todo' WHERE id=?", (tid,))
        return ok

    monkeypatch.setattr(kb, "unblock_task", to_todo)
    body = order(world, "unblock", "t_00000001").json()
    assert body["after"]["status"] == "todo"


# ------------------------------------------------------------------ journal: whitelist, rotation, routes

def test_journal_whitelist_drops_everything_else_and_cuts_strings(world):
    audit = _m("audit")
    audit.append({"id": "x" * 400, "verb": "comment", "board": "b", "task": "t_00000001", "result": "done", "risk": "final",
                  "text": "SECRET COMMENT", "body": "SECRET", "command": "rm -rf /", "path": "/home/x", "token": "abc",
                  "before": {"status": "blocked", "title": "SECRET TITLE"}, "after": {"status": "ready", "path": "/p"},
                  "len": 14, "headers": {"authorization": "Bearer abc"}, "error": "Traceback ...", "source": "agent"})
    raw = (world.audit_dir / "audit.jsonl").read_text()
    line = json.loads(raw)
    assert set(line) <= set(audit.FIELDS)
    for forbidden in ("SECRET", "rm -rf", "/home", "abc", "Traceback", "authorization"):
        assert forbidden not in raw
    assert len(line["id"]) == 256 and line["before"] == {"status": "blocked"} and line["after"] == {"status": "ready"}


def test_journal_rejects_bad_types_and_values(world):
    audit = _m("audit")
    line = audit.append({"id": "i", "verb": "rm", "risk": "huge", "result": "maybe", "source": "root", "choice": "always!",
                         "len": -5, "ts": "now", "before": {"status": "Blocked; DROP"}, "profile": 5})
    assert line["id"] == "i" and set(line) == {"id", "ts"}


def test_journal_files_are_private(world):
    order(world, "unblock", "t_00000001")
    assert (world.audit_dir.stat().st_mode & 0o777) == 0o700
    assert ((world.audit_dir / "audit.jsonl").stat().st_mode & 0o777) == 0o600


def test_journal_rotates_at_5mb_with_three_backups(world, monkeypatch):
    audit = _m("audit")
    monkeypatch.setattr(audit, "MAX_BYTES", 400)
    for i in range(60):
        audit.append({"id": f"id-{i}", "verb": "comment", "result": "done"})
    names = sorted(p.name for p in world.audit_dir.iterdir())
    assert names == ["audit.jsonl", "audit.jsonl.1", "audit.jsonl.2", "audit.jsonl.3"]
    assert audit.MAX_BYTES == 400 and (5 * 1024 * 1024, 3) == (5 * 1024 * 1024, audit.BACKUPS)


def test_rotation_constants_match_hermes_auth_journal():
    audit = _m("audit")
    assert (audit.MAX_BYTES, audit.BACKUPS, audit.MAX_FIELD) == (5 * 1024 * 1024, 3, 256)


def test_get_orders_lists_the_end_of_the_journal_newest_first(world):
    for i in range(3):
        order(world, "comment", "t_00000002", text=f"n{i}")
    body = world.get(f"{BASE}/orders", params={"limit": 2}).json()
    assert body["ok"] is True and len(body["entries"]) == 2
    ids = [e["id"] for e in journal(world)]
    assert [e["id"] for e in body["entries"]] == [ids[2], ids[1]]
    assert world.get(f"{BASE}/orders", params={"limit": 51}).status_code == 422
    assert world.get(f"{BASE}/orders", params={"limit": 0}).status_code == 422


def test_get_orders_serves_whitelisted_keys_only_even_from_a_tampered_file(world):
    audit = _m("audit")
    world.audit_dir.mkdir(parents=True)
    (world.audit_dir / "audit.jsonl").write_text(
        json.dumps({"id": "a", "verb": "comment", "text": "LEAK", "path": "/home/x", "after": {"status": "ready", "body": "LEAK"}}) + "\n"
        "not json\n" + json.dumps(["list"]) + "\n" + json.dumps({"verb": "unblock"}) + "\n")
    body = world.get(f"{BASE}/orders").json()
    assert body["entries"] == [{"id": "a", "verb": "comment", "after": {"status": "ready"}}]
    assert "LEAK" not in json.dumps(body)
    assert set().union(*[set(e) for e in body["entries"]]) <= set(audit.FIELDS)


def test_get_orders_without_a_journal_is_an_empty_list(world):
    assert world.get(f"{BASE}/orders").json()["entries"] == []


def test_the_audit_folder_is_the_one_hermes_gives_the_plugin(tmp_path, monkeypatch):
    mod = types.ModuleType("hermes_cli.plugins_state")

    class PluginState:
        def __init__(self, plugin_id, data_namespace=""):
            self.plugin_id = plugin_id
        data_dir = tmp_path / "plugin-data" / "agent-plugin-x"

    mod.PluginState = PluginState
    monkeypatch.setitem(sys.modules, "hermes_cli", types.ModuleType("hermes_cli"))
    monkeypatch.setitem(sys.modules, "hermes_cli.plugins_state", mod)
    audit = _m("audit")
    assert audit.data_dir() == tmp_path / "plugin-data" / "agent-plugin-x"


# ------------------------------------------------------------------ POST /audit (orders done by the page)

def audit_body(**kw):
    return {"id": str(uuid.uuid4()), "verb": "recruit", "risk": "reversible", "result": "done", "profile": "oc-test-a", **kw}


def test_post_audit_writes_one_page_line_and_executes_nothing(world):
    body = audit_body(verb="approval", risk="safe", choice="deny", profile=None)
    r = world.post(f"{BASE}/audit", json=body)
    assert r.status_code == 200 and r.json() == {"ok": True, "id": body["id"], "replayed": False}
    line = journal(world)[-1]
    assert (line["verb"], line["choice"], line["source"], line["risk"]) == ("approval", "deny", "page", "safe")
    assert world.fake.status("sandbox", "t_00000001") == "blocked"


def test_post_audit_same_id_twice_writes_once(world):
    body = audit_body()
    world.post(f"{BASE}/audit", json=body)
    again = world.post(f"{BASE}/audit", json=body).json()
    assert again["replayed"] is True and len(journal(world)) == 1


@pytest.mark.parametrize("patch", [{"verb": "unblock"}, {"verb": "comment"}, {"verb": "forget"}, {"choice": "root"}, {"profile": "../x"}, {"risk": "high"},
                                   {"text": "a comment"}, {"command": "rm -rf /"}, {"description": "d"}, {"path": "/x"}, {"reason": "Bad Reason"}])
def test_post_audit_refuses_other_verbs_and_forbidden_fields(world, patch):
    assert world.post(f"{BASE}/audit", json=audit_body(**patch)).status_code == 422
    assert journal(world) == []


def test_post_audit_revise_writes_one_line_with_the_bot_and_the_length_never_the_text(world):
    """A revised description is an order TRIED. The line names the bot, says `rev`, keeps the length; the text has no field."""
    text = "Takes backend tasks, delivers tested code, never touches design."
    body = audit_body(verb="revise", risk="rev", profile="oc-test-a", len=len(text))
    r = world.post(f"{BASE}/audit", json=body)
    assert r.status_code == 200 and r.json() == {"ok": True, "id": body["id"], "replayed": False}
    line = journal(world)[-1]
    assert (line["verb"], line["risk"], line["result"], line["profile"], line["source"]) == ("revise", "rev", "done", "oc-test-a", "page")
    assert line["len"] == len(text)
    assert text not in (world.audit_dir / "audit.jsonl").read_text()
    served = world.get(f"{BASE}/orders").json()["entries"][0]   # GET /orders renders it
    assert (served["verb"], served["risk"], served["profile"], served["len"]) == ("revise", "rev", "oc-test-a", len(text))
    assert text not in json.dumps(served)


@pytest.mark.parametrize("patch", [{"description": "the rewritten text"}, {"text": "the rewritten text"}, {"soul": "a soul"}])
def test_post_audit_revise_never_keeps_the_description_text(world, patch):
    """The text of a description is refused (no field for it), like a comment's; only its length can travel."""
    assert world.post(f"{BASE}/audit", json=audit_body(verb="revise", risk="rev", **patch)).status_code == 422
    assert journal(world) == []
    assert world.post(f"{BASE}/audit", json=audit_body(len=12)).status_code == 422   # `len` belongs to a revise only
    assert journal(world) == []


def test_post_audit_revise_can_say_why_it_failed(world):
    body = audit_body(verb="revise", risk="rev", profile="oc-test-a", result="failed", reason="not_applied")
    assert world.post(f"{BASE}/audit", json=body).status_code == 200
    line = journal(world)[-1]
    assert (line["result"], line["reason"], line["verb"]) == ("failed", "not_applied", "revise")


def test_post_audit_cannot_be_used_to_forge_an_agent_line(world):
    assert world.post(f"{BASE}/audit", json=audit_body(source="agent")).status_code == 422


def test_audit_write_failure_is_said_not_hidden(world, monkeypatch):
    audit = _m("audit")

    def full_disk(entry, directory=None):
        raise OSError("disk full /secret/path")

    monkeypatch.setattr(audit, "append", full_disk)
    r = world.post(f"{BASE}/audit", json=audit_body())
    assert r.status_code == 503 and "secret" not in r.text
    done = order(world, "unblock", "t_00000001")   # the order itself is done and says the journal missed it
    assert done.json()["result"] == "done" and done.json()["audited"] is False
