"""Read-only facts the office draws, gathered inside the Hermes process.

The desktop half cannot read the kanban (``ctx.rest`` is confined to
``/api/plugins/hermes-officecraft``; the gateway has no kanban RPC), so this module
is the office's only source for boards, cron jobs, gateway state, skill
metadata and history.

Privacy: whitelisted fields only. Never card bodies,
results or comments, session previews or messages, SOUL.md, skill
descriptions or instructions, cron prompts/scripts/targets, paths.

The readers below are plain sqlite/JSON functions with explicit paths, so they
are testable without Hermes; ``hermes_*`` helpers import Hermes lazily.
"""

from __future__ import annotations

import itertools
import json
import logging
import sqlite3
import re
import threading
import time
from collections import Counter
from contextlib import contextmanager
from contextvars import ContextVar
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

log = logging.getLogger(__name__)

# Event kinds and run outcomes copied for the game layer (kind + task id + time only, never payloads).
EVENT_KINDS = ("blocked", "unblocked", "review_requested", "changes_requested", "completed", "crashed", "timed_out")
RUN_OUTCOMES = ("completed", "crashed", "timed_out", "blocked", "reclaimed", "rate_limited", "scheduled", "gave_up")
CRON_FIELDS = ("name", "enabled", "schedule_display", "last_status", "last_run_at", "next_run_at", "failure_streak", "paused_at")
TASK_COLUMNS = ("id", "title", "status", "assignee", "created_at", "started_at", "completed_at", "last_heartbeat_at")
# Read only when the board has them (a card pins a model: `kanban_db.py:627`); never required.
OVERRIDE_COLUMNS = ("model_override", "provider_override")
# a guard's key (campaign.py `KEY_RE`, same rule: a test holds them together; this module is also loaded without its package)
GUARD_KEY_RE = re.compile(r"^oc-camp:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):G([0-7])$")
GUARD_COLUMNS = ("idempotency_key", "created_by")   # read to recognise the guards of a campaign; never served
INTERNAL_LISTING_FALLBACK = ("kanban", "tool", "oneshot")   # hermes_state_sessions.INTERNAL_LISTING_SOURCES on the verified base
DESCRIPTION_MAX = 280
OWN_SKILLS_MAX = 40
MODEL_NAME_MAX = 120   # a model/provider name, never a config block (same bound as workerModel)
SMALL_SKILL_SET = 12   # a profile that kept this few skills hand-picked them: all of them describe it

# --- Time bounds. ``/history`` runs inside the Hermes process, on data other processes are writing:
# a board or a bot's state.db can be locked or mid-checkpoint, and Hermes's own reader waits 5 s on a
# busy database (hermes_state._READ_BUSY_TIMEOUT_S) before giving up. On a dozen bots and a few boards that is a
# minute of waiting, well past the front's 10 s timeout, for data the page could have done without. Every optional read
# below is therefore bounded: a slow store costs its bot or board this round, never the whole route.
DB_TIMEOUT_S = 0.2           # sqlite busy timeout of our own read-only handles
SESSION_READ_TIMEOUT_S = 0.3  # one bot's state.db, read through Hermes's SessionDB
SESSIONS_BUDGET_S = 2.0      # the whole session phase (a dozen bots): in the gateway it takes 0.07-0.48 s, up to 1.26 s on a loaded host; it is a cap, a normal read never waits for it
SESSION_PER_BOT_S = 0.075    # budget per bot once the roster is bigger than SESSIONS_BUDGET_S / this (a dozen bots)
SESSIONS_GRACE_S = 0.25      # past the budget, bots not read yet still get a short slot (SESSION_LATE_SLOT_S) inside this extra time: only those that miss it are flagged
SESSION_LATE_SLOT_S = 0.05   # one bot's slot past the budget (a read costs ~5 ms: most make it)
SLOW_SESSION_SKIP_S = 30.0   # a state.db whose task really ran a whole slot is left alone this long (it was wedged); < the 60 s /history poll, so the next read retries it. A bot cut for lack of time is NOT skipped
SLOW_READ_LOG_S = 0.8        # log the phase breakdown above this: the next slow /history is diagnosable

_ROTATION = itertools.count()   # which bot the session phase starts with
_SESSION_POOL: Optional[ThreadPoolExecutor] = None
_SESSION_POOL_LOCK = threading.Lock()
_SLOW_SESSIONS: dict[str, float] = {}   # resolved db path -> epoch until which it is skipped


# ---------------------------------------------------------------- partial
# A source that could not be read is not a source that holds nothing. ``/live`` and ``/history`` say which one
# failed and why, in a closed vocabulary: ``source`` is one of ``kanban`` (the list of boards), ``kanban:<slug>``,
# ``profiles``, ``sessions`` (the session phase as a whole), ``sessions:<profile>`` (that bot's state.db),
# ``gateway``, ``ops`` (the gateway + cron read as a whole), ``cron`` and ``cron:<profile>``; ``reason`` is one of
# REASONS. Never an exception text, never a path.
REASONS = ("unreadable", "locked", "schema", "missing")
PARTIAL_MAX = 60
_SOURCE_RE = re.compile(r"^[a-z][a-z0-9_]*(?::[A-Za-z0-9_.-]{1,64})?$")
_PARTIAL: ContextVar[Optional[list]] = ContextVar("officecraft_partial", default=None)


@contextmanager
def partial_scope():
    """Collect what the readers below flag while a route builds its answer (nothing is collected outside one)."""
    flags: list[dict] = []
    token = _PARTIAL.set(flags)
    try:
        yield flags
    finally:
        _PARTIAL.reset(token)


def flag(source: str, reason: str) -> None:
    """Record ``{source, reason}`` in the current scope (no-op outside one; duplicates and unknown words are dropped)."""
    flags = _PARTIAL.get()
    if flags is None or reason not in REASONS or not _SOURCE_RE.fullmatch(source or ""):
        return
    entry = {"source": source, "reason": reason}
    if entry not in flags and len(flags) < PARTIAL_MAX:
        flags.append(entry)


def partial_list(flags: Iterable[dict]) -> list[dict]:
    """The flags as served: sorted, so two reads of the same state give the same answer."""
    return sorted(flags, key=lambda f: (f["source"], REASONS.index(f["reason"])))


def classify(exc: BaseException) -> str:
    """Why a read failed, as one word of REASONS (the exception text is never kept)."""
    if isinstance(exc, (FutureTimeout, TimeoutError)):
        return "locked"
    if isinstance(exc, FileNotFoundError):
        return "missing"
    if isinstance(exc, sqlite3.Error):
        text = str(exc).lower()
        if "locked" in text or "busy" in text:
            return "locked"
        if "no such table" in text or "no such column" in text:
            return "schema"
    return "unreadable"


