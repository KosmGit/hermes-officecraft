"""Kanban orders: ``unblock`` and ``comment``, executed by Hermes' own ``kanban_db``.

The desktop half cannot reach the kanban routes (``ctx.rest`` is confined to this plugin's namespace), so the
agent half writes the card itself, with the rules the official kanban plugin applies: the board is explicit
(never the active one), known and not archived; the card belongs to THAT board's database. Every order:

* is validated strictly before anything is opened (``OrderIn``: closed fields, bounded text, ``t_xxxxxxxx`` ids);
* is decided on the status read IN the database at the moment of acting, never on what the page believes;
* is refused with a stable ``reason`` code (the page translates it) when the card is ``running`` (never an order
  on a running card), unknown, archived or not in the expected status;
* answers with the card RE-READ after the write (``after``), never the assumed state;
* is journaled (``audit.py``) whatever its outcome, and replayed without effect when its ``id`` was already
  handled (Hermes would write a second identical comment, so this is the only guard);
* runs alone: a second order while one is running gets ``busy`` (HTTP 409).

No file path and no SQL text is built from the input: the board slug goes through Hermes' normaliser and path
helpers, the card id only ever travels as a bound parameter. A comment text is passed to Hermes and forgotten:
it is neither logged nor journaled (its length only).
"""

import logging
import re
import threading
import time
from collections import OrderedDict
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from . import audit

log = logging.getLogger(__name__)

VERBS: tuple[str, ...] = ("unblock", "comment", "launch", "cancel_campaign")   # what /health `capabilities` advertises: exactly these (+ `campaign`, the route)
RISK = {"unblock": "final", "comment": "final", "launch": "final", "cancel_campaign": "final", "campaign": "final"}   # unblocking has no clean inverse once sent
AUTHOR = "officecraft"                             # the official plugin writes `dashboard`
MAX_TEXT = 4000
MAX_BODY_BYTES = 24 * 1024
REMEMBERED = 512
REASONS = ("unknown_board", "archived_board", "unknown_task", "not_blocked", "running", "archived_task",
           "empty_text", "hermes_error", "id_conflict",
           "guard", "not_a_guard", "phase_not_done", "launched", "partial", "linked")   # the guards of a campaign (campaign.py)

BOARD_RE = r"^[a-z0-9][a-z0-9_-]{0,63}$"
TASK_RE = r"^t_[0-9a-f]{8}$"
ID_RE = r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"   # a v4 UUID (`randomUuid` of the SDK)


class OrderIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)

    id: str = Field(pattern=ID_RE)
    verb: Literal["unblock", "comment", "launch", "cancel_campaign"]
    board: str = Field(pattern=BOARD_RE)
    task: str = Field(pattern=TASK_RE)
    text: Optional[str] = Field(default=None, max_length=MAX_TEXT)

    @model_validator(mode="after")
    def _text_only_for_comment(self):
        if self.verb == "comment" and self.text is None:
            raise ValueError("comment needs `text`")
        if self.verb != "comment" and self.text is not None:
            raise ValueError("only `comment` takes `text`")
        return self


class AuditIn(BaseModel):
    """An order the PAGE did (approval, recruitment, revision of a description): the journal line only, nothing is
    executed here. The same closed shape as ``recruit`` for a ``revise``: the bot (``profile``) and, at most, the LENGTH
    of the description written (``len``) — the text itself has no field and is refused (``extra="forbid"``)."""
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=ID_RE)
    verb: Literal["approval", "recruit", "revise"]
    risk: Literal["safe", "rev", "reversible", "final"]   # `rev` = the page's reversible class (a revise); `reversible` kept for old lines
    result: Literal["done", "refused", "failed"]
    reason: Optional[str] = Field(default=None, pattern=r"^[a-z][a-z0-9_]{0,63}$")
    board: Optional[str] = Field(default=None, pattern=BOARD_RE)
    task: Optional[str] = Field(default=None, pattern=TASK_RE)
    choice: Optional[Literal["deny", "once", "session", "always"]] = None
    profile: Optional[str] = Field(default=None, pattern=BOARD_RE)   # same shape as a profile name
    request: Optional[str] = Field(default=None, pattern=r"^[A-Za-z0-9_-]{8,128}$")   # the Hermes request the page saw and answered
    len: Optional[int] = Field(default=None, ge=0, le=1_000_000)   # the length of a description written, never the text (like a comment)
    before: Optional[dict] = None
    after: Optional[dict] = None

    @model_validator(mode="after")
    def _len_only_for_revise(self):
        if self.len is not None and self.verb != "revise":
            raise ValueError("only `revise` takes `len`")
        return self


