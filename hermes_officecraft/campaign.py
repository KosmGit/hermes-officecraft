"""The campaign, agent half. A graph of cards created in ONE transaction by Hermes' own ``kanban_db``,
behind a head guard that nothing can pass but the user's « Launch ».

No LLM composes, splits or assigns anything here: the page sends the graph, this module checks it, writes it,
re-reads it and says what it found. Rules:

* ``POST /campaign``: closed fields and bounded text (pydantic, 422 without echo); then the graph is judged with a
  stable ``reason`` (200, ``refused``) BEFORE anything is written: no loop, every parent known, exactly one head guard
  (phase 0, no parent), a phase guard waiting for the last cards of the phase before it, a guard among the ancestors
  of every work card (otherwise the card would start at creation), bots read in the roster;
* the cards are written in topological order inside a single ``write_txn`` (edges travel as ``parents=``: Hermes'
  ``link_tasks`` cannot nest), guards ``initial_status='blocked'`` and without assignee: all or nothing, by the database;
* the graph is then RE-READ and compared with the one asked for (ids, edges, bots, models, statuses, no run with a
  profile); a difference archives every card, leaves first and guard last, and says so;
* a board created by the request (``newBoard``) is archived when the campaign fails;
* the answer is replayed without effect when its ``id`` is known (shared table and lock with ``/orders``);
* the journal line carries counts and codes only: never the goal, a title, an instruction or a model name.

``launch`` is ``complete_task`` on the guard, never ``unblock_task`` (a guard unblocked would sit ``ready`` without a
bot, its cards still ``todo``, and a ``default_assignee`` would make it run). ``cancel_campaign`` archives a campaign
that was not launched, leaves first. Both are verbs of ``/orders`` (``orders.py`` calls ``execute_launch`` /
``execute_cancel``) and share its lock, its replay table and its journal.
"""

import logging
import re
import sqlite3
import time
import unicodedata
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import audit, orders

log = logging.getLogger(__name__)

MAX_BODY_BYTES = 256 * 1024
MAX_WORK_CARDS = 40
MAX_CARDS = 48            # 40 work cards + a guard per phase
MAX_PHASES = 8
MAX_TITLE = 120
MAX_GOAL = 120
MAX_NAME = 60
MAX_BODY = 8_000          # the worker reads 8 192 characters of a card body (kanban_db_context.py:26)
MIN_RUNTIME, MAX_RUNTIME = 900, 86_400
CREATED_BY = "officecraft"
KEY_PREFIX = "oc-camp:"
# what Officecraft writes on a guard card is English for every user (a kanban is shared, and read by agents). A guard is
# RECOGNISED by its key (``is_guard_row``), never by these texts: a campaign written with the earlier French wording
# (« Garde — <goal> », « Garde phase B — <name> ») still reads, launches and cancels.
LAUNCH_RESULT = "Launched from Officecraft"
GUARD_BODY = 'Officecraft guard card: nothing starts until you press "Launch". Do not unblock it.'
REASONS = (
    "unknown_board", "archived_board", "board_exists", "bad_slug", "no_workdir", "unknown_profile", "cycle",
    "no_head_guard", "bad_guard", "unguarded", "too_many_cards", "bad_parent", "readback_mismatch", "hermes_error",
    "already_created", "not_a_guard", "not_blocked", "phase_not_done", "launched", "guard", "partial", "linked")

REF_RE = r"^[A-Za-z0-9_-]{1,16}$"
GUARD_REF_RE = re.compile(r"^G[0-9]+$")   # keys `oc-camp:<id>:G<phase>` belong to the guards: a work card cannot take one
KEY_RE = re.compile(r"^oc-camp:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):(?:G([0-7])|[A-Za-z0-9_-]{1,16})$")
TOKEN_RE = r"^[^\s]{1,200}$"


_PICTO = ((0xA9, 0xA9), (0xAE, 0xAE), (0x203C, 0x203C), (0x2049, 0x2049), (0x2122, 0x2122), (0x2139, 0x2139), (0x2194, 0x21AA),
          (0x231A, 0x23FF), (0x24C2, 0x24C2), (0x25AA, 0x25FE), (0x2600, 0x27BF), (0x2934, 0x2935), (0x2B05, 0x2B55), (0x3030, 0x3030),
          (0x303D, 0x303D), (0x3297, 0x3297), (0x3299, 0x3299), (0x1F000, 0x1F2FF), (0x1F300, 0x1FAFF))