def _safe(name: Any) -> str:
    """A slug or profile name as it may appear in a source (anything else is cut to the allowed characters)."""
    return re.sub(r"[^A-Za-z0-9_.-]", "", str(name))[:64] or "unknown"


# ---------------------------------------------------------------- helpers
def iso_to_epoch(value: Any) -> Optional[float]:
    """ISO-8601 string (or epoch number) -> epoch seconds; None when absent or unparseable."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return datetime.fromisoformat(str(value)).timestamp()
    except (TypeError, ValueError):
        return None


def task_epoch(value: Any) -> Optional[int]:
    """A kanban timestamp as epoch seconds, read the way Hermes does (``kanban_db._to_epoch``): a number
    or a numeric string -> int, an ISO-8601 string -> its epoch, anything else (empty, garbage) -> None.
    Hermes tolerates text dates in ``tasks``; a raw string would reach the page as a string."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    s = str(value).strip()
    if not s:
        return None
    try:
        return int(s)
    except ValueError:
        pass
    try:
        return int(datetime.fromisoformat(s).timestamp())
    except (ValueError, OSError, OverflowError):
        return None


def _ro(db_path: Path, timeout: float = DB_TIMEOUT_S) -> sqlite3.Connection:
    con = sqlite3.connect(f"{Path(db_path).resolve().as_uri()}?mode=ro", uri=True, timeout=timeout)
    con.execute("PRAGMA query_only = ON")
    return con


def _read_json(path: Path, source: Optional[str] = None, *, absent_ok: bool = True) -> Any:
    """The JSON file, or None. With ``source`` an unreadable file is flagged (``unreadable``); an absent one too
    (``missing``) unless ``absent_ok`` (a profile without cron jobs has no ``jobs.json``: nothing is wrong)."""
    try:
        return json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        if source and not absent_ok:
            flag(source, "missing")
        return None
    except (OSError, ValueError):
        if source:
            flag(source, "unreadable")
        return None


def _columns(con: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in con.execute(f"PRAGMA table_info({table})")}


# ---------------------------------------------------------------- kanban
def _campaign_guard(row: dict) -> Optional[tuple[dict, str]]:
    """``({guard, head, campaign}, full campaign id)`` for a guard of Officecraft (key ``oc-camp:<id>:G<n>``, no bot), else None."""
    key = row.get("idempotency_key")
    match = GUARD_KEY_RE.fullmatch(key) if isinstance(key, str) else None
    if match is None or row.get("assignee") or row.get("created_by") != "officecraft":   # written by Officecraft only
        return None
    return {"guard": True, "head": match.group(2) == "0", "campaign": match.group(1)[:8]}, match.group(1)


def _campaign_sizes(guards: list, keys: list[str]) -> None:
    """``campaignSize`` on the head guard: how many non-archived cards the campaign still has (guards included)."""
    for card, campaign_id in guards:
        if card["head"]:
            prefix = f"oc-camp:{campaign_id}:"
            card["campaignSize"] = sum(1 for key in keys if key.startswith(prefix))


def read_board(db_path: Path, slug: str, *, created_at: Any = None, history: bool = True) -> dict:
    """One board: its non-archived cards (whitelisted columns) and, with ``history``, finished
    runs and whitelisted events. An empty board is returned too (an empty pod is a fact)."""
    board: dict = {"slug": slug, "createdAt": iso_to_epoch(created_at), "tasks": [], "runs": [], "events": []}
    source = f"kanban:{_safe(slug)}"
    if not Path(db_path).is_file():
        flag(source, "missing")
        return board
    con = _ro(Path(db_path))
    try:
        have = _columns(con, "tasks")
        cols = [c for c in TASK_COLUMNS + OVERRIDE_COLUMNS + GUARD_COLUMNS if c in have]
        if not {"id", "title", "status"} <= set(cols):
            flag(source, "schema")   # the cards exist but this table is no longer the one Hermes writes
            return board
        guards: list = []   # (card, campaign id) of the guards of Officecraft; the key itself is never served
        every_key: list[str] = []
        for row in con.execute(f"SELECT {', '.join(cols)} FROM tasks WHERE status != 'archived' ORDER BY created_at, id"):
            r = dict(zip(cols, row))
            board["tasks"].append({
                "id": r["id"], "title": _title(r.get("title")), "status": r["status"], "assignee": _name(r.get("assignee")),
                "createdAt": task_epoch(r.get("created_at")), "startedAt": task_epoch(r.get("started_at")),
                "completedAt": task_epoch(r.get("completed_at")),
                "heartbeatAt": task_epoch(r.get("last_heartbeat_at")) if r["status"] == "running" else None,
                # model the card pins (None = the bot's own default); older boards lack these columns
                "modelOverride": _name(r.get("model_override")), "providerOverride": _name(r.get("provider_override"))})
            if isinstance(r.get("idempotency_key"), str) and r["idempotency_key"].startswith("oc-camp:"):
                every_key.append(r["idempotency_key"])
            parsed = _campaign_guard(r)
            if parsed:
                board["tasks"][-1].update(parsed[0])
                guards.append((board["tasks"][-1], parsed[1]))
        _campaign_sizes(guards, every_key)
        if history:
            run_cols = _columns(con, "task_runs")
            if not {"profile", "started_at", "ended_at", "outcome"} <= run_cols:
                flag(source, "schema")
            if {"profile", "started_at", "ended_at", "outcome"} <= run_cols:
                # the card id of each run (`task`) lets the game tell a retry of the same card from a new card
                with_task = "task_id" in run_cols
                board["runs"] = [{"profile": p, "startedAt": s, "endedAt": e, "outcome": o, **({"task": t} if with_task else {})}
                                 for p, s, e, o, t in con.execute(
                    f"SELECT profile, started_at, ended_at, outcome, {'task_id' if with_task else 'NULL'} FROM task_runs WHERE ended_at IS NOT NULL AND profile IS NOT NULL AND profile != '' ORDER BY ended_at")   # a run without a profile is a « Launch » (the synthetic run of a guard), not an execution
                    if o in RUN_OUTCOMES]
            if {"parent_id", "child_id"} <= _columns(con, "task_links"):
                # the parent -> child links between the cards served above (ids only; a link to an archived or
                # unknown card is dropped), for the chain achievements
                ids = {t["id"] for t in board["tasks"]}
                board["links"] = [[p, c] for p, c in con.execute("SELECT parent_id, child_id FROM task_links") if p in ids and c in ids]
            event_cols = _columns(con, "task_events")
            if not {"task_id", "kind", "created_at"} <= event_cols:
                flag(source, "schema")
            if {"task_id", "kind", "created_at"} <= event_cols:
                board["events"] = [{"task": t, "kind": k, "ts": ts} for t, k, ts in con.execute(
                    f"SELECT task_id, kind, created_at FROM task_events WHERE kind IN ({','.join('?' * len(EVENT_KINDS))}) ORDER BY created_at",
                    EVENT_KINDS)]
    finally:
        con.close()
    return board