_run_lock = threading.Lock()          # one order at a time on the server
_state_lock = threading.Lock()
_seen: "OrderedDict[str, dict]" = OrderedDict()   # id -> the answer given (without `replayed`)
_journal_loaded = False


def reset() -> None:
    """Forget the in-memory replay table (tests, and nothing else)."""
    global _journal_loaded
    with _state_lock:
        _seen.clear()
        _journal_loaded = False


def _remember(answer: dict) -> None:
    with _state_lock:
        _seen[answer["id"]] = answer
        _seen.move_to_end(answer["id"])
        while len(_seen) > REMEMBERED:
            _seen.popitem(last=False)


def _answer_from_journal(entry: dict) -> dict:
    result = entry.get("result", "failed")
    after = dict(entry["after"]) if entry.get("after") else None
    if after is not None:
        after["comments"] = None   # the journal keeps statuses only
    answer = {"ok": result == "done", "id": entry["id"], "verb": entry.get("verb"), "board": entry.get("board"),
              "task": entry.get("task"), "risk": entry.get("risk"), "result": result, "before": entry.get("before"),
              "after": after, "at": entry.get("ts"), "audited": True}
    if entry.get("reason"):
        answer["reason"] = entry["reason"]
    for key in audit.COUNTS + audit.FLAGS:   # a campaign: what the journal kept of it (counts and flags; the card ids are not journaled)
        if key in entry:
            answer[key] = entry[key]
    return answer


def _load_journal() -> None:
    """Once per process: the end of the journal feeds the replay table (an order replayed after a restart still
    does nothing). A journal that cannot be read leaves the table empty and says so in the log."""
    global _journal_loaded
    with _state_lock:
        if _journal_loaded:
            return
        _journal_loaded = True
    try:
        entries = audit.read_tail(audit.MAX_LIMIT)
    except Exception as exc:   # noqa: BLE001 - the replay guard degrades to memory only
        log.warning("hermes-officecraft journal not read at start: %s", type(exc).__name__)
        return
    with _state_lock:
        for entry in reversed(entries):   # oldest first, so the newest ends last
            _seen.setdefault(entry["id"], _answer_from_journal(entry))


def _replayed(order_id: str, verb: str, board: Optional[str], task: Optional[str]) -> Optional[dict]:
    with _state_lock:
        known = _seen.get(order_id)
    if known is None:
        return None
    if (known.get("verb"), known.get("board"), known.get("task")) != (verb, board, task):
        # the same id for another order: neither run nor pretend it was this one
        return {"ok": False, "id": order_id, "verb": verb, "board": board, "task": task, "risk": RISK.get(verb),
                "result": "refused", "reason": "id_conflict", "replayed": False}
    return {**known, "replayed": True}


# ---------------------------------------------------------------- Hermes access (lazy, replaceable in tests)

def _hermes():
    """Hermes' kanban modules, imported when the first order arrives (the package imports without Hermes)."""
    from hermes_cli import kanban_db as kb
    from hermes_cli import kanban_db_connect as kbc
    return kb, kbc


def _read_status(conn, task: str) -> Optional[str]:
    row = conn.execute("SELECT status FROM tasks WHERE id = ?", (task,)).fetchone()
    return None if row is None else str(row[0])


def _count_comments(conn, task: str) -> int:
    return int(conn.execute("SELECT COUNT(*) FROM task_comments WHERE task_id = ?", (task,)).fetchone()[0])


def _refuse_on_status(verb: str, status: str) -> Optional[str]:
    """The reason code when an order must not touch a card in this status; ``None`` when it may."""
    if status == "running":
        return "running"
    if status == "archived":
        return "archived_task"
    if verb == "unblock" and status != "blocked":
        return "not_blocked"
    return None