def _is_picto(c: Optional[int]) -> bool:
    return c is not None and any(a <= c <= b for a, b in _PICTO)


def _cat(c: Optional[int]) -> str:
    return "" if c is None else unicodedata.category(chr(c))


def _joiner_ok(cps: list[int], i: int) -> bool:
    """ZWNJ / ZWJ join two letters (a letter, then its marks: Persian, Kurdish, Hindi) or, ZWJ only, two pictograms (the first
    followed by its variation selector / skin tone). Anywhere else they stay refused. Same rule as ``printable`` in src/core/campaign.js."""
    after = cps[i + 1] if i + 1 < len(cps) else None
    j = i - 1
    while j >= 0 and _cat(cps[j])[:1] == "M":
        j -= 1
    if j >= 0 and _cat(cps[j])[:1] == "L" and _cat(after)[:1] == "L":
        return True
    if cps[i] != 0x200D:
        return False
    j = i - 1
    while j >= 0 and (cps[j] == 0xFE0F or 0x1F3FB <= cps[j] <= 0x1F3FF):
        j -= 1
    return j >= 0 and _is_picto(cps[j]) and _is_picto(after)


def _printable(text: str, *, multiline: bool = False) -> bool:
    cps = [ord(ch) for ch in text]
    for i, c in enumerate(cps):
        if multiline and c in (10, 13, 9):   # a line break is not a letter: it never joins
            continue
        if c in (0x200C, 0x200D) and _joiner_ok(cps, i):
            continue
        cat = _cat(c)
        if cat[0] == "C" or cat in ("Zl", "Zp"):
            return False
    return True


class PhaseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=MAX_NAME)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = value.strip()
        if not value or not _printable(value):
            raise ValueError("invalid name")
        return value


class NewBoardIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slug: str = Field(min_length=1, max_length=128)   # the rule of Hermes is applied by the route: `bad_slug`, not a 422
    name: str = Field(min_length=1, max_length=MAX_NAME)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = value.strip()
        if not value or not _printable(value):
            raise ValueError("invalid name")
        return value


class CardIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ref: str = Field(pattern=REF_RE)
    kind: Literal["card", "guard"]
    phase: int = Field(ge=0, lt=MAX_PHASES)
    title: Optional[str] = Field(default=None, min_length=1, max_length=MAX_TITLE)
    assignee: Optional[str] = Field(default=None, pattern=orders.BOARD_RE)   # same shape as a profile name
    model: Optional[str] = Field(default=None, pattern=TOKEN_RE)
    provider: Optional[str] = Field(default=None, pattern=TOKEN_RE)
    body: Optional[str] = Field(default=None, max_length=MAX_BODY)
    parents: list[str] = Field(default_factory=list, max_length=MAX_CARDS)
    workspace: Optional[Literal["scratch", "dir"]] = None
    maxRuntime: Optional[int] = Field(default=None, ge=MIN_RUNTIME, le=MAX_RUNTIME)

    @field_validator("title")
    @classmethod
    def _title(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        if not value or not _printable(value):
            raise ValueError("invalid title")
        return value

    @field_validator("body")
    @classmethod
    def _body(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and not _printable(value, multiline=True):
            raise ValueError("invalid body")
        return value

    @model_validator(mode="after")
    def _shape(self):
        for ref in self.parents:
            if not re.fullmatch(REF_RE, ref):
                raise ValueError("invalid parent ref")
        if len(set(self.parents)) != len(self.parents):
            raise ValueError("duplicate parent")
        if (self.model is None) != (self.provider is None):
            raise ValueError("model and provider go together")
        if self.kind == "guard":
            if any(v is not None for v in (self.title, self.assignee, self.model, self.provider, self.body, self.workspace, self.maxRuntime)):
                raise ValueError("a guard carries only ref, kind, phase and parents")
        else:
            if self.title is None or self.assignee is None:
                raise ValueError("a card needs a title and a bot")
            if GUARD_REF_RE.fullmatch(self.ref):
                raise ValueError("reserved ref")
        return self


class CampaignIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=orders.ID_RE)
    board: Optional[str] = Field(default=None, pattern=orders.BOARD_RE)
    newBoard: Optional[NewBoardIn] = None
    goal: str = Field(min_length=1, max_length=MAX_GOAL)
    phases: list[PhaseIn] = Field(min_length=1, max_length=MAX_PHASES)
    cards: list[CardIn] = Field(min_length=1, max_length=MAX_CARDS)

    @field_validator("goal")
    @classmethod
    def _goal(cls, value: str) -> str:
        value = value.strip()
        if not value or not _printable(value):
            raise ValueError("invalid goal")
        return value

    @model_validator(mode="after")
    def _shape(self):
        if (self.board is None) == (self.newBoard is None):
            raise ValueError("exactly one of `board` and `newBoard`")
        refs = [c.ref for c in self.cards]
        if len(set(refs)) != len(refs):
            raise ValueError("duplicate ref")
        if any(c.phase >= len(self.phases) for c in self.cards):
            raise ValueError("unknown phase")
        return self


# ---------------------------------------------------------------- the graph (pure)

class Refused(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _letter(phase: int) -> str:
    return chr(ord("A") + phase)


def plan_graph(c: CampaignIn) -> list[CardIn]:
    """The cards in the order they must be written (parents first), or ``Refused(reason)``. Pure: no Hermes, no disk."""
    by_ref = {card.ref: card for card in c.cards}
    work = [card for card in c.cards if card.kind == "card"]
    guards = [card for card in c.cards if card.kind == "guard"]
    if len(work) > MAX_WORK_CARDS:
        raise Refused("too_many_cards")
    heads = [g for g in guards if g.phase == 0]
    if len(heads) != 1 or heads[0].parents:
        raise Refused("no_head_guard")
    if len({g.phase for g in guards}) != len(guards):
        raise Refused("bad_guard")
    for card in c.cards:
        for ref in card.parents:
            if ref not in by_ref:
                raise Refused("bad_parent")
            if by_ref[ref].phase > card.phase:
                raise Refused("bad_parent")   # a card never waits for a later phase
    # Kahn, stable on the order given
    waiting = {card.ref: set(card.parents) for card in c.cards}
    order: list[CardIn] = []
    left = [card.ref for card in c.cards]
    while left:
        ready = [ref for ref in left if not waiting[ref]]
        if not ready:
            raise Refused("cycle")
        ref = ready[0]
        left.remove(ref)
        order.append(by_ref[ref])
        for other in waiting.values():
            other.discard(ref)
    # a phase guard waits for the last cards of the phase before it (the cards no other card of that phase waits for)
    for g in guards:
        if g.phase == 0:
            continue
        before = [card for card in work if card.phase == g.phase - 1]
        inside = {p for card in before for p in card.parents}
        ends = {card.ref for card in before if card.ref not in inside}
        if set(g.parents) != ends:
            raise Refused("bad_parent")
    # every work card has the head guard among its ancestors, and the guard of its phase when it has one (a phase guard
    # after an empty phase would wait for nothing: launched first, it would start its cards before the head guard)
    ancestors: dict[str, set[str]] = {}
    for card in order:
        found: set[str] = set()
        for p in card.parents:
            found |= {p} | ancestors[p]
        ancestors[card.ref] = found
    phase_guard = {g.phase: g.ref for g in guards}
    for card in work:
        need = {heads[0].ref, phase_guard.get(card.phase, heads[0].ref)}
        if not need <= ancestors[card.ref]:
            raise Refused("unguarded")
    return order


def guard_titles(c: CampaignIn) -> dict[int, str]:
    return {0: f"Guard — {c.goal}", **{k: f"Guard phase {_letter(k)} — {c.phases[k].name}" for k in range(1, len(c.phases))}}


def card_key(campaign_id: str, card: CardIn) -> str:
    return f"{KEY_PREFIX}{campaign_id}:" + (f"G{card.phase}" if card.kind == "guard" else card.ref)


def parse_key(key) -> Optional[tuple[str, Optional[int]]]:
    """``(campaign id, phase)`` of a guard key, ``(campaign id, None)`` of a card key, ``None`` for any other key."""
    match = KEY_RE.fullmatch(key) if isinstance(key, str) else None
    if match is None:
        return None
    return match.group(1), (int(match.group(2)) if match.group(2) is not None else None)


# ---------------------------------------------------------------- Hermes access (lazy, replaceable in tests)

def _hermes():
    from hermes_cli import kanban_db as kb
    from hermes_cli import kanban_db_boards as boards
    from hermes_cli import kanban_db_connect as kbc
    return kb, boards, kbc


def _roster() -> set[str]:
    from hermes_cli.profiles import list_profiles
    return {p.name for p in list_profiles(lazy_skill_count=True)}


def _statuses(conn, ids) -> dict[str, str]:
    ids = list(ids)
    out: dict[str, str] = {}
    for at in range(0, len(ids), 200):
        chunk = ids[at:at + 200]
        for tid, status in conn.execute(f"SELECT id, status FROM tasks WHERE id IN ({','.join('?' * len(chunk))})", chunk):
            out[tid] = status
    return out


def _campaign_rows(conn, campaign_id: str) -> list[tuple[str, str, str]]:
    """``(id, status, key)`` of the non-archived cards of this campaign."""
    prefix = f"{KEY_PREFIX}{campaign_id}:"
    return [(r[0], r[1], r[2]) for r in conn.execute(
        "SELECT id, status, idempotency_key FROM tasks WHERE idempotency_key LIKE ? AND status != 'archived'", (prefix + "%",))
        if isinstance(r[2], str) and r[2].startswith(prefix)]


def _resolve_board(kb, slug: str) -> Optional[str]:
    """A known, not archived board whose database exists: its slug, else the refusal reason."""
    try:
        normed = kb._normalize_board_slug(slug)
    except ValueError:
        return "unknown_board"
    if not normed or normed != slug or not kb.board_exists(normed):
        return "unknown_board"
    if normed != kb.DEFAULT_BOARD and kb.read_board_metadata(normed).get("archived"):
        return "archived_board"
    if not kb.kanban_db_path(board=normed).exists():
        return "unknown_board"
    return None


# ---------------------------------------------------------------- readback

def _counts(statuses: dict[str, str]) -> dict:
    out = {"blocked": 0, "todo": 0, "ready": 0, "running": 0}
    for status in statuses.values():
        if status in out:
            out[status] += 1
    return out


def _readback(conn, campaign_id: str, order: list[CardIn], ids: dict[str, str], c: CampaignIn, workdir) -> tuple[bool, dict]:
    """Compare what the database holds with what was asked for. ``(same, statuses)``; never raises for a difference."""
    titles = guard_titles(c)
    wanted = {ids[card.ref] for card in order}
    rows = {r["id"]: r for r in conn.execute(
        f"SELECT id, title, body, assignee, status, created_by, idempotency_key, model_override, provider_override, workspace_kind, "
        f"max_runtime_seconds FROM tasks WHERE id IN ({','.join('?' * len(wanted))})", list(wanted))}
    statuses = {tid: r["status"] for tid, r in rows.items()}
    same = len(rows) == len(wanted)
    for card in order:
        row = rows.get(ids[card.ref])
        if row is None:
            same = False
            continue
        if card.kind == "guard":
            want = {"title": titles[card.phase], "assignee": None, "status": "blocked", "body": GUARD_BODY,
                    "model_override": None, "provider_override": None, "workspace_kind": "scratch", "max_runtime_seconds": None}
        else:
            want = {"title": card.title, "assignee": card.assignee, "status": "todo", "body": card.body,
                    "model_override": card.model, "provider_override": card.provider,
                    "workspace_kind": card.workspace or "scratch", "max_runtime_seconds": card.maxRuntime}
        want["created_by"], want["idempotency_key"] = CREATED_BY, card_key(campaign_id, card)
        for column, value in want.items():
            if column == "body" and not value and not row[column]:
                continue
            if row[column] != value:
                same = False
    edges = {(p, ch) for p, ch in conn.execute(
        f"SELECT parent_id, child_id FROM task_links WHERE child_id IN ({','.join('?' * len(wanted))})", list(wanted))}
    if edges != {(ids[p], ids[card.ref]) for card in order for p in card.parents}:
        same = False
    if len(_campaign_rows(conn, campaign_id)) != len(wanted):
        same = False
    started = conn.execute(
        f"SELECT COUNT(*) FROM task_runs WHERE task_id IN ({','.join('?' * len(wanted))}) "
        f"AND (profile IS NOT NULL OR worker_pid IS NOT NULL OR claim_lock IS NOT NULL)", list(wanted)).fetchone()[0]
    if started:
        same = False
    return same, statuses


def _archive_leaves_first(kb, conn, ids: list[str], parents_of: dict[str, set[str]]) -> int:
    """Archive these cards one by one, every card before its parents (a parent archived first frees its children).
    Between two archivings nothing may have become ``ready``: otherwise stop, and say how many went."""
    todo = set(ids)
    done = 0
    children_of: dict[str, set[str]] = {tid: set() for tid in todo}
    for child, parents in parents_of.items():
        for p in parents:
            if p in children_of and child in todo:
                children_of[p].add(child)
    while todo:
        leaves = sorted(t for t in todo if not (children_of[t] & todo))
        if not leaves:   # a loop in the stored links: cannot happen from our own write, never loops here
            leaves = sorted(todo)
        tid = leaves[0]
        todo.discard(tid)
        if kb.archive_task(conn, tid):
            done += 1
        if any(s in ("ready", "running") for s in _statuses(conn, todo).values()):
            break
    return done


# ---------------------------------------------------------------- POST /campaign

def _create(c: CampaignIn, order: list[CardIn]) -> dict:
    """Everything after the validation. Returns the answer body (without ``at``); never raises for a decision."""
    kb, boards, kbc = _hermes()
    answer: dict = {"ok": False, "id": c.id, "verb": "campaign", "board": None, "task": None, "risk": "final", "result": "refused"}

    def refuse(reason: str) -> dict:
        answer.update(result="refused", reason=reason)
        return answer

    new_board = c.newBoard
    if c.board is not None:
        answer["board"] = c.board
        reason = _resolve_board(kb, c.board)
        if reason:
            return refuse(reason)
        slug, created_board = c.board, False
    else:
        assert new_board is not None
        slug = new_board.slug
        answer["board"] = slug
        try:
            normed = kb._normalize_board_slug(slug)
        except ValueError:
            return refuse("bad_slug")
        if not normed or normed != slug:
            return refuse("bad_slug")
        if slug in {str(b.get("slug")) for b in boards.list_boards(include_archived=True)}:   # `create_board` would answer « ok » for a board that exists
            return refuse("board_exists")
        created_board = True
    work_dir = None
    if any(card.workspace == "dir" for card in order):
        work_dir = None if created_board else kb.read_board_metadata(slug).get("default_workdir")
        if not work_dir:
            return refuse("no_workdir")
    roster = _roster()
    if any(card.assignee not in roster for card in order if card.kind == "card"):
        return refuse("unknown_profile")

    if created_board and new_board is not None:
        boards.create_board(slug, name=new_board.name)
        answer["boardCreated"] = True
    ids: dict[str, str] = {}
    archived = 0
    reason: Optional[str] = None
    try:
        with kbc.connect_closing(board=slug) as conn:
            try:
                with kbc.write_txn(conn):
                    if _campaign_rows(conn, c.id):
                        raise Refused("already_created")   # this id already built a graph here: another one would be mixed with it
                    titles = guard_titles(c)
                    for card in order:
                        guard = card.kind == "guard"
                        ids[card.ref] = kb.create_task(
                            conn, title=titles[card.phase] if guard else card.title, body=GUARD_BODY if guard else card.body,
                            assignee=None if guard else card.assignee, created_by=CREATED_BY,
                            workspace_kind="scratch" if guard else (card.workspace or "scratch"),
                            workspace_path=work_dir if (not guard and card.workspace == "dir") else None,
                            parents=[ids[p] for p in card.parents], idempotency_key=card_key(c.id, card),
                            max_runtime_seconds=None if guard else card.maxRuntime,
                            model_override=None if guard else card.model, provider_override=None if guard else card.provider,
                            initial_status="blocked" if guard else "running", board=slug)
            except Refused as why:
                ids.clear()
                reason = why.reason
            except Exception as exc:   # noqa: BLE001 - the transaction rolled back: no card exists
                log.warning("hermes-officecraft campaign write failed: %s", type(exc).__name__)
                ids.clear()
                reason = "hermes_error"
            if reason is None:
                same, statuses = _readback(conn, c.id, order, ids, c, work_dir)
                if not same:
                    reason = "readback_mismatch"
                    parents_of = {ids[card.ref]: {ids[p] for p in card.parents} for card in order}
                    archived = _archive_leaves_first(kb, conn, [ids[card.ref] for card in reversed(order)], parents_of)
                else:
                    answer.update(after=_counts(statuses))
    except Exception as exc:   # noqa: BLE001
        log.warning("hermes-officecraft campaign failed: %s", type(exc).__name__)
        reason = "hermes_error" if reason is None else reason
    if reason is not None:
        answer.update(result="failed" if reason in ("hermes_error", "readback_mismatch") else "refused", reason=reason,
                      created=0 if reason != "readback_mismatch" else len(order), archived=archived)
        answer.pop("after", None)
        if created_board:
            try:
                boards.remove_board(slug, archive=True)
                answer["boardArchived"] = True
            except Exception as exc:   # noqa: BLE001 - said, not hidden: the board stays and the page tells the user
                log.warning("hermes-officecraft campaign board not archived: %s", type(exc).__name__)
                answer["boardArchived"] = False
        return answer
    guards = [{"ref": card.ref, "task": ids[card.ref]} for card in order if card.kind == "guard"]
    cards = [{"ref": card.ref, "task": ids[card.ref]} for card in order if card.kind == "card"]
    answer.update(ok=True, result="done", created=len(order), links=sum(len(card.parents) for card in order), guards=guards, cards=cards)
    answer.pop("reason", None)
    return answer


def run_campaign(c: CampaignIn) -> tuple[int, dict]:
    """``(http_status, body)``. 200 for every decision, 409 when another order runs or the id was used for another order."""
    orders._load_journal()
    board = c.board if c.board is not None else (c.newBoard.slug if c.newBoard is not None else "")
    again = orders._replayed(c.id, "campaign", board, None)
    if again is not None:
        return (409 if again.get("reason") == "id_conflict" else 200), again
    if not orders._run_lock.acquire(blocking=False):
        return 409, {"ok": False, "id": c.id, "verb": "campaign", "board": board, "task": None, "risk": "final", "result": "busy"}
    try:
        again = orders._replayed(c.id, "campaign", board, None)
        if again is not None:
            return (409 if again.get("reason") == "id_conflict" else 200), again
        try:
            order = plan_graph(c)
        except Refused as why:
            answer = {"ok": False, "id": c.id, "verb": "campaign", "board": board, "task": None, "risk": "final",
                      "result": "refused", "reason": why.reason}
        else:
            try:
                answer = _create(c, order)
            except Exception as exc:   # noqa: BLE001 - never the text of an exception
                log.warning("hermes-officecraft campaign failed: %s", type(exc).__name__)
                answer = {"ok": False, "id": c.id, "verb": "campaign", "board": board, "task": None, "risk": "final",
                          "result": "failed", "reason": "hermes_error"}
        entry = {"id": c.id, "verb": "campaign", "risk": "final", "board": board, "result": answer["result"],
                 "reason": answer.get("reason"), "created": answer.get("created"), "links": answer.get("links"),
                 "guards": len(answer["guards"]) if answer.get("guards") is not None else None, "archived": answer.get("archived"),
                 "boardCreated": answer.get("boardCreated"), "boardArchived": answer.get("boardArchived"), "source": "agent"}
        try:
            written = audit.append(entry)
            audited, at = True, written.get("ts")
        except Exception as exc:   # noqa: BLE001 - the campaign exists: say the journal missed it rather than hide it
            log.warning("hermes-officecraft audit write failed: %s", type(exc).__name__)
            audited, at = False, int(time.time())
        answer.update(at=at, audited=audited)
        orders._remember(answer)
        return 200, answer
    finally:
        orders._run_lock.release()


# ---------------------------------------------------------------- launch and cancel (verbs of /orders)

def _guard_row(conn, task: str):
    """``(status, assignee, idempotency_key, created_by)``; a database without the key column (an old Hermes) has no guard."""
    try:
        return conn.execute("SELECT status, assignee, idempotency_key, created_by FROM tasks WHERE id = ?", (task,)).fetchone()
    except sqlite3.OperationalError:
        row = conn.execute("SELECT status FROM tasks WHERE id = ?", (task,)).fetchone()
        return None if row is None else (row[0], None, None, None)


def _status_of(conn, task: str) -> Optional[str]:
    row = conn.execute("SELECT status FROM tasks WHERE id = ?", (task,)).fetchone()
    return None if row is None else str(row[0])


def is_guard_row(row) -> Optional[tuple[str, int]]:
    """``(campaign id, phase)`` when this card is a guard of Officecraft (key ``oc-camp:<id>:G<n>``, no assignee, written by
    Officecraft: any agent can give a card that key; Hermes' tool writes the profile name in ``created_by``)."""
    if row is None or row[1] or row[3] != CREATED_BY:
        return None
    parsed = parse_key(row[2])
    return (parsed[0], parsed[1]) if parsed is not None and parsed[1] is not None else None


def execute_launch(kb, conn, order) -> tuple[str, Optional[str], Optional[str], Optional[dict]]:
    """``complete_task`` on a guard whose parents are all finished. Same return as ``orders._execute``."""
    row = _guard_row(conn, order.task)
    if row is None:
        return "refused", "unknown_task", None, None
    before = str(row[0])
    guard = is_guard_row(row)
    if guard is None:
        return "refused", "not_a_guard", before, {"status": before}
    if before != "blocked":
        return "refused", "not_blocked", before, {"status": before}
    parents = [r[0] for r in conn.execute("SELECT parent_id FROM task_links WHERE child_id = ?", (order.task,))]
    if any(s not in ("done", "archived") for s in _statuses(conn, parents).values()) or len(_statuses(conn, parents)) != len(parents):
        return "refused", "phase_not_done", before, {"status": before}
    children = [r[0] for r in conn.execute("SELECT child_id FROM task_links WHERE parent_id = ?", (order.task,))]
    if not kb.complete_task(conn, order.task, result=LAUNCH_RESULT):
        now = _status_of(conn, order.task)
        return "refused", "phase_not_done" if now == "blocked" else "not_blocked", before, {"status": now}
    status = _status_of(conn, order.task)   # RE-READ
    ready = sum(1 for s in _statuses(conn, children).values() if s in ("ready", "running"))
    return "done", None, before, {"status": status, "ready": ready}


def execute_cancel(kb, conn, order) -> tuple[str, Optional[str], Optional[str], Optional[dict]]:
    """Archive a campaign that was not launched: its cards leaves first, the head guard last."""
    row = _guard_row(conn, order.task)
    if row is None:
        return "refused", "unknown_task", None, None
    before = str(row[0])
    guard = is_guard_row(row)
    if guard is None or guard[1] != 0:
        return "refused", "not_a_guard", before, {"status": before}
    if before != "blocked":
        return "refused", "launched", before, {"status": before}
    campaign_id = guard[0]
    rows = _campaign_rows(conn, campaign_id)
    if any(status not in ("todo", "blocked") for _, status, _ in rows):
        return "refused", "launched", before, {"status": before}
    ids = [r[0] for r in rows]
    marks = ','.join('?' * len(ids))
    # a card OUTSIDE the campaign that waits for one of its cards would be freed by the archiving (Hermes frees
    # the children of an archived parent) and start at the next tick: refuse, touch nothing
    if conn.execute(f"SELECT COUNT(*) FROM task_links l JOIN tasks t ON t.id = l.child_id WHERE l.parent_id IN ({marks}) "
                    f"AND l.child_id NOT IN ({marks}) AND t.status != 'archived'", ids + ids).fetchone()[0]:
        return "refused", "linked", before, {"status": before}
    parents_of: dict[str, set[str]] = {tid: set() for tid in ids}
    for parent, child in conn.execute(f"SELECT parent_id, child_id FROM task_links WHERE child_id IN ({','.join('?' * len(ids))})", ids):
        parents_of[child].add(parent)
    done = _archive_leaves_first(kb, conn, ids, parents_of)
    left = _statuses(conn, ids)
    after = {"status": left.get(order.task), "archived": sum(1 for s in left.values() if s == "archived"),
             "ready": sum(1 for s in left.values() if s == "ready"), "running": sum(1 for s in left.values() if s == "running")}
    if done == len(ids) and after["archived"] == len(ids) and not after["ready"] and not after["running"]:
        return "done", None, before, after
    return "failed", "partial", before, after