def hermes_boards(*, history: bool = True) -> list[dict]:
    """Every live (non-archived) board of this Hermes home, ``default`` first."""
    from hermes_cli.kanban_db_boards import list_boards
    out = []
    for meta in list_boards(include_archived=False):
        try:
            out.append(read_board(Path(meta["db_path"]), meta["slug"], created_at=meta.get("created_at"), history=history))
        except sqlite3.Error as exc:
            # a board being migrated, locked or damaged: skipped this round (never fails the whole read), and said
            flag(f"kanban:{_safe(meta['slug'])}", classify(exc))
    # The implicit ``default`` board always exists in list_boards; hide it while it holds nothing.
    return [b for b in out if b["tasks"] or b["slug"] != "default"]


# ---------------------------------------------------------------- notifier extras
REVIEW_WINDOW_S = 7 * 86400       # a refused review older than this is no longer news
_ACTIVE_AFTER_REVIEW = ("ready", "todo", "running", "triage")   # a card still waiting for its rework (blocked ones are read apart)
_CAMPAIGN_KEY_RE = re.compile(r"^oc-camp:([0-9a-f]{8})[0-9a-f-]{28}:(G[0-7]|[A-Za-z0-9_.-]{1,40})$")


def _campaigns_of(rows: list, links: list) -> list[dict]:
    """The campaigns of Officecraft of one board, from the cards that carry its keys (written by Officecraft only):
    ``[{id, name, cards, done, phases: [{phase, name, count}]}]``. ``phases`` lists the phases READY to launch: the guard still
    waits (blocked, no bot) and every card it waits for is done (the head guard waits for nothing: ready as soon as it exists)."""
    status = {r["id"]: r["status"] for r in rows}
    parents: dict[str, list[str]] = {}
    children: dict[str, list[str]] = {}
    for p, c in links:
        parents.setdefault(c, []).append(p)
        children.setdefault(p, []).append(c)
    camps: dict[str, dict] = {}
    for r in rows:
        key = r.get("idempotency_key")
        match = _CAMPAIGN_KEY_RE.fullmatch(key) if isinstance(key, str) else None
        if match is None or r.get("created_by") != "officecraft":
            continue
        camp = camps.setdefault(match.group(1), {"work": [], "guards": {}})
        if re.fullmatch(r"G[0-7]", match.group(2)):
            if not r.get("assignee"):     # a guard has no bot
                camp["guards"][int(match.group(2)[1])] = r
        else:
            camp["work"].append(r)
    out = []
    for cid, camp in camps.items():
        head = camp["guards"].get(0)
        if head is None:
            continue
        guard_ids = {g["id"] for g in camp["guards"].values()}
        title = printable(head.get("title"))
        phases = []
        for n, g in sorted(camp["guards"].items()):
            if g["status"] != "blocked" or (n and not all(status.get(p) == "done" for p in parents.get(g["id"], []))):
                continue
            gt = printable(g.get("title"))
            phases.append({"phase": n, "name": gt.split("—", 1)[1].strip()[:120] if n and "—" in gt else "",
                           "count": sum(1 for c in children.get(g["id"], []) if c not in guard_ids)})
        work = camp["work"]
        out.append({"id": cid, "name": (title.split("—", 1)[1].strip() if "—" in title else title)[:120], "cards": len(work),
                    "done": bool(work) and all(w["status"] == "done" for w in work), "phases": phases})
    return out


def read_notify_extras(db_path: Path, slug: str, now: Optional[float] = None) -> dict:
    """What the notifier needs of one board beyond ``read_board``: ``{slug, blockedAt: {task: ts}, reviews, campaigns}``.
    ``reviews`` = ``[{task, event, ts, kind: "changes" | "blocked"}]``: a card a reviewer sent back (its latest review event is
    ``changes_requested``: ``kanban_request_changes``, ``kanban_db.py`` ``request_changes``), or a card a reviewer blocked
    ``needs_input`` (the ``blocked`` event's run was claimed from ``review``). Ids, kinds and times only: never a reason, a
    summary or a payload text."""
    now = time.time() if now is None else now
    out: dict = {"slug": slug, "blockedAt": {}, "reviews": [], "campaigns": []}
    if not Path(db_path).is_file():
        return out
    con = _ro(Path(db_path))
    try:
        have = _columns(con, "tasks")
        if not {"id", "title", "status"} <= have:
            return out
        cols = [c for c in ("id", "title", "status", "assignee", "idempotency_key", "created_by") if c in have]
        rows = [dict(zip(cols, r)) for r in con.execute(f"SELECT {', '.join(cols)} FROM tasks WHERE status != 'archived'")]
        if {"id", "task_id", "run_id", "kind", "payload", "created_at"} <= _columns(con, "task_events"):
            for r in rows:
                tid, status = r["id"], r["status"]
                if status == "blocked":
                    last = con.execute("SELECT id, run_id, payload, created_at FROM task_events WHERE task_id = ? AND kind = 'blocked' ORDER BY id DESC LIMIT 1", (tid,)).fetchone()
                    if not last or not isinstance(last[3], (int, float)):
                        continue
                    out["blockedAt"][tid] = int(last[3])
                    payload = _json_dict(last[2])
                    claimed = con.execute("SELECT payload FROM task_events WHERE task_id = ? AND kind = 'claimed' AND run_id = ? ORDER BY id DESC LIMIT 1", (tid, last[1])).fetchone() if last[1] is not None else None
                    if payload.get("kind") == "needs_input" and _json_dict(claimed[0] if claimed else None).get("source_status") == "review":
                        out["reviews"].append({"task": tid, "event": int(last[0]), "ts": int(last[3]), "kind": "blocked"})
                elif status in _ACTIVE_AFTER_REVIEW:
                    last = con.execute("SELECT id, kind, created_at FROM task_events WHERE task_id = ? AND kind IN ('changes_requested', 'review_requested', 'review_reopened', 'completed') ORDER BY id DESC LIMIT 1", (tid,)).fetchone()
                    if last and last[1] == "changes_requested" and isinstance(last[2], (int, float)) and now - last[2] <= REVIEW_WINDOW_S:
                        out["reviews"].append({"task": tid, "event": int(last[0]), "ts": int(last[2]), "kind": "changes"})
        if "idempotency_key" in cols and "created_by" in cols and {"parent_id", "child_id"} <= _columns(con, "task_links"):
            ids = {r["id"] for r in rows}
            out["campaigns"] = _campaigns_of(rows, [(p, c) for p, c in con.execute("SELECT parent_id, child_id FROM task_links") if p in ids and c in ids])
    finally:
        con.close()
    return out


