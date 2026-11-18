"""Security of the campaign, agent half. FAKE kanban (``test_campaign.FakeKanban``); the same two
holes were first proven against the REAL ``hermes_cli.kanban_db`` in a throw-away home.

Hole 1: ``cancel_campaign`` archived the cards of a campaign while a card OUTSIDE it (another bot's card added later on
        the board, « deploy after the campaign ») depended on one of them. Hermes frees the children of an archived
        parent: that card went ``todo -> ready`` and the dispatcher would have started it at its next tick, while the
        answer said ``done`` / ``ready: 0`` (only the campaign's own cards were counted). The cancel is now refused
        (``linked``) and touches nothing while such a card exists.
Hole 2: a guard was recognised by its key shape and the absence of a bot only. Any agent can give a card that key
        (``kanban_create`` takes an ``idempotency_key``): its card showed as a « Campaign » guard in ``/live`` and
        « Launch » completed it, freeing the cards the agent hung under it. A guard is now also a card that Officecraft
        wrote (``created_by = "officecraft"``; Hermes' tool always writes the profile name there, never a caller value).
"""

import json
import uuid

from test_campaign import _m, make, order, world  # noqa: F401  (pytest fixture)


def _foreign(world, parent, **over):
    """A card created on the board by someone else, after the campaign, waiting for ``parent``."""
    kb = __import__("sys").modules["hermes_cli.kanban_db"]
    kbc = __import__("sys").modules["hermes_cli.kanban_db_connect"]
    with kbc.connect_closing(board="sandbox") as conn:
        return kb.create_task(conn, title="deploy after the campaign", assignee=over.get("assignee", "alpha"), created_by=over.get("created_by", "bravo"),
                              parents=[parent] if parent else [], idempotency_key=over.get("key"),
                              initial_status=over.get("initial_status", "running"), board="sandbox")


def _status(world, tid):
    return world.fake.rows("sandbox", "SELECT status FROM tasks WHERE id = ?", tid)[0]["status"]


# ------------------------------------------------------------------ hole 1

def test_cancel_never_frees_a_card_outside_the_campaign(world):
    ref = make(world)
    outside = _foreign(world, ref["b2"])
    assert _status(world, outside) == "todo"
    out = order(world, "cancel_campaign", "sandbox", ref["g0"]).json()
    assert out["result"] == "refused" and out["reason"] == "linked"
    assert _status(world, outside) == "todo"                                   # still waiting, never ready
    assert world.fake.by_status("sandbox") == {"blocked": 2, "todo": 6}        # nothing of the campaign was touched


def test_cancel_still_works_when_the_outside_child_is_archived(world):
    ref = make(world)
    outside = _foreign(world, ref["a1"])
    kb = __import__("sys").modules["hermes_cli.kanban_db"]
    kbc = __import__("sys").modules["hermes_cli.kanban_db_connect"]
    with kbc.connect_closing(board="sandbox") as conn:
        kb.archive_task(conn, outside)
    out = order(world, "cancel_campaign", "sandbox", ref["g0"]).json()
    assert out["result"] == "done" and out["after"]["archived"] == 7


def test_linked_is_a_known_reason():
    assert "linked" in _m("campaign").REASONS and "linked" in _m("orders").REASONS


# ------------------------------------------------------------------ hole 2

def _fake_guard(world):
    key = f"oc-camp:{uuid.uuid4()}:G0"
    fake = _foreign(world, None, created_by="bravo", key=key, initial_status="blocked", assignee=None)
    child = _foreign(world, fake)
    return fake, child


def test_a_card_with_a_guard_key_written_by_someone_else_is_not_a_guard(world):
    fake, child = _fake_guard(world)
    out = order(world, "launch", "sandbox", fake).json()
    assert out["result"] == "refused" and out["reason"] == "not_a_guard"
    assert _status(world, fake) == "blocked" and _status(world, child) == "todo"
    assert order(world, "cancel_campaign", "sandbox", fake).json()["reason"] == "not_a_guard"


def test_live_does_not_mark_a_forged_guard(world):
    fake, _ = _fake_guard(world)
    ref = make(world)
    board = _m("snapshot").read_board(world.fake.path("sandbox"), "sandbox")
    by_id = {t["id"]: t for t in board["tasks"]}
    assert "guard" not in by_id[fake] and "campaign" not in by_id[fake]
    assert by_id[ref["g0"]]["guard"] is True                                   # the real one still is
    assert "created_by" not in json.dumps(board) and "officecraft" not in json.dumps(board)   # read, never served
