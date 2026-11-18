"""``POST /campaign``, the verbs ``launch`` and ``cancel_campaign`` of ``/orders`` and the guard marks of
``/live``, against a FAKE ``kanban_db`` backed by real sqlite files in ``tmp_path`` (CI has no Hermes). The fake follows
the semantics measured on the real one: a card is ``blocked`` when asked, else ``todo`` under a parent that is
not ``done`` (an ``archived`` parent does NOT count as done at creation but frees the child afterwards), ``create_task``
returns the id of a non-archived card that already has its idempotency key, ``write_txn`` is IMMEDIATE and an
exception rolls everything back, ``complete_task`` takes ``blocked -> done`` and promotes the children, ``archive_task``
promotes the children too."""

import contextlib
import copy
import importlib.util
import json
import re
import sqlite3
import sys
import types
import uuid
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
BASE = "/api/plugins/hermes-officecraft"
SLUG = re.compile(r"^[a-z0-9][a-z0-9\-_]{0,63}$")
BOTS = {"alpha", "bravo", "charlie"}


def _router_module():
    spec = importlib.util.spec_from_file_location("campaign_plugin_api", ROOT / "dashboard" / "plugin_api.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _m(name):
    _router_module()
    return sys.modules[f"_officecraft_http.{name}"]


class FakeKanban:
    SCHEMA = """CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, body TEXT, assignee TEXT, status TEXT NOT NULL,
            created_by TEXT, created_at INTEGER, idempotency_key TEXT, model_override TEXT, provider_override TEXT,
            workspace_kind TEXT, workspace_path TEXT, max_runtime_seconds INTEGER, claim_lock TEXT, worker_pid INTEGER);
        CREATE TABLE task_links (parent_id TEXT, child_id TEXT, PRIMARY KEY (parent_id, child_id));
        CREATE TABLE task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, kind TEXT, payload TEXT);
        CREATE TABLE task_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, profile TEXT, worker_pid INTEGER, claim_lock TEXT);
        CREATE TABLE task_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, author TEXT, body TEXT);"""

    def __init__(self, root: Path):
        self.root = root
        self.boards: dict[str, dict] = {}
        self.counter = 0
        self.fail_after = None          # raise in create_task once this many cards exist (a failure in the middle)
        self.tamper = None              # called after the commit: lets a test change what the database holds
        self.make_board("default")

    def path(self, slug):
        return self.root / f"{slug}.db"

    def make_board(self, slug, archived=False, workdir=None):
        self.boards[slug] = {"archived": archived, "default_workdir": workdir, "name": slug}
        if not archived:
            con = sqlite3.connect(self.path(slug))
            con.executescript(self.SCHEMA)
            con.commit()
            con.close()

    def rows(self, slug, sql, *args):
        con = sqlite3.connect(self.path(slug))
        con.row_factory = sqlite3.Row
        try:
            return [dict(r) for r in con.execute(sql, args).fetchall()]
        finally:
            con.close()

    def exec(self, slug, sql, *args):
        con = sqlite3.connect(self.path(slug))
        con.execute(sql, args)
        con.commit()
        con.close()

    def by_status(self, slug):
        out: dict[str, int] = {}
        for row in self.rows(slug, "SELECT status, COUNT(*) AS n FROM tasks GROUP BY status"):
            out[row["status"]] = row["n"]
        return out

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
        kb.board_exists = lambda slug=None: slug in fake.boards   # an archived board keeps its tombstone (board.json)
        kb.read_board_metadata = lambda slug=None: dict(fake.boards.get(slug, {}))
        kb.kanban_db_path = lambda board=None: fake.path(board)

        def recompute_ready(conn):
            conn.execute("""UPDATE tasks SET status='ready' WHERE status='todo' AND NOT EXISTS (
                SELECT 1 FROM task_links l JOIN tasks p ON p.id = l.parent_id WHERE l.child_id = tasks.id AND p.status NOT IN ('done','archived'))""")

        def create_task(conn, *, title, body=None, assignee=None, created_by=None, workspace_kind=None, workspace_path=None,
                        parents=(), idempotency_key=None, max_runtime_seconds=None, model_override=None, provider_override=None,
                        initial_status="running", board=None, **_):
            if not title or not title.strip():
                raise ValueError("title is required")
            if idempotency_key:
                row = conn.execute("SELECT id FROM tasks WHERE idempotency_key = ? AND status != 'archived'", (idempotency_key,)).fetchone()
                if row:
                    return row[0]
            n = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
            if fake.fail_after is not None and n >= fake.fail_after:
                raise RuntimeError("simulated failure in the middle")
            fake.counter += 1
            tid = f"t_{fake.counter:08x}"
            gating = [p for p in parents if conn.execute("SELECT status FROM tasks WHERE id=?", (p,)).fetchone()[0] != "done"]
            status = "blocked" if initial_status == "blocked" else ("todo" if gating else "ready")
            with kbc.write_txn(conn, allow_nested=True):
                conn.execute("INSERT INTO tasks (id, title, body, assignee, status, created_by, created_at, idempotency_key, model_override,"
                             " provider_override, workspace_kind, workspace_path, max_runtime_seconds) VALUES (?,?,?,?,?,?,0,?,?,?,?,?,?)",
                             (tid, title.strip(), body, assignee.lower() if assignee else None, status, created_by, idempotency_key,
                              model_override, provider_override, workspace_kind or "scratch", workspace_path, max_runtime_seconds))
                for p in parents:
                    conn.execute("INSERT INTO task_links VALUES (?, ?)", (p, tid))
                conn.execute("INSERT INTO task_events (task_id, kind) VALUES (?, 'created')", (tid,))
            return tid

        def complete_task(conn, tid, *, result=None, **_):
            if not (result or "").strip():
                raise ValueError("empty completion")
            with kbc.write_txn(conn):
                parents = conn.execute("SELECT p.status FROM task_links l JOIN tasks p ON p.id = l.parent_id WHERE l.child_id=?", (tid,)).fetchall()
                if any(p[0] not in ("done", "archived") for p in parents):
                    return False
                cur = conn.execute("UPDATE tasks SET status='done' WHERE id=? AND status IN ('ready','blocked','review')", (tid,))
                if cur.rowcount != 1:
                    return False
                conn.execute("INSERT INTO task_runs (task_id, profile, worker_pid, claim_lock) VALUES (?, NULL, NULL, NULL)", (tid,))
                recompute_ready(conn)
            return True

        def archive_task(conn, tid, **_):
            with kbc.write_txn(conn):
                cur = conn.execute("UPDATE tasks SET status='archived' WHERE id=? AND status != 'archived'", (tid,))
                if cur.rowcount != 1:
                    return False
                recompute_ready(conn)
            return True

        def unblock_task(conn, tid):
            with kbc.write_txn(conn):
                cur = conn.execute("UPDATE tasks SET status='ready' WHERE id=? AND status IN ('blocked','scheduled')", (tid,))
                return cur.rowcount == 1

        kb.create_task, kb.complete_task, kb.archive_task, kb.unblock_task = create_task, complete_task, archive_task, unblock_task
        kb.add_comment = lambda conn, tid, author, body: conn.execute("INSERT INTO task_comments (task_id, author, body) VALUES (?,?,?)", (tid, author, body))

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
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
            except Exception:
                conn.execute("ROLLBACK")
                raise
            conn.execute("COMMIT")
            if fake.tamper:
                fake.tamper(conn)

        kbc.connect_closing, kbc.write_txn = connect_closing, write_txn

        boards = types.ModuleType("hermes_cli.kanban_db_boards")
        boards.list_boards = lambda include_archived=True: [{"slug": s, **m} for s, m in fake.boards.items() if include_archived or not m["archived"]]

        def create_board(slug, *, name=None, **_):
            fake.make_board(slug)
            fake.boards[slug]["name"] = name
            return {"slug": slug}

        def remove_board(slug, *, archive=True):
            fake.boards[slug]["archived"] = True
            return {"slug": slug, "action": "archived"}

        boards.create_board, boards.remove_board = create_board, remove_board
        pkg = types.ModuleType("hermes_cli")
        pkg.kanban_db, pkg.kanban_db_connect, pkg.kanban_db_boards = kb, kbc, boards
        return {"hermes_cli": pkg, "hermes_cli.kanban_db": kb, "hermes_cli.kanban_db_connect": kbc, "hermes_cli.kanban_db_boards": boards}


@pytest.fixture
def world(tmp_path, monkeypatch):
    fake = FakeKanban(tmp_path)
    for name, module in fake.modules().items():
        monkeypatch.setitem(sys.modules, name, module)
    mod = _router_module()
    app = FastAPI()
    app.include_router(mod.router, prefix=BASE)
    audit, orders, campaign = _m("audit"), _m("orders"), _m("campaign")
    monkeypatch.setattr(audit, "data_dir", lambda: tmp_path / "plugin-data")
    monkeypatch.setattr(campaign, "_roster", lambda: set(BOTS))
    orders.reset()
    fake.make_board("sandbox")
    fake.make_board("withdir", workdir="/work/project")
    fake.make_board("tomb", archived=True)
    client = TestClient(app)
    client.fake, client.audit_dir = fake, tmp_path / "plugin-data"
    yield client
    orders.reset()


def uid():
    return str(uuid.uuid4())


def card(ref, phase=0, parents=(), assignee="alpha", **kw):
    return {"ref": ref, "kind": "card", "phase": phase, "title": f"Card {ref}", "assignee": assignee, "parents": list(parents), **kw}


def guard(ref, phase=0, parents=()):
    return {"ref": ref, "kind": "guard", "phase": phase, "parents": list(parents)}


def graph8():
    """8 cards, 2 guards (the acceptance shape): head guard, a chain with a review, a phase guard, 2 cards after it."""
    return {"phases": [{"name": "Build"}, {"name": "Ship"}],
            "cards": [guard("g0"), card("a1", parents=["g0"]), card("a2", parents=["a1"], assignee="bravo", model="m-x", provider="p-y"),
                      card("a3", parents=["g0"], assignee="charlie", body="Do the thing.\nTwice."),
                      guard("g1", 1, ["a2", "a3"]), card("b1", 1, ["g1"]), card("b2", 1, ["b1"], assignee="bravo")]}


def body(extra=None, board="sandbox", cid=None, **over):
    out = {"id": cid or uid(), "goal": "Ship the thing", **graph8()}
    out.update({"board": board} if board else {})
    out.update(extra or {})
    out.update(over)
    return out


def post(client, payload):
    return client.post(f"{BASE}/campaign", json=payload)


def journal(client):
    path = client.audit_dir / "audit.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def order(client, verb, board, task, oid=None):
    return client.post(f"{BASE}/orders", json={"id": oid or uid(), "verb": verb, "board": board, "task": task})


# ------------------------------------------------------------------ a valid graph

def test_a_valid_graph_is_written_in_one_go_and_read_back_identical(world):
    r = post(world, body())
    out = r.json()
    assert r.status_code == 200 and out["ok"] is True and out["result"] == "done" and out["risk"] == "final"
    assert out["created"] == 7 and out["links"] == 7 and len(out["guards"]) == 2 and len(out["cards"]) == 5
    assert out["after"] == {"blocked": 2, "todo": 5, "ready": 0, "running": 0}
    assert world.fake.by_status("sandbox") == {"blocked": 2, "todo": 5}
    rows = {r["id"]: r for r in world.fake.rows("sandbox", "SELECT * FROM tasks")}
    ref = {c["ref"]: c["task"] for c in out["guards"] + out["cards"]}
    assert rows[ref["a2"]]["assignee"] == "bravo" and rows[ref["a2"]]["model_override"] == "m-x" and rows[ref["a2"]]["provider_override"] == "p-y"
    assert rows[ref["a3"]]["body"] == "Do the thing.\nTwice."
    assert rows[ref["g0"]]["assignee"] is None and rows[ref["g1"]]["assignee"] is None and rows[ref["g0"]]["status"] == "blocked"
    assert rows[ref["g0"]]["title"] == "Guard — Ship the thing" and rows[ref["g1"]]["title"] == "Guard phase B — Ship"
    assert rows[ref["g0"]]["body"] == rows[ref["g1"]]["body"] == 'Officecraft guard card: nothing starts until you press "Launch". Do not unblock it.'
    assert all(r["created_by"] == "officecraft" for r in rows.values())
    links = {(r["parent_id"], r["child_id"]) for r in world.fake.rows("sandbox", "SELECT * FROM task_links")}
    assert links == {(ref[p], ref[c]) for p, c in [("g0", "a1"), ("a1", "a2"), ("g0", "a3"), ("a2", "g1"), ("a3", "g1"), ("g1", "b1"), ("b1", "b2")]}
    # nothing started: no run, no claim
    assert world.fake.rows("sandbox", "SELECT COUNT(*) AS n FROM task_runs")[0]["n"] == 0
    assert world.fake.rows("sandbox", "SELECT COUNT(*) AS n FROM tasks WHERE claim_lock IS NOT NULL OR worker_pid IS NOT NULL")[0]["n"] == 0
    assert rows[ref["g0"]]["idempotency_key"].endswith(":G0") and rows[ref["g1"]]["idempotency_key"].endswith(":G1")


def test_the_largest_graph_is_accepted(world):
    cards = [guard("g")] + [card(f"c{i}", parents=["g"]) for i in range(40)]
    out = post(world, body(phases=[{"name": "P"}], cards=cards)).json()
    assert out["result"] == "done" and out["created"] == 41 and out["after"]["todo"] == 40


# ------------------------------------------------------------------ the graph is refused before anything is written

def refused(world, reason, **over):
    r = post(world, body(**over))
    out = r.json()
    assert r.status_code == 200 and out["result"] == "refused" and out["reason"] == reason and out["ok"] is False, out
    assert world.fake.rows("sandbox", "SELECT COUNT(*) AS n FROM tasks")[0]["n"] == 0
    return out


def test_too_many_cards(world):
    cards = [guard("g")] + [card(f"c{i}", parents=["g"]) for i in range(41)]
    refused(world, "too_many_cards", phases=[{"name": "P"}], cards=cards)


def test_a_loop_is_refused(world):
    cards = [guard("g"), card("a", parents=["g", "b"]), card("b", parents=["a"])]
    refused(world, "cycle", phases=[{"name": "P"}], cards=cards)
    refused(world, "cycle", phases=[{"name": "P"}], cards=[guard("g"), card("a", parents=["g", "a"])])   # its own parent


def test_unknown_bot(world):
    cards = [guard("g"), card("a", parents=["g"], assignee="nobody")]
    refused(world, "unknown_profile", phases=[{"name": "P"}], cards=cards)


def test_unknown_and_archived_boards(world):
    assert refused_board(world, "nowhere") == "unknown_board"
    assert refused_board(world, "tomb") == "archived_board"


def refused_board(world, slug):
    out = post(world, body(board=slug)).json()
    assert out["result"] == "refused" and out["ok"] is False
    return out["reason"]


def test_a_graph_needs_exactly_one_head_guard(world):
    refused(world, "no_head_guard", phases=[{"name": "P"}], cards=[card("a")])
    refused(world, "no_head_guard", phases=[{"name": "P"}], cards=[guard("g"), guard("h"), card("a", parents=["g"])])
    refused(world, "no_head_guard", phases=[{"name": "P"}], cards=[card("a"), guard("g", 0, ["a"])])   # the head waits for nothing


def test_a_card_that_could_start_at_creation_is_refused(world):
    refused(world, "unguarded", phases=[{"name": "P"}], cards=[guard("g"), card("a", parents=["g"]), card("free")])
    # a phase guard that the cards of its phase do not wait for
    g = graph8()
    g["cards"][5] = card("b1", 1, [])
    refused(world, "unguarded", **g)


def test_parents_must_exist_and_never_come_from_a_later_phase(world):
    refused(world, "bad_parent", phases=[{"name": "P"}], cards=[guard("g"), card("a", parents=["g", "ghost"])])
    g = graph8()
    g["cards"][1] = card("a1", 0, ["g0", "b2"])   # waits for a card of phase 1
    refused(world, "bad_parent", **g)


def test_a_phase_guard_waits_for_the_last_cards_of_the_phase_before(world):
    g = graph8()
    g["cards"][4] = guard("g1", 1, ["a2"])   # a3 ends phase 0 too
    refused(world, "bad_parent", **g)
    g = graph8()
    g["cards"][4] = guard("g1", 1, ["a1", "a2", "a3"])   # a1 is no end: a2 waits for it
    refused(world, "bad_parent", **g)


def test_two_guards_in_one_phase(world):
    g = graph8()
    g["cards"].append(guard("g1b", 1, ["a2", "a3"]))
    refused(world, "bad_guard", **g)


def test_workspace_dir_needs_the_default_workdir_of_the_board(world):
    cards = [guard("g"), card("a", parents=["g"], workspace="dir")]
    refused(world, "no_workdir", phases=[{"name": "P"}], cards=cards)
    out = post(world, body(board="withdir", phases=[{"name": "P"}], cards=cards)).json()
    assert out["result"] == "done"
    row = world.fake.rows("withdir", "SELECT workspace_kind, workspace_path FROM tasks WHERE assignee = 'alpha'")[0]
    assert (row["workspace_kind"], row["workspace_path"]) == ("dir", "/work/project")


# ------------------------------------------------------------------ the shape of the request (422, never an echo)

SECRET = "never-echo-this-1234"


@pytest.mark.parametrize("patch", [
    {"extra": "x"},                                                 # a field that does not exist
    {"board": None},                                                # neither board nor newBoard
    {"newBoard": {"slug": "fresh", "name": "Fresh"}},               # both
    {"id": "not-a-uuid"},
    {"goal": ""}, {"goal": "g" * 121},
    {"phases": []}, {"phases": [{"name": "p"}] * 9},
    {"cards": []},
])
def test_shape_errors_are_422(world, patch):
    payload = body()
    payload.update(patch)
    payload = {k: v for k, v in payload.items() if v is not None}
    r = post(world, payload)
    assert r.status_code == 422


def test_text_bounds_and_closed_fields_of_the_cards(world):
    def with_card(**kw):
        g = graph8()
        g["cards"][1] = {**g["cards"][1], **kw}
        return post(world, body(**g)).status_code
    assert with_card() == 200
    assert with_card(body="x" * 8001) == 422
    assert with_card(title="t" * 121) == 422
    assert with_card(title=" ") == 422
    assert with_card(title="bad\x00title") == 422
    assert with_card(body="bad\x1bbody") == 422
    assert with_card(model="only-a-model", provider=None) == 422
    assert with_card(model="has space", provider="p") == 422
    assert with_card(maxRuntime=10) == 422 and with_card(maxRuntime=90_000) == 422
    assert with_card(workspace="worktree") == 422
    assert with_card(surprise=1) == 422
    assert with_card(ref="G1") == 422                      # the refs of the guards are theirs
    assert with_card(assignee=None) == 422
    assert with_card(phase=5) == 422                       # unknown phase
    assert with_card(parents=["g0", "g0"]) == 422
    assert world.fake.rows("sandbox", "SELECT COUNT(*) AS n FROM tasks WHERE title = 'x'")[0]["n"] == 0


def test_a_guard_carries_nothing_but_its_place(world):
    g = graph8()
    g["cards"][0] = {**g["cards"][0], "assignee": "alpha"}
    assert post(world, body(**g)).status_code == 422
    g = graph8()
    g["cards"][0] = {**g["cards"][0], "title": "mine"}
    assert post(world, body(**g)).status_code == 422


def test_duplicate_refs_are_422(world):
    g = graph8()
    g["cards"].append(card("a1", parents=["g0"]))
    assert post(world, body(**g)).status_code == 422


def test_a_422_never_echoes_the_input(world):
    r = post(world, body(goal=SECRET + "\x00"))
    assert r.status_code == 422 and SECRET not in r.text


def test_the_body_is_bounded(world):
    r = world.post(f"{BASE}/campaign", content=b"{" + b" " * (260 * 1024) + b"}", headers={"content-type": "application/json"})
    assert r.status_code == 413


# ------------------------------------------------------------------ a failure in the middle: nothing is left

def test_a_failure_in_the_middle_leaves_no_card(world):
    world.fake.fail_after = 3
    out = post(world, body()).json()
    assert out["result"] == "failed" and out["reason"] == "hermes_error" and out["ok"] is False and out["created"] == 0
    assert world.fake.rows("sandbox", "SELECT COUNT(*) AS n FROM tasks")[0]["n"] == 0
    assert world.fake.rows("sandbox", "SELECT COUNT(*) AS n FROM task_events")[0]["n"] == 0
    assert world.fake.rows("sandbox", "SELECT COUNT(*) AS n FROM task_links")[0]["n"] == 0
    line = journal(world)[-1]
    assert (line["verb"], line["result"], line["reason"], line["created"]) == ("campaign", "failed", "hermes_error", 0)


def tamper_assignee(conn):
    conn.execute("UPDATE tasks SET assignee='bravo' WHERE title = 'Card a1'")


def test_a_readback_that_differs_archives_every_card_leaves_first_and_guard_last(world):
    world.fake.tamper = tamper_assignee
    out = post(world, body()).json()
    assert out["result"] == "failed" and out["reason"] == "readback_mismatch" and out["archived"] == 7 and out["ok"] is False
    assert world.fake.by_status("sandbox") == {"archived": 7}
    # the order of the archiving: no card is archived while one of its children is not
    rows = {r["id"]: r for r in world.fake.rows("sandbox", "SELECT id FROM tasks")}
    assert len(rows) == 7
    assert journal(world)[-1]["archived"] == 7


def test_leaves_first_never_frees_a_child(world):
    """Archiving a parent frees its children (Hermes): the order is the only protection, and it is checked in the log."""
    seen = []
    kb = sys.modules["hermes_cli.kanban_db"]
    real = kb.archive_task

    def spy(conn, tid, **kw):
        seen.append((tid, conn.execute("SELECT COUNT(*) FROM task_links l JOIN tasks c ON c.id = l.child_id WHERE l.parent_id = ? AND c.status != 'archived'", (tid,)).fetchone()[0]))
        return real(conn, tid, **kw)

    kb.archive_task = spy
    world.fake.tamper = tamper_assignee
    post(world, body())
    assert len(seen) == 7 and all(n == 0 for _, n in seen)
    assert world.fake.by_status("sandbox") == {"archived": 7}


def test_a_readback_catches_a_card_that_started(world):
    world.fake.tamper = lambda conn: conn.execute("INSERT INTO task_runs (task_id, profile) SELECT id, 'alpha' FROM tasks WHERE title = 'Card a1'")
    out = post(world, body()).json()
    assert out["reason"] == "readback_mismatch" and world.fake.by_status("sandbox") == {"archived": 7}


def test_a_readback_catches_a_missing_link(world):
    world.fake.tamper = lambda conn: conn.execute("DELETE FROM task_links WHERE rowid = (SELECT MIN(rowid) FROM task_links)")
    assert post(world, body()).json()["reason"] == "readback_mismatch"


# ------------------------------------------------------------------ a new board

def test_a_new_board_is_created_with_the_campaign(world):
    out = post(world, body(board=None, newBoard={"slug": "oc-campaign-test-1", "name": "Test one"})).json()
    assert out["result"] == "done" and out["boardCreated"] is True and out["board"] == "oc-campaign-test-1" and "boardArchived" not in out
    assert world.fake.boards["oc-campaign-test-1"]["name"] == "Test one" and not world.fake.boards["oc-campaign-test-1"]["archived"]
    assert world.fake.by_status("oc-campaign-test-1") == {"blocked": 2, "todo": 5}
    line = journal(world)[-1]
    assert line["board"] == "oc-campaign-test-1" and line["boardCreated"] is True


def test_a_new_board_is_archived_when_the_campaign_fails(world):
    world.fake.fail_after = 2
    out = post(world, body(board=None, newBoard={"slug": "oc-campaign-test-2", "name": "Two"})).json()
    assert out["result"] == "failed" and out["boardCreated"] is True and out["boardArchived"] is True
    assert world.fake.boards["oc-campaign-test-2"]["archived"] is True
    line = journal(world)[-1]
    assert line["boardCreated"] is True and line["boardArchived"] is True


def test_a_new_board_is_archived_after_a_readback_mismatch(world):
    world.fake.tamper = tamper_assignee
    out = post(world, body(board=None, newBoard={"slug": "oc-campaign-test-3", "name": "Three"})).json()
    assert out["reason"] == "readback_mismatch" and out["archived"] == 7 and out["boardArchived"] is True


@pytest.mark.parametrize("slug", ["Bad Slug", "../x", "-lead", "a" * 65, "UPPER"])
def test_a_bad_slug_is_refused_and_nothing_is_created(world, slug):
    out = post(world, body(board=None, newBoard={"slug": slug, "name": "N"})).json()
    assert out["result"] == "refused" and out["reason"] == "bad_slug"
    assert set(world.fake.boards) == {"default", "sandbox", "withdir", "tomb"}


@pytest.mark.parametrize("slug", ["sandbox", "tomb", "default"])
def test_a_taken_slug_is_refused_even_archived(world, slug):
    out = post(world, body(board=None, newBoard={"slug": slug, "name": "N"})).json()
    assert out["result"] == "refused" and out["reason"] == "board_exists"


def test_a_new_board_has_no_workdir(world):
    cards = [guard("g"), card("a", parents=["g"], workspace="dir")]
    out = post(world, body(board=None, newBoard={"slug": "fresh", "name": "N"}, phases=[{"name": "P"}], cards=cards)).json()
    assert out["reason"] == "no_workdir" and "fresh" not in world.fake.boards


def test_a_refusal_after_the_board_check_does_not_create_the_board(world):
    cards = [guard("g"), card("a", parents=["g"], assignee="nobody")]
    out = post(world, body(board=None, newBoard={"slug": "fresh", "name": "N"}, phases=[{"name": "P"}], cards=cards)).json()
    assert out["reason"] == "unknown_profile" and "fresh" not in world.fake.boards


# ------------------------------------------------------------------ replay, busy, journal

def test_replay_by_id_does_nothing_twice(world):
    payload = body()
    first = post(world, payload).json()
    again = post(world, payload)
    assert again.status_code == 200 and again.json()["replayed"] is True and again.json()["cards"] == first["cards"]
    assert world.fake.by_status("sandbox") == {"blocked": 2, "todo": 5}
    assert len(journal(world)) == 1


def test_the_same_id_for_another_campaign_is_a_conflict(world):
    payload = body()
    post(world, payload)
    other = body(cid=payload["id"], board="withdir")
    r = post(world, other)
    assert r.status_code == 409 and r.json()["reason"] == "id_conflict"
    assert world.fake.by_status("withdir") == {}


def test_a_replay_survives_a_restart_through_the_journal(world):
    payload = body()
    post(world, payload)
    _m("orders").reset()   # a new process: the table is empty, the journal is read
    again = post(world, payload).json()
    assert again["replayed"] is True and again["result"] == "done" and again["created"] == 7
    assert world.fake.by_status("sandbox") == {"blocked": 2, "todo": 5}


def test_an_id_that_already_built_a_graph_on_the_board_is_refused(world):
    payload = body()
    post(world, payload)
    _m("orders").reset()
    _m("audit").data_dir = lambda: world.audit_dir / "elsewhere"   # a lost journal: only the cards remember
    out = post(world, payload).json()
    assert out["result"] == "refused" and out["reason"] == "already_created"
    assert world.fake.by_status("sandbox") == {"blocked": 2, "todo": 5}


def test_busy_while_another_order_runs(world):
    lock = _m("orders")._run_lock
    lock.acquire()
    try:
        r = post(world, body())
    finally:
        lock.release()
    assert r.status_code == 409 and r.json()["result"] == "busy"
    assert world.fake.by_status("sandbox") == {}


def test_the_journal_line_carries_counts_and_codes_only(world):
    secret = "SECRET-INSTRUCTION-9f3"
    g = graph8()
    g["cards"][1] = {**g["cards"][1], "body": secret, "title": "SECRET-TITLE-9f3", "model": "SECRET-MODEL-9f3", "provider": "p"}
    payload = body(goal="SECRET-GOAL-9f3", board=None, newBoard={"slug": "secret-board", "name": "SECRET-NAME-9f3"}, phases=[{"name": "SECRET-PHASE-9f3"}, {"name": "x"}], cards=g["cards"])
    out = post(world, payload).json()
    assert out["result"] == "done"
    raw = (world.audit_dir / "audit.jsonl").read_text()
    assert "9f3" not in raw
    line = json.loads(raw.splitlines()[-1])
    assert set(line) == {"ts", "id", "verb", "risk", "board", "result", "created", "links", "guards", "boardCreated", "source"}
    assert (line["verb"], line["risk"], line["created"], line["links"], line["guards"], line["source"]) == ("campaign", "final", 7, 7, 2, "agent")
    # and GET /orders serves the same, nothing more
    served = world.get(f"{BASE}/orders?limit=5").json()["entries"][0]
    assert "9f3" not in json.dumps(served) and served["verb"] == "campaign"


def test_audit_whitelist_drops_what_it_does_not_know():
    audit = _m("audit")
    line = audit.clean({"id": "x", "verb": "campaign", "created": 7, "links": True, "guards": -1, "archived": 10_000, "boardCreated": "yes",
                        "boardArchived": False, "goal": "secret", "title": "secret", "cards": [1]})
    assert line == {"id": "x", "verb": "campaign", "created": 7, "boardArchived": False}


def test_health_announces_the_campaign(world):
    caps = world.get(f"{BASE}/health").json()["capabilities"]
    assert {"campaign", "launch", "cancel_campaign"} <= set(caps)


# ------------------------------------------------------------------ launch

def make(world, **over):
    out = post(world, body(**over)).json()
    assert out["result"] == "done", out
    return {c["ref"]: c["task"] for c in out["guards"] + out["cards"]}


def test_launch_completes_the_head_guard_and_frees_its_cards(world):
    ref = make(world)
    r = order(world, "launch", "sandbox", ref["g0"])
    out = r.json()
    assert r.status_code == 200 and out["result"] == "done" and out["risk"] == "final" and out["before"] == {"status": "blocked"}
    assert out["after"] == {"status": "done", "ready": 2}
    status = {r["id"]: r["status"] for r in world.fake.rows("sandbox", "SELECT id, status FROM tasks")}
    assert status[ref["g0"]] == "done" and status[ref["a1"]] == "ready" and status[ref["a3"]] == "ready"
    assert status[ref["a2"]] == "todo" and status[ref["g1"]] == "blocked" and status[ref["b1"]] == "todo"
    # the synthetic run of the completion belongs to nobody
    runs = world.fake.rows("sandbox", "SELECT profile, worker_pid FROM task_runs")
    assert runs == [{"profile": None, "worker_pid": None}]
    line = journal(world)[-1]
    assert (line["verb"], line["result"], line["risk"]) == ("launch", "done", "final") and line["after"] == {"status": "done"}


def test_a_phase_is_refused_until_the_phase_before_is_finished(world):
    ref = make(world)
    order(world, "launch", "sandbox", ref["g0"])
    out = order(world, "launch", "sandbox", ref["g1"]).json()
    assert out["result"] == "refused" and out["reason"] == "phase_not_done" and out["after"] == {"status": "blocked"}
    assert world.fake.rows("sandbox", "SELECT status FROM tasks WHERE id = ?", ref["g1"])[0]["status"] == "blocked"
    for name in ("a1", "a2", "a3"):   # the cards of phase A finish
        world.fake.exec("sandbox", "UPDATE tasks SET status='done' WHERE id=?", ref[name])
    out = order(world, "launch", "sandbox", ref["g1"]).json()
    assert out["result"] == "done" and out["after"] == {"status": "done", "ready": 1}
    assert world.fake.rows("sandbox", "SELECT status FROM tasks WHERE id = ?", ref["b1"])[0]["status"] == "ready"


def test_the_phase_guard_cannot_be_launched_before_the_head_guard(world):
    ref = make(world)
    out = order(world, "launch", "sandbox", ref["g1"]).json()
    assert out["result"] == "refused" and out["reason"] == "phase_not_done"
    assert world.fake.by_status("sandbox") == {"blocked": 2, "todo": 5}


def test_a_phase_after_an_empty_phase_still_waits_for_the_head_guard(world):
    # phase B has no work card: the guard of phase C would wait for nothing and could be launched before the head guard
    cards = [guard("g0"), card("a1", 0, ["g0"]), guard("g1", 1, ["a1"]), guard("g2", 2, []), card("c1", 2, ["g2"])]
    refused(world, "unguarded", phases=[{"name": "A"}, {"name": "B"}, {"name": "C"}], cards=cards)


def test_launch_refuses_what_is_not_a_guard_or_not_blocked(world):
    ref = make(world)
    assert order(world, "launch", "sandbox", ref["a1"]).json()["reason"] == "not_a_guard"
    world.fake.exec("sandbox", "INSERT INTO tasks (id, status, title) VALUES ('t_000000aa', 'blocked', 'plain')")
    assert order(world, "launch", "sandbox", "t_000000aa").json()["reason"] == "not_a_guard"
    # a card that carries a guard's key and a bot is not a guard
    world.fake.exec("sandbox", "UPDATE tasks SET assignee='alpha' WHERE id=?", ref["g1"])
    assert order(world, "launch", "sandbox", ref["g1"]).json()["reason"] == "not_a_guard"
    assert order(world, "launch", "sandbox", "t_deadbeef").json()["reason"] == "unknown_task"
    order(world, "launch", "sandbox", ref["g0"])
    again = order(world, "launch", "sandbox", ref["g0"]).json()
    assert again["result"] == "refused" and again["reason"] in ("not_blocked", "archived_task") and again["before"] == {"status": "done"}


def test_unblock_is_refused_on_a_guard_and_nothing_moves(world):
    ref = make(world)
    out = order(world, "unblock", "sandbox", ref["g0"]).json()
    assert out["result"] == "refused" and out["reason"] == "guard"
    assert world.fake.rows("sandbox", "SELECT status FROM tasks WHERE id = ?", ref["g0"])[0]["status"] == "blocked"
    assert world.fake.by_status("sandbox") == {"blocked": 2, "todo": 5}
    # a plain blocked card is still unblocked as before
    world.fake.exec("sandbox", "INSERT INTO tasks (id, status, title) VALUES ('t_000000bb', 'blocked', 'plain')")
    assert order(world, "unblock", "sandbox", "t_000000bb").json()["result"] == "done"


def test_launch_replay_does_nothing_twice(world):
    ref = make(world)
    oid = uid()
    first = order(world, "launch", "sandbox", ref["g0"], oid=oid).json()
    again = order(world, "launch", "sandbox", ref["g0"], oid=oid).json()
    assert first["result"] == "done" and again["replayed"] is True and again["result"] == "done"
    assert len(world.fake.rows("sandbox", "SELECT * FROM task_runs")) == 1


# ------------------------------------------------------------------ cancel

def test_cancel_archives_the_leaves_first_and_the_head_guard_last(world):
    ref = make(world)
    seen = []
    kb = sys.modules["hermes_cli.kanban_db"]
    real = kb.archive_task

    def spy(conn, tid, **kw):
        seen.append(tid)
        # whatever is archived, nothing may be `ready` between two archivings
        assert conn.execute("SELECT COUNT(*) FROM tasks WHERE status = 'ready'").fetchone()[0] == 0
        return real(conn, tid, **kw)

    kb.archive_task = spy
    r = order(world, "cancel_campaign", "sandbox", ref["g0"])
    out = r.json()
    assert r.status_code == 200 and out["result"] == "done" and out["risk"] == "final"
    assert out["after"] == {"status": "archived", "archived": 7, "ready": 0, "running": 0}
    assert world.fake.by_status("sandbox") == {"archived": 7}
    assert seen[-1] == ref["g0"] and len(seen) == 7
    assert seen.index(ref["b2"]) < seen.index(ref["b1"]) < seen.index(ref["g1"]) < seen.index(ref["a2"]) < seen.index(ref["a1"]) < seen.index(ref["g0"])
    assert world.fake.rows("sandbox", "SELECT COUNT(*) AS n FROM task_runs")[0]["n"] == 0
    assert world.fake.boards["sandbox"]["archived"] is False   # never the board
    line = journal(world)[-1]
    assert (line["verb"], line["result"], line["archived"]) == ("cancel_campaign", "done", 7)


def test_cancel_is_refused_once_launched(world):
    ref = make(world)
    order(world, "launch", "sandbox", ref["g0"])
    out = order(world, "cancel_campaign", "sandbox", ref["g0"]).json()
    assert out["result"] == "refused" and out["reason"] == "launched"
    assert world.fake.by_status("sandbox") == {"done": 1, "ready": 2, "blocked": 1, "todo": 3}


@pytest.mark.parametrize("status", ["running", "ready"])   # `ready` too: a card freed behind a blocked head (moved by hand) is not touched
def test_cancel_is_refused_when_a_card_of_the_campaign_started(world, status):
    ref = make(world)
    world.fake.exec("sandbox", f"UPDATE tasks SET status='{status}' WHERE id=?", ref["a1"])
    out = order(world, "cancel_campaign", "sandbox", ref["g0"]).json()
    assert out["result"] == "refused" and out["reason"] == "launched"
    assert world.fake.by_status("sandbox") == {"blocked": 2, "todo": 4, status: 1}


def test_cancel_needs_the_head_guard(world):
    ref = make(world)
    assert order(world, "cancel_campaign", "sandbox", ref["g1"]).json()["reason"] == "not_a_guard"
    assert order(world, "cancel_campaign", "sandbox", ref["a1"]).json()["reason"] == "not_a_guard"
    assert world.fake.by_status("sandbox") == {"blocked": 2, "todo": 5}


def test_cancel_only_touches_its_own_campaign(world):
    one, two = make(world), make(world)
    assert order(world, "cancel_campaign", "sandbox", one["g0"]).json()["result"] == "done"
    assert world.fake.by_status("sandbox") == {"archived": 7, "blocked": 2, "todo": 5}
    assert world.fake.rows("sandbox", "SELECT status FROM tasks WHERE id = ?", two["g0"])[0]["status"] == "blocked"


def test_cancel_stops_when_a_card_becomes_ready(world):
    ref = make(world)
    kb = sys.modules["hermes_cli.kanban_db"]
    real = kb.archive_task

    def promoting(conn, tid, **kw):
        ok = real(conn, tid, **kw)
        conn.execute("UPDATE tasks SET status='ready' WHERE id=?", (ref["a1"],))   # Hermes' promotion, simulated
        return ok

    kb.archive_task = promoting
    out = order(world, "cancel_campaign", "sandbox", ref["g0"]).json()
    assert out["result"] == "failed" and out["reason"] == "partial" and out["after"]["ready"] == 1 and out["after"]["archived"] < 7


def test_cancel_replay(world):
    ref = make(world)
    oid = uid()
    assert order(world, "cancel_campaign", "sandbox", ref["g0"], oid=oid).json()["result"] == "done"
    assert order(world, "cancel_campaign", "sandbox", ref["g0"], oid=oid).json()["replayed"] is True


# ------------------------------------------------------------------ campaigns written with the earlier French guard texts

OLD_GUARD_BODY = "Carte-garde d'Officecraft : rien ne part avant « Lancer ». Ne pas débloquer."


def _as_written_before(world, ref):
    """The guards of this campaign as an earlier version wrote them: French titles and body."""
    world.fake.exec("sandbox", "UPDATE tasks SET title = ?, body = ? WHERE id = ?", "Garde — Ship the thing", OLD_GUARD_BODY, ref["g0"])
    world.fake.exec("sandbox", "UPDATE tasks SET title = ?, body = ? WHERE id = ?", "Garde phase B — Ship", OLD_GUARD_BODY, ref["g1"])


@pytest.mark.parametrize("old", [False, True])
def test_a_guard_is_read_launched_and_protected_whatever_the_language_of_its_texts(world, old):
    ref = make(world)
    if old:
        _as_written_before(world, ref)
    snapshot = _m("snapshot")
    by_id = {t["id"]: t for t in snapshot.read_board(world.fake.path("sandbox"), "sandbox")["tasks"]}
    assert by_id[ref["g0"]]["guard"] is True and by_id[ref["g0"]]["head"] is True and by_id[ref["g0"]]["campaignSize"] == 7
    assert by_id[ref["g1"]]["guard"] is True and by_id[ref["g1"]]["head"] is False
    (camp,) = snapshot.read_notify_extras(world.fake.path("sandbox"), "sandbox")["campaigns"]
    assert camp["name"] == "Ship the thing" and [(p["phase"], p["name"]) for p in camp["phases"]] == [(0, "")]
    out = order(world, "unblock", "sandbox", ref["g0"]).json()
    assert out["result"] == "refused" and out["reason"] == "guard"
    out = order(world, "launch", "sandbox", ref["g0"]).json()
    assert out["result"] == "done" and out["after"] == {"status": "done", "ready": 2}
    for name in ("a1", "a2", "a3"):
        world.fake.exec("sandbox", "UPDATE tasks SET status='done' WHERE id=?", ref[name])
    (camp,) = snapshot.read_notify_extras(world.fake.path("sandbox"), "sandbox")["campaigns"]
    assert [(p["phase"], p["name"]) for p in camp["phases"]] == [(1, "Ship")]
    out = order(world, "launch", "sandbox", ref["g1"]).json()
    assert out["result"] == "done" and out["after"] == {"status": "done", "ready": 1}


@pytest.mark.parametrize("old", [False, True])
def test_a_campaign_is_cancelled_whatever_the_language_of_its_guard_texts(world, old):
    ref = make(world)
    if old:
        _as_written_before(world, ref)
    out = order(world, "cancel_campaign", "sandbox", ref["g0"]).json()
    assert out["result"] == "done" and out["after"] == {"status": "archived", "archived": 7, "ready": 0, "running": 0}
    assert world.fake.by_status("sandbox") == {"archived": 7}


# ------------------------------------------------------------------ the guards are marked in /live

def test_live_marks_the_guards(world):
    ref = make(world)
    snapshot = _m("snapshot")
    board = snapshot.read_board(world.fake.path("sandbox"), "sandbox")
    by_id = {t["id"]: t for t in board["tasks"]}
    head, phase, plain = by_id[ref["g0"]], by_id[ref["g1"]], by_id[ref["a1"]]
    assert head["guard"] is True and head["head"] is True and len(head["campaign"]) == 8 and head["campaignSize"] == 7
    assert phase["guard"] is True and phase["head"] is False and phase["campaign"] == head["campaign"] and "campaignSize" not in phase
    assert "guard" not in plain and "campaign" not in plain
    assert "idempotency_key" not in json.dumps(board) and "oc-camp" not in json.dumps(board)
    order(world, "cancel_campaign", "sandbox", ref["g0"])
    assert snapshot.read_board(world.fake.path("sandbox"), "sandbox")["tasks"] == []   # archived cards are not served


def test_the_two_key_rules_agree():
    campaign, snapshot = _m("campaign"), _m("snapshot")
    cid = str(uuid.uuid4())
    for key in (f"oc-camp:{cid}:G0", f"oc-camp:{cid}:G7", f"oc-camp:{cid}:G8", f"oc-camp:{cid}:a1", f"oc-camp:{cid}:g1", "oc-camp:x:G0",
                f"oc-camp:{cid}:G0\n", f"oc-camp:{cid}:", None):
        parsed = campaign.parse_key(key)
        guard = snapshot._campaign_guard({"idempotency_key": key, "assignee": None, "created_by": "officecraft"})
        assert (parsed is not None and parsed[1] is not None) == (guard is not None), key
        if guard:
            assert guard[1] == parsed[0] and guard[0]["head"] == (parsed[1] == 0)
    assert snapshot._campaign_guard({"idempotency_key": f"oc-camp:{cid}:G0", "assignee": "alpha", "created_by": "officecraft"}) is None


# ------------------------------------------------------------------ the graph rules, pure

def test_plan_graph_orders_parents_first_and_is_stable():
    campaign = _m("campaign")
    c = campaign.CampaignIn.model_validate({"id": uid(), "board": "b", "goal": "g", **graph8()})
    order_ = [x.ref for x in campaign.plan_graph(c)]
    assert set(order_) == {x.ref for x in c.cards} and len(order_) == 7
    for x in c.cards:
        assert all(order_.index(p) < order_.index(x.ref) for p in x.parents)
    # given in the worst order, the same result is reachable
    reverse = {"id": uid(), "board": "b", "goal": "g", "phases": graph8()["phases"], "cards": list(reversed(graph8()["cards"]))}
    c2 = campaign.CampaignIn.model_validate(reverse)
    order2 = [x.ref for x in campaign.plan_graph(c2)]
    for x in c2.cards:
        assert all(order2.index(p) < order2.index(x.ref) for p in x.parents)


def test_the_graph_is_never_mutated_by_the_request(world):
    payload = body()
    before = copy.deepcopy(payload)
    post(world, payload)
    assert payload == before