def _json_dict(raw: Any) -> dict:
    try:
        value = json.loads(raw) if isinstance(raw, str) and raw else {}
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def hermes_notify_extras() -> list[dict]:
    """``read_notify_extras`` of every live board (a board that cannot be read is skipped: the notifier says nothing it cannot see)."""
    from hermes_cli.kanban_db_boards import list_boards
    out = []
    for meta in list_boards(include_archived=False):
        try:
            out.append(read_notify_extras(Path(meta["db_path"]), meta["slug"]))
        except sqlite3.Error as exc:
            log.debug("hermes-officecraft notify extras of %s unreadable: %s", _safe(meta["slug"]), type(exc).__name__)
    return out


# ---------------------------------------------------------------- ops
def read_gateway(state_file: Path) -> Optional[dict]:
    g = _read_json(state_file, "gateway", absent_ok=False)
    if not isinstance(g, dict):
        return None
    platforms: dict = g["platforms"] if isinstance(g.get("platforms"), dict) else {}
    return {"state": g.get("gateway_state"), "updatedAt": iso_to_epoch(g.get("updated_at")),
            "activeAgents": g.get("active_agents"),
            "platforms": [{"name": str(n), "state": (v or {}).get("state"), "needsAttention": bool((v or {}).get("needs_attention"))}
                          for n, v in platforms.items() if isinstance(v, dict) or v is None]}


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _cron_schedule_display(job: dict) -> Optional[str]:
    """Same fallbacks as ``cron/jobs.py::_schedule_display_for_job``: ``schedule_display``, else the
    schedule's ``display`` / ``value`` / ``expr`` / ``run_at``, else the schedule as text."""
    shown = _text(job.get("schedule_display"))
    if shown:
        return shown[:MODEL_NAME_MAX]
    schedule = job.get("schedule")
    if isinstance(schedule, dict):
        for key in ("display", "value", "expr", "run_at"):
            shown = _text(schedule.get(key))
            if shown:
                return shown[:MODEL_NAME_MAX]
        return None
    return str(schedule)[:MODEL_NAME_MAX] if schedule is not None else None


CRON_NAME_MAX = 120


TITLE_MAX = 300   # a card title Hermes accepts has no bound: what is cleaned and served has one


def _title(value: Any) -> str:
    return printable(value[:TITLE_MAX] if isinstance(value, str) else value)


NAME_MAX = 200   # an assignee or a pinned model is a name: drawn as text, cleaned and bounded like a title


def _name(value: Any) -> Optional[str]:
    return printable(value[:NAME_MAX]) or None if isinstance(value, str) else None


def printable(value: Any) -> str:
    """Text as the page may draw it: control, format and separator characters out (bidi overrides and isolates,
    zero-width, line breaks: they reorder or hide what is drawn after them), like ``replay._title``. A ZWNJ / ZWJ that
    joins two letters or two pictograms stays (``campaign._joiner_ok``, the rule of the writes), so a Persian title is drawn as written."""
    if not isinstance(value, str):
        return ""
    if value.isprintable():
        return value.strip()
    from .campaign import _joiner_ok   # late: only for a text that holds a non-printable character (campaign pulls in pydantic)
    cps = [ord(c) for c in value]
    return "".join(c for i, c in enumerate(value) if c.isprintable() or (cps[i] in (0x200C, 0x200D) and _joiner_ok(cps, i))).strip()


def _cron_name(job: dict) -> Optional[str]:
    """The job's name; when it has none, Hermes labels it from its prompt or script, which are never read here
    (privacy): the first skill name, else the job id, are used instead."""
    name = printable(job.get("name"))[:CRON_NAME_MAX]
    if name:
        return name
    skills = job.get("skills") if isinstance(job.get("skills"), list) else [job.get("skill")]
    for s in skills:
        if printable(s):
            return printable(s)[:50]
    return printable(job.get("id"))[:50] or None


def read_crons(jobs_file: Path, profile: str) -> list[dict]:
    raw = _read_json(jobs_file, f"cron:{_safe(profile)}")
    jobs = raw.get("jobs", []) if isinstance(raw, dict) else raw if isinstance(raw, list) else []
    out = []
    for j in jobs:
        if not isinstance(j, dict):
            continue
        c = {k: j.get(k) for k in CRON_FIELDS}
        c["name"] = _cron_name(j)
        c["schedule_display"] = _cron_schedule_display(j)
        for k in ("last_run_at", "next_run_at", "paused_at"):
            c[k] = iso_to_epoch(c[k])
        c["profile"] = profile
        out.append(c)
    return out


def read_ops(homes: Iterable[tuple[str, Path]], gateway_home: Path) -> dict:
    """Gateway of the home serving this backend + cron jobs of every profile home."""
    crons: list[dict] = []
    for name, home in homes:
        crons.extend(read_crons(Path(home) / "cron" / "jobs.json", name))
    return {"gateway": read_gateway(Path(gateway_home) / "gateway_state.json"), "crons": crons}


CRON_RUNS_PER_JOB = 120   # newest terminal executions kept per job (Hermes itself keeps at most 1000 per profile)
CRON_TERMINAL = ("completed", "failed", "missed", "unknown")   # `cancelled` is the user's doing, `claimed`/`running` are not over


def read_cron_runs(profile: str, home: Path, *, per_job: int = CRON_RUNS_PER_JOB) -> list[dict]:
    """The outcome history of one profile's cron jobs (``<home>/cron/executions.db``, table ``executions``,
    ``cron/executions.py:59``): per job (named like ``read_crons`` names it) the newest terminal executions as
    ``[finished epoch, 1 if completed else 0]``, oldest first. Job id, status and time only: never ``error``,
    ``output_file`` or a prompt. A missing or locked store gives ``[]`` (the game then has no cron achievement)."""
    db = Path(home) / "cron" / "executions.db"
    if not db.is_file():
        return []
    source = f"cron:{_safe(profile)}"
    names = {}
    raw = _read_json(Path(home) / "cron" / "jobs.json", source)
    for j in (raw.get("jobs", []) if isinstance(raw, dict) else raw if isinstance(raw, list) else []):
        if isinstance(j, dict) and isinstance(j.get("id"), str):
            names[j["id"]] = _cron_name(j)
    try:
        con = _ro(db)
    except sqlite3.Error as exc:
        flag(source, classify(exc))
        return []
    out: dict[str, list] = {}
    try:
        if not {"job_id", "status", "finished_at", "claimed_at"} <= _columns(con, "executions"):
            flag(source, "schema")
            return []
        marks = ",".join("?" * len(CRON_TERMINAL))
        for job_id, status, finished, claimed in con.execute(
                f"SELECT job_id, status, finished_at, claimed_at FROM executions WHERE status IN ({marks}) "
                "ORDER BY julianday(coalesce(finished_at, claimed_at))", CRON_TERMINAL):
            at = iso_to_epoch(finished) or iso_to_epoch(claimed)
            if at is not None and names.get(job_id):
                out.setdefault(job_id, []).append([at, 1 if status == "completed" else 0])
    except sqlite3.Error as exc:
        flag(source, classify(exc))
        return []
    finally:
        con.close()
    return [{"profile": profile, "name": names[j], "runs": runs[-per_job:]} for j, runs in out.items()]