def _execute(order: OrderIn) -> tuple[str, Optional[str], Optional[str], Optional[dict]]:
    """Run one order. Returns ``(result, reason, before_status, after)``; never raises for a decision."""
    kb, kbc = _hermes()
    try:
        slug = kb._normalize_board_slug(order.board)
    except ValueError:
        return "refused", "unknown_board", None, None
    if not slug or not kb.board_exists(slug):
        return "refused", "unknown_board", None, None
    if slug != kb.DEFAULT_BOARD and kb.read_board_metadata(slug).get("archived"):
        return "refused", "archived_board", None, None
    if not kb.kanban_db_path(board=slug).exists():   # `connect` would create an empty database: a board without one has no card
        return "refused", "unknown_task", None, None

    with kbc.connect_closing(board=slug) as conn:
        before = _read_status(conn, order.task)
        if before is None:
            return "refused", "unknown_task", None, None
        reason = _refuse_on_status(order.verb, before)
        if reason:
            return "refused", reason, before, {"status": before, "comments": _count_comments(conn, order.task)}

        from . import campaign   # a guard is launched (`complete_task`), never unblocked
        if order.verb in ("launch", "cancel_campaign"):
            run = campaign.execute_launch if order.verb == "launch" else campaign.execute_cancel
            return run(kb, conn, order)
        if order.verb == "unblock" and campaign.is_guard_row(campaign._guard_row(conn, order.task)):
            return "refused", "guard", before, {"status": before, "comments": _count_comments(conn, order.task)}

        if order.verb == "unblock":
            if not kb.unblock_task(conn, order.task):   # Hermes writes nothing on a card that is no longer blocked
                now = _read_status(conn, order.task)
                return "refused", _refuse_on_status("unblock", now or "") or "not_blocked", before, \
                    {"status": now, "comments": _count_comments(conn, order.task)}
        else:
            text = order.text or ""
            if not text.strip():
                return "refused", "empty_text", before, {"status": before, "comments": _count_comments(conn, order.task)}
            # control and write in ONE transaction: no card can start running between the two
            with kbc.write_txn(conn, allow_nested=True):
                now = _read_status(conn, order.task)
                reason = None if now is None else _refuse_on_status("comment", now)
                if now is None:
                    reason = "unknown_task"
                if reason:
                    return "refused", reason, before, {"status": now, "comments": _count_comments(conn, order.task)}
                kb.add_comment(conn, order.task, AUTHOR, text)

        after = {"status": _read_status(conn, order.task), "comments": _count_comments(conn, order.task)}   # RE-READ
    return "done", None, before, after


def run_order(order: OrderIn) -> tuple[int, dict]:
    """``(http_status, body)``. 200 for every decision (done / refused / failed), 409 when busy."""
    _load_journal()
    again = _replayed(order.id, order.verb, order.board, order.task)
    if again is not None:
        return (409 if again.get("reason") == "id_conflict" else 200), again
    if not _run_lock.acquire(blocking=False):
        return 409, {"ok": False, "id": order.id, "verb": order.verb, "board": order.board, "task": order.task,
                     "risk": RISK[order.verb], "result": "busy"}
    try:
        again = _replayed(order.id, order.verb, order.board, order.task)   # a twin that finished while we waited for the lock
        if again is not None:
            return (409 if again.get("reason") == "id_conflict" else 200), again
        try:
            result, reason, before, after = _execute(order)
        except Exception as exc:   # noqa: BLE001 - Hermes refused (fence, locked database...): said as a code, details in the log
            log.warning("hermes-officecraft order %s %s failed: %s", order.verb, order.task, type(exc).__name__)
            result, reason, before, after = "failed", "hermes_error", None, None
        entry = {"id": order.id, "verb": order.verb, "risk": RISK[order.verb], "board": order.board, "task": order.task,
                 "result": result, "reason": reason, "before": {"status": before} if before else None,
                 "after": {"status": after["status"]} if after and after.get("status") else None,
                 "len": len(order.text) if order.verb == "comment" and order.text is not None else None,
                 "archived": after.get("archived") if after and order.verb == "cancel_campaign" else None,
                 "source": "agent"}
        try:
            written = audit.append(entry)
            audited, at = True, written.get("ts")
        except Exception as exc:   # noqa: BLE001 - the order is done: say the journal missed it rather than hide the result
            log.warning("hermes-officecraft audit write failed: %s", type(exc).__name__)
            audited, at = False, int(time.time())
        answer = {"ok": result == "done", "id": order.id, "verb": order.verb, "board": order.board, "task": order.task,
                  "risk": RISK[order.verb], "result": result, "before": {"status": before} if before else None,
                  "after": after, "at": at, "audited": audited}
        if reason:
            answer["reason"] = reason
        _remember(answer)
        return 200, answer
    finally:
        _run_lock.release()


def run_audit(entry: AuditIn) -> dict:
    """Journal an order the page did. Executes nothing; the same id twice writes one line."""
    _load_journal()
    again = _replayed(entry.id, entry.verb, entry.board, entry.task)
    if again is not None:
        return {"ok": again.get("reason") != "id_conflict", "id": entry.id, "replayed": again.get("reason") != "id_conflict",
                **({"reason": "id_conflict"} if again.get("reason") == "id_conflict" else {})}
    line = {**entry.model_dump(exclude_none=True), "source": "page"}
    written = audit.append(line)
    _remember({"ok": entry.result == "done", "id": entry.id, "verb": entry.verb, "board": entry.board, "task": entry.task,
               "risk": entry.risk, "result": entry.result, "before": written.get("before"), "after": written.get("after"),
               "at": written.get("ts"), "audited": True, **({"reason": entry.reason} if entry.reason else {})})
    return {"ok": True, "id": entry.id, "replayed": False}