def hermes_cron_runs() -> list[dict]:
    from hermes_cli.profiles import list_profiles
    out: list[dict] = []
    for p in list_profiles(lazy_skill_count=True):
        out.extend(read_cron_runs(p.name, Path(p.path)))
    return out


# ---------------------------------------------------------------- skills
def _tags(fm: dict) -> list[str]:
    meta: dict = fm["metadata"] if isinstance(fm.get("metadata"), dict) else {}
    hermes: dict = meta["hermes"] if isinstance(meta.get("hermes"), dict) else {}
    raw = hermes.get("tags") or fm.get("tags") or []
    return [str(x).strip().lower() for x in raw if str(x).strip()][:8] if isinstance(raw, list) else []


# Bundled skills are copied into every profile, so most headers repeat. Parsing YAML is the slow part of
# ``/history`` (hundreds of headers): identical headers are parsed once. Only the tags are kept (never the description).
_TAGS_CACHE: dict[str, tuple[str, tuple[str, ...]]] = {}   # header text -> (declared name, tags)
_TAGS_CACHE_MAX = 4096


def _header_info(md: Path, loader) -> tuple[str, list[str]]:
    """``(declared name, tags)`` from the SKILL.md YAML header only (between the first two ``---``);
    the body is never parsed. Hermes matches ``skills.disabled`` against the declared name."""
    try:
        with open(md, encoding="utf-8", errors="replace") as fh:
            head = fh.read(16_384)
    except OSError:
        return "", []
    if not head.startswith("---"):
        return "", []
    end = head.find("\n---", 3)
    if end < 0:
        return "", []
    raw = head[3:end]
    hit = _TAGS_CACHE.get(raw)
    if hit is None:
        try:
            data = loader(raw)
        except Exception:
            data = {}
        declared = data.get("name") if isinstance(data, dict) else None
        hit = (declared.strip() if isinstance(declared, str) else "", tuple(_tags(data) if isinstance(data, dict) else []))
        if len(_TAGS_CACHE) >= _TAGS_CACHE_MAX:
            _TAGS_CACHE.clear()
        _TAGS_CACHE[raw] = hit
    return hit[0], list(hit[1])


def _header_tags(md: Path, loader) -> list[str]:
    return _header_info(md, loader)[1]


def read_profile_config(profile_dir: Path, loader) -> dict:
    """One bot's ``config.yaml``, parsed ONCE per read: ``read_skills`` (disabled list) and
    ``read_default_model`` (model block) both need it, and parsing 13 files three times each was a
    third of the cold ``/history``. An unreadable or non-mapping file is ``{}`` (both callers already
    treat that as "nothing configured"), never a raise."""
    try:
        cfg = loader((Path(profile_dir) / "config.yaml").read_text(encoding="utf-8")) or {}
    except Exception:
        return {}
    return cfg if isinstance(cfg, dict) else {}


def read_skills(profile_dir: Path, loader, cfg: Optional[dict] = None) -> dict:
    """Per skill: folder name, category (parent folder), header tags, enabled, mtime.
    ``loader`` parses YAML (``hermes_yaml.safe_load`` in Hermes); ``cfg`` is the already parsed
    ``config.yaml`` (:func:`read_profile_config`) when the caller read it for another field."""
    skills_dir = Path(profile_dir) / "skills"
    if cfg is None:
        cfg = read_profile_config(profile_dir, loader)
    sk: dict = cfg["skills"] if isinstance(cfg.get("skills"), dict) else {}
    disabled = {str(x).lower() for x in sk.get("disabled") or []} if isinstance(sk.get("disabled"), list) else set()
    items = []
    if skills_dir.is_dir():
        for md in skills_dir.rglob("SKILL.md"):
            rel = md.parent.relative_to(skills_dir).parts
            if any(p.startswith((".", "_")) for p in rel):
                continue
            try:
                mtime = md.stat().st_mtime
            except OSError:
                continue
            declared, tags = _header_info(md, loader)
            off = md.parent.name.lower() in disabled or (bool(declared) and declared.lower() in disabled)
            items.append({"name": md.parent.name, "category": rel[0] if len(rel) > 1 else "",
                          "tags": tags, "enabled": not off, "mtime": mtime})
    items.sort(key=lambda i: i["mtime"], reverse=True)
    manifest = skills_dir / ".bundled_manifest"
    try:
        bundled = [ln.split(":", 1)[0].strip() for ln in manifest.read_text(encoding="utf-8").splitlines() if ln.strip()]
    except (OSError, UnicodeError):   # a non-UTF-8 manifest costs the list, not the whole /history
        bundled = []
    return {"items": items, "bundled": bundled}


def shape_skills(raw_by_profile: dict[str, dict]) -> dict[str, dict]:
    """``own`` = what says something about a bot: all its skills when it kept a short list; otherwise
    those Hermes did not seed itself and that at most a third of the profiles hold."""
    bundled = {n for r in raw_by_profile.values() for n in r.get("bundled", [])}
    held = Counter(i["name"] for r in raw_by_profile.values() for i in r["items"])
    cap = max(1, len(raw_by_profile) // 3)
    out = {}
    for name, r in raw_by_profile.items():
        items = r["items"]
        on = [i for i in items if i["enabled"]]
        small = len(on) <= SMALL_SKILL_SET
        mine = [i for i in sorted(on, key=lambda i: i["name"]) if small or (held[i["name"]] <= cap and i["name"] not in bundled)]
        out[name] = {
            "count": len(items), "enabled": len(on), "disabled": len(items) - len(on),
            "categories": dict(Counter(i["category"] or "other" for i in on).most_common()),
            "own": [{k: i[k] for k in ("name", "category", "tags")} for i in mine][:OWN_SKILLS_MAX],
            "names": [i["name"] for i in mine][:OWN_SKILLS_MAX],
            # newest of the bot's OWN skills (a Hermes update re-syncs bundled skills on every profile: noise, not a fact about the bot)
            "recent": [{"name": i["name"], "mtime": i["mtime"]} for i in sorted(mine, key=lambda i: i["mtime"], reverse=True)[:3] if i["name"] not in bundled],
        }
    return out


# ---------------------------------------------------------------- profiles
def _stats_read(db_path: Path, timeout: float = DB_TIMEOUT_S) -> tuple[dict, Optional[str]]:
    """``(aggregates, reason)``: one bot's aggregates, or ``({}, why)`` (a word of REASONS). Flags nothing, so it
    may run in a pool thread (the partial scope is the caller's)."""
    if not Path(db_path).is_file():
        return {}, None
    try:
        con = _ro(Path(db_path), timeout)
        try:
            have = _columns(con, "sessions")
            if not {"started_at", "input_tokens", "cache_read_tokens"} <= have:
                return {}, "schema"
            first, inp, cache = con.execute(
                "SELECT min(started_at), coalesce(sum(input_tokens),0), coalesce(sum(cache_read_tokens),0) FROM sessions").fetchone()
        finally:
            con.close()
    except sqlite3.Error as exc:
        return {}, classify(exc)   # a locked or damaged sessions file costs this bot its aggregates, never the whole read
    return {"firstSeen": first, "inputTokens": inp, "cacheReadTokens": cache}, None


def session_stats(db_path: Path, timeout: float = DB_TIMEOUT_S, source: Optional[str] = None) -> dict:
    """Aggregates only: first activity and token totals (no titles, no content). ``source`` names the bot
    (``sessions:<profile>``) for the ``partial`` flag when its store cannot be read."""
    stats, reason = _stats_read(db_path, timeout)
    if reason and source:
        flag(source, reason)
    return stats


def _session_pool() -> ThreadPoolExecutor:
    global _SESSION_POOL
    with _SESSION_POOL_LOCK:
        if _SESSION_POOL is None:
            _SESSION_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="officecraft-sessions")
        return _SESSION_POOL


_FAST_SESSION_COLUMNS = frozenset({"id", "source", "title", "started_at", "last_activity_at", "message_count",
                                   "parent_session_id", "archived", "hidden", "model"})
_EPOCH_LO, _EPOCH_HI = 946_684_800.0, 4_102_444_800.0   # 2000..2100: a garbage double salvaged from a damaged page is not a time
_RANK_WINDOW = 5   # newest rows by heartbeat stamp re-ranked on the freshest of stamp and last message


def _epoch(value: Any) -> Optional[float]:
    return float(value) if isinstance(value, (int, float)) and _EPOCH_LO <= value <= _EPOCH_HI else None


def _fast_session_refs(db_path: Path, hidden: frozenset) -> Optional[tuple]:
    """``(newest human, newest worker, newest non-empty human)`` of one bot from three indexed ``LIMIT 1``
    reads on ``sessions`` (~1 ms each on 80-350 MB stores), not through ``SessionDB.list_sessions_rich``
    (a recursive CTE + preview subquery + ``flush_for_read`` per bot: 25-100 ms each, enough to spend the
    whole session budget). Same split as Hermes's ``_latest_profile_session_rows`` (``tui_gateway/methods_profiles.py:199``):
    ``source`` in ``INTERNAL_LISTING_SOURCES`` = worker, otherwise human; same order as the listing
    (``COALESCE(last_activity_at, started_at)`` DESC, index ``idx_sessions_effective_activity``,
    ``hermes_state_common.py:901``); archived and hidden rows are left out (``hermes_state_sessions.py:114-153``,
    ``:1332``). Roots only (``parent_session_id IS NULL``): sub-agent runs and compression continuations are not
    listed by Hermes; branch/reset children and the projection of a compression chain onto its tip are not
    followed (the root of such a chain is served: same conversation, older ``last_active``).
    ``last_active`` is the freshest of the row's activity stamp and its newest message (``idx_messages_session``,
    one seek), as ``hermes_state_common.py:260-269`` does. Never a ``preview``, never a message.
    ``None`` = a schema this reader does not know (the caller falls back to Hermes's reader)."""
    con = _ro(Path(db_path), DB_TIMEOUT_S)
    try:
        if not _FAST_SESSION_COLUMNS <= _columns(con, "sessions"):
            return None
        marks = ",".join("?" for _ in hidden)
        base = ("SELECT id, source, title, started_at, last_activity_at, message_count, model FROM sessions"
                " WHERE parent_session_id IS NULL AND archived = 0 AND hidden = 0 AND source {op} (" + marks + ")")
        # the index ranks by the heartbeat stamp, which lags a newer message by up to ~60 s; Hermes ranks by
        # the freshest of both. The few newest rows by stamp are re-ranked here on that same freshest value.
        tail = f" ORDER BY COALESCE(last_activity_at, started_at) DESC, started_at DESC LIMIT {_RANK_WINDOW}"
        params = sorted(hidden)

        def ref_of(row) -> dict:
            sid, source, title, started, active, count, model = row
            seen = [t for t in (_epoch(active), _epoch(started)) if t is not None]
            try:   # out-of-window cells are skipped inside the MAX, as Hermes does (hermes_state_common.py:262-268)
                last_msg = _epoch(con.execute("SELECT MAX(timestamp) FROM messages WHERE session_id = ? AND timestamp"
                                              " BETWEEN ? AND ?", (sid, _EPOCH_LO, _EPOCH_HI)).fetchone()[0])
            except sqlite3.OperationalError:
                last_msg = None   # no messages table on this store: the activity stamp stands
            if last_msg is not None:
                seen.append(last_msg)
            return {"id": sid, "title": (title or "")[:TITLE_MAX], "last_active": max(seen) if seen else 0,
                    "source": (source or "").strip().lower(), "model": model, "_started": _epoch(started) or 0,
                    "count": count if isinstance(count, int) and count > 0 else 0}

        def newest(op: str, extra: str = "") -> Optional[dict]:
            refs = [ref_of(row) for row in con.execute(base.format(op=op) + extra + tail, params).fetchall()]
            return max(refs, key=lambda r: (r["last_active"], r["_started"])) if refs else None

        human = newest("NOT IN")
        worker = newest("IN")
        nonempty = newest("NOT IN", " AND message_count > 0") if not (human and human["count"] > 0) else human
    finally:
        con.close()

    def plain(ref: Optional[dict]) -> Optional[dict]:
        return None if ref is None else {"title": ref["title"], "last_active": ref["last_active"], "source": ref["source"]}

    worker_ref = plain(worker)
    if worker_ref is not None and worker is not None and isinstance(worker["model"], str) and worker["model"].strip():
        worker_ref["model"] = worker["model"].strip()[:MODEL_NAME_MAX]
    return (plain(human), worker_ref, _non_empty_ref(nonempty))


def _non_empty_ref(ref: Optional[dict]) -> Optional[dict]:
    """The only five facts served about a bot's newest conversation that has messages
    (``lastNonEmptySession``): an id to open it, its title, its recency, how many messages it holds. No content."""
    if not ref:
        return None
    sid = ref.get("id")
    if not isinstance(sid, str) or not sid:
        return None
    count = ref.get("count", ref.get("message_count"))
    if not isinstance(count, int) or count <= 0:
        return None
    return {"id": sid[:200], "title": str(ref.get("title") or "")[:300], "last_active": ref.get("last_active") or 0,
            "message_count": count}


def _session_refs(db_path: Path, denied: Callable[[dict], bool], hidden: Optional[frozenset] = None) -> tuple:
    """``(newest human, newest worker, newest non-empty human)`` session refs of one bot. The fast indexed read
    (:func:`_fast_session_refs`) first; Hermes's own reader (``list_sessions_rich``, the 20 newest rows) when the
    store's schema is not the one the fast read knows. In that fallback the non-empty one is looked for among those
    20 rows only."""
    fast = _fast_session_refs(Path(db_path), hidden if hidden is not None else listing_sources())
    if fast is not None:
        return fast
    from hermes_state import SessionDB
    human = worker = nonempty = None
    db = SessionDB(db_path=db_path, read_only=True)
    try:
        for s in db.list_sessions_rich(source=None, limit=20, order_by_last_active=True, compact_rows=True):
            ref = {"title": str(s.get("title") or "")[:TITLE_MAX], "last_active": s.get("last_active") or s.get("started_at") or 0,
                   "source": (s.get("source") or "").lower()}
            if denied(s):
                m = s.get("model")   # sessions.model: the model the session ran with (name only, never model_config)
                if isinstance(m, str) and m.strip():
                    ref["model"] = m.strip()[:120]
                worker = worker or ref
            else:
                human = human or ref
                if nonempty is None:
                    nonempty = _non_empty_ref({"id": s.get("id"), "title": s.get("title"), "last_active": ref["last_active"],
                                               "message_count": s.get("message_count")})
            if human and worker and nonempty:
                break
    finally:
        db.close()
    return human, worker, nonempty


def _bot_session_job(db_path: Path, denied: Callable[[dict], bool], hidden: Optional[frozenset], started: list) -> tuple:
    """Everything one bot's session phase needs in ONE pool task: ``(refs, stats, reasons)``. Inside the
    gateway each pass through the pool is a GIL hand-over to a busy process (a ~4 ms read took up to 0.5 s over
    a dozen bots, twice per bot); the fast read and the aggregates share one. ``started`` receives the moment the
    task really began (a task still queued behind the pool is not a slow store)."""
    started.append(time.monotonic())
    refs = None
    reasons: list[str] = []
    try:
        refs = _session_refs(db_path, denied, hidden)
    except Exception as exc:   # noqa: BLE001 - a broken store costs that bot its sessions, never the read
        reasons.append(classify(exc))
    stats, why = _stats_read(db_path, DB_TIMEOUT_S)
    if why:
        reasons.append(why)
    return refs, stats, reasons


def read_bot_sessions(db_path: Path, denied: Callable[[dict], bool], *, timeout: float,
                      source: Optional[str] = None, hidden: Optional[frozenset] = None) -> Optional[tuple]:
    """Bounded session read of one bot: ``(refs, stats)``, or ``None`` = no answer in time. Hermes's ``SessionDB``
    gives up on a busy ``state.db`` after 5 s, which on a dozen bots is most of a minute; here the wait is the caller's
    ``timeout`` and the route still answers. A bot that did not answer is flagged ``locked`` for THIS read. It is
    left alone for :data:`SLOW_SESSION_SKIP_S` only when its task really ran for (almost) a whole
    :data:`SESSION_READ_TIMEOUT_S` slot: a bot cut for lack of time, or still queued behind the pool, did nothing
    wrong and is read again on the next call."""
    key = str(Path(db_path).resolve())
    started: list = []
    try:
        future = _session_pool().submit(_bot_session_job, Path(db_path), denied, hidden, started)
    except RuntimeError:      # interpreter shutting down: no thread to run it on
        return None
    try:
        refs, stats, reasons = future.result(timeout=max(timeout, 0.01))
    except FutureTimeout:
        if source:
            flag(source, "locked")
        ran = (time.monotonic() - started[0]) if started else 0.0
        if ran >= 0.8 * SESSION_READ_TIMEOUT_S:
            _SLOW_SESSIONS[key] = time.time() + SLOW_SESSION_SKIP_S
            log.warning("hermes-officecraft: %s did not answer within %.2fs (task ran %.2fs); its sessions are skipped", key, timeout, ran)
        else:
            log.info("hermes-officecraft: %s not read in time (%.2fs slot, task ran %.2fs); read again next call", key, timeout, ran)
        return None
    except Exception as exc:   # noqa: BLE001
        if source:
            flag(source, classify(exc))
        return None
    if source:
        for reason in dict.fromkeys(reasons):
            flag(source, reason)
    return refs, stats



def listing_sources() -> frozenset[str]:
    """Sources Hermes hides from every human session picker (kanban workers, tools, one-shot runs).

    Read from Hermes's public constant ``hermes_state_sessions.INTERNAL_LISTING_SOURCES`` (the same one
    ``tui_gateway.methods_session._denied_source`` is built on); when it moves or disappears, the literal
    below (its value on the verified base) is used instead of failing the whole ``/history``."""
    try:
        from hermes_state_sessions import INTERNAL_LISTING_SOURCES
        return frozenset(str(s).strip().lower() for s in INTERNAL_LISTING_SOURCES)
    except Exception:   # noqa: BLE001 - ImportError, or a renamed/reshaped constant
        return frozenset(INTERNAL_LISTING_FALLBACK)


def listing_denied(row: dict) -> bool:
    """True for a session that is not a human conversation (a worker's, a tool's)."""
    return (row.get("source") or "").strip().lower() in listing_sources()


def _model_name(value: Any) -> Optional[str]:
    """A model or provider name as written; None when absent (never a dict, never a path)."""
    if not isinstance(value, str):
        return None
    return value.strip()[:MODEL_NAME_MAX] or None


def read_default_model(profile_dir: Path, loader, cfg: Optional[dict] = None) -> tuple[Optional[str], Optional[str]]:
    """``(model, provider)`` of a bot, read from its RAW ``config.yaml`` — the same rules as
    ``hermes_cli/profiles.py::_read_config_model`` (raw file, no defaults merged):
    ``model`` as a string is the model; otherwise ``model.default`` or ``model.model``, and
    ``model.provider``. Only those two names are returned: no other config key leaves here
    (``api_key``, ``base_url``, ``model_config``…), and nothing at all when the file is missing
    or unreadable. ``loader`` parses YAML (``hermes_yaml.safe_load`` in Hermes); ``cfg`` is the
    already parsed ``config.yaml`` when the caller read it for another field."""
    if cfg is None:
        cfg = read_profile_config(profile_dir, loader)
    model_cfg = cfg.get("model") if isinstance(cfg, dict) else None
    if isinstance(model_cfg, str):
        return _model_name(model_cfg), None
    if isinstance(model_cfg, dict):
        return _model_name(model_cfg.get("default") or model_cfg.get("model")), _model_name(model_cfg.get("provider"))
    return None, None


def _session_facts(profiles) -> dict[str, dict]:
    """Session facts of every bot, read in a phase of their own.

    The budget (:data:`SESSIONS_BUDGET_S`) covers this loop and nothing else: the per-bot
    ``config.yaml``/skills reads (~0.1 s each, over a second for a dozen bots) run in another phase and are
    never charged to the same deadline (they would spend it before the last bots are read). Only a
    state.db that really is wedged may cost its bot its session facts.
    """
    hidden = listing_sources()          # once per read, not once per session row
    _denied = lambda row: (row.get("source") or "").strip().lower() in hidden   # noqa: E731
    out: dict[str, dict] = {}
    roster = list(profiles)
    # the budget grows with the roster (with a constant one, past ~35 bots the LAST ones would lose their
    # session facts on every call), and the starting bot rotates, so when a store is slow the loss is
    # shared between rounds instead of always falling on the same bots.
    deadline = time.monotonic() + max(SESSIONS_BUDGET_S, SESSION_PER_BOT_S * len(roster))
    hard_deadline = deadline + SESSIONS_GRACE_S
    if roster:
        start = next(_ROTATION) % len(roster)
        roster = roster[start:] + roster[:start]
    for p in roster:
        human = worker = nonempty = None
        stats: dict = {}
        db_path = Path(p.path) / "state.db"
        source = f"sessions:{_safe(p.name)}"
        if db_path.is_file():
            if time.time() < _SLOW_SESSIONS.get(str(db_path.resolve()), 0.0):
                flag(source, "locked")   # a state.db whose task really ran a whole slot is left alone for a while
            else:
                # one pool task per bot (refs + aggregates). Inside the budget a bot gets a whole slot; past
                # it, a short one inside the grace time. Only the bots that still do not answer are flagged, one by
                # one, for this read only (never the whole tail at once, never a 30 s skip for lack of time).
                now = time.monotonic()
                slot = max(min(SESSION_READ_TIMEOUT_S, deadline - now), min(SESSION_LATE_SLOT_S, hard_deadline - now))
                if slot <= 0:
                    flag(source, "locked")
                else:
                    got = read_bot_sessions(db_path, _denied, timeout=slot, source=source, hidden=hidden)
                    if got:
                        refs, stats = got
                        human, worker, nonempty = refs or (None, None, None)
        out[p.name] = {"lastSession": human, "lastNonEmptySession": nonempty, "worker": worker, "stats": stats}
    return out


def hermes_profiles(*, sessions: bool = True) -> list[dict]:
    """Roster with the newest human and worker session (title + time + source only), session
    aggregates and shaped skills. Same split as ``profiles.list`` (the gateway's deny-list).

    Every optional read is bounded (:data:`DB_TIMEOUT_S`, :data:`SESSION_READ_TIMEOUT_S`,
    :data:`SESSIONS_BUDGET_S`): a bot whose store is locked or mid-checkpoint keeps its name, its
    role, its skills and its model and loses only the session facts of this round, so ``/history``
    always answers inside the front's timeout instead of queueing 5 s per bot behind Hermes's own
    reader. Sessions and skills/config are read in two separate phases (:func:`_session_facts`),
    so the file reads never spend the session budget. The phase breakdown is logged when the read
    is slow (the next slow one is diagnosable).
    """
    import hermes_yaml
    from hermes_cli.profiles import list_profiles
    t_start = time.perf_counter()
    t_roster = t_sessions = t_files = 0.0
    rows, raw_skills = [], {}
    t0 = time.perf_counter()
    roster = list_profiles(lazy_skill_count=True)
    t_roster = time.perf_counter() - t0
    t0 = time.perf_counter()
    try:
        facts = _session_facts(roster) if sessions else {}
    except Exception as exc:   # noqa: BLE001 - the session facts are optional: roster, skills and models are still served
        log.warning("hermes-officecraft: session facts unavailable (%s: %s)", type(exc).__name__, exc)
        flag("sessions", "unreadable")
        facts = {}
    t_sessions = time.perf_counter() - t0
    for p in roster:
        home = Path(p.path)
        t0 = time.perf_counter()
        cfg = read_profile_config(home, hermes_yaml.safe_load)
        raw_skills[p.name] = read_skills(home, hermes_yaml.safe_load, cfg)
        default_model, default_provider = read_default_model(home, hermes_yaml.safe_load, cfg)
        t_files += time.perf_counter() - t0
        session_facts_of_bot = facts.get(p.name, {})
        rows.append({"name": p.name, "isDefault": bool(p.is_default), "model": p.model or "", "provider": p.provider or "",
                     # read here from the raw config.yaml: `profiles.list` sends an empty model for
                     # non-default bots in the webapp, so the roster alone cannot tell the default
                     "defaultModel": default_model, "defaultProvider": default_provider,
                     "description": (getattr(p, "description", "") or "")[:DESCRIPTION_MAX],
                     "lastSession": session_facts_of_bot.get("lastSession"),
                     "lastNonEmptySession": session_facts_of_bot.get("lastNonEmptySession"),
                     "worker": session_facts_of_bot.get("worker"),
                     "workerModel": (session_facts_of_bot.get("worker") or {}).get("model"),
                     "stats": session_facts_of_bot.get("stats") or {}})
    shaped = shape_skills(raw_skills)
    for r in rows:
        r["skills"] = shaped.get(r["name"], {})
    total = time.perf_counter() - t_start
    if total > SLOW_READ_LOG_S:
        log.warning("hermes-officecraft: /history over %d bots took %.2fs (roster %.2fs, sessions %.2fs, skills+config %.2fs)",
                    len(roster), total, t_roster, t_sessions, t_files)
    return rows


def hermes_ops() -> dict:
    from hermes_cli.profiles import list_profiles
    from hermes_constants import get_hermes_home
    homes = [(p.name, Path(p.path)) for p in list_profiles(lazy_skill_count=True)]
    return read_ops(homes, get_hermes_home())


def hermes_snapshot(*, history: bool = True) -> dict:
    """Everything the office draws, in one object."""
    return {"kind": "snapshot", "generatedAt": time.time(), "profiles": hermes_profiles(sessions=history),
            "boards": hermes_boards(history=history), "ops": hermes_ops()}
