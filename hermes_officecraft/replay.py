"""``GET /replay``: what happened, as FACTS, so the page can show the office as it was at any instant.

Read-only, whitelisted: the kanban events of every
board (kind, time, card, the state they lead to, ONE small extra per kind), the runs, the silences between two heartbeats,
the audit journal, the sessions outside the kanban and the cron executions. Never a payload, a body, a comment, a result,
a message, a prompt, a path or a session id: the ``task_events.payload`` is parsed in this process to read the few
whitelisted keys below and is dropped at once.

The state of a card at T is the last state its events (up to T) lead to: the fold table (``next_status``, checked
against the code of the transitions in ``hermes_cli/kanban_db*.py``). Who works where at T is read on ``task_runs``, never
on the replayed state (a run opened without a ``claimed`` event exists). A source that cannot be read is served empty AND
named in ``partial``.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

from . import audit, snapshot, usage

log = logging.getLogger(__name__)

MAX_WINDOW_S = 7 * 86_400
FUTURE_SLACK_S = 60
LIMITS = {"facts": 5000, "runs": 2000, "sessions": 2000, "crons": 1000, "orders": 500}
TITLE_MAX = 120
SILENCE_S = 300   # five minutes without a sign of life
BOARD_TIMEOUT_S = 1.0

STATUSES = ("todo", "ready", "running", "blocked", "review", "triage", "scheduled", "done", "archived")
OPEN_STATUSES = tuple(s for s in STATUSES if s not in ("done", "archived"))
BLOCK_KINDS = ("dependency", "needs_input", "capability", "transient")   # hermes_cli/kanban_db.py:111 (VALID_BLOCK_KINDS)
OUTCOMES = ("completed", "blocked", "crashed", "timed_out", "spawn_failed", "gave_up", "reclaimed", "rate_limited",
            "scheduled", "review_requested")
# the kinds served: everything that changes a card's state (the page cannot replay without them) + three facts that do not
SERVED_KINDS = frozenset((
    "created", "assigned", "claimed", "completed", "blocked", "block_loop_detected", "gave_up", "unblocked", "promoted",
    "promoted_manual", "dependency_wait", "specified", "status", "scheduled", "review_requested", "changes_requested",
    "review_reopened", "archived", "timed_out", "crashed", "rate_limited", "reclaimed", "spawn_failed", "stale",
    "reconciled", "decomposed", "claim_rejected", "commented", "linked", "unlinked"))
RETRY_KINDS = frozenset(("timed_out", "crashed", "rate_limited", "reclaimed", "spawn_failed", "stale"))
# the kinds whose payload `next_status`, `_extra`, `_assignee_after` or the session link read: no other is loaded
PAYLOAD_KINDS = ("created", "promoted", "unblocked", "status", "changes_requested", "blocked", "assigned", "linked", "unlinked",
                 "owner_admitted", *sorted(RETRY_KINDS))
_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
_PROFILE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_SESSION_SOURCE_RE = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")


# ------------------------------------------------------------------ the fold
def next_status(kind: str, payload: Any, cur: Optional[str]) -> Optional[str]:
    """The state a card is in after one event of ``kind`` (``payload`` = the parsed JSON or None), given the state before.
    Mirrors the transitions of ``kanban_db*.py``; unknown kinds and unknown states leave the state as it was."""
    p = payload if isinstance(payload, dict) else {}
    named = p.get("status") if isinstance(p.get("status"), str) and p.get("status") in STATUSES else None
    if kind == "created":
        return named or "todo"
    if kind == "promoted":
        return named or "ready"
    if kind in ("promoted_manual", "review_reopened", "reconciled"):
        return "ready"
    if kind == "claimed":
        return "running"
    if kind == "completed":
        return "done"
    if kind == "blocked":
        if p.get("classified_in_place"):
            return cur
        return "todo" if p.get("kind") == "dependency" else "blocked"
    if kind == "block_loop_detected":
        return "triage"
    if kind == "gave_up":
        return "blocked"
    if kind == "unblocked":
        return named or "ready"
    if kind in ("dependency_wait", "specified", "decomposed", "claim_rejected"):
        return "todo"
    if kind == "status":
        return named or cur
    if kind == "archived":
        return "archived"
    if kind == "scheduled":
        return "scheduled"
    if kind == "review_requested":
        return "review"
    if kind == "changes_requested":
        return named or "ready"
    if kind in RETRY_KINDS:
        retry = p.get("retry_status") if isinstance(p.get("retry_status"), str) and p.get("retry_status") in STATUSES else None
        # the code only moves a card that is still `running` (WHERE status = 'running'); a manual reclaim moves it from anywhere
        if retry and (cur == "running" or (kind == "reclaimed" and p.get("manual") is True)):
            return retry
        return cur
    return cur


def _extra(kind: str, payload: Any, task: str) -> Optional[str]:
    """The ONE extra a kind may carry (whitelist): the profile of an assignment, the type of a block, the other card of a link."""
    p = payload if isinstance(payload, dict) else {}
    if kind in ("created", "assigned"):
        # the assignee at T is replayed from
        # `created.payload.assignee`, then `assigned.payload.assignee`; a card created in the window with an agent has one
        who = p.get("assignee")
        return who if isinstance(who, str) and _PROFILE_RE.fullmatch(who) else None
    if kind == "blocked":
        why = p.get("kind")
        return why if isinstance(why, str) and why in BLOCK_KINDS else None
    if kind in ("linked", "unlinked"):
        other = p.get("parent") if p.get("child") == task else p.get("child") if p.get("parent") == task else None
        return other if isinstance(other, str) and _ID_RE.fullmatch(other) and other != task else None
    return None


def _assignee_after(kind: str, payload: Any, cur: Optional[str]) -> Optional[str]:
    p = payload if isinstance(payload, dict) else {}
    if kind in ("created", "assigned"):
        who = p.get("assignee")
        if kind == "assigned" or "assignee" in p:
            return who if isinstance(who, str) and _PROFILE_RE.fullmatch(who) else None
    return cur


def _title(value: Any) -> str:
    return snapshot.printable(str(value or ""))[:TITLE_MAX]   # a joining ZWNJ / ZWJ stays, as in /office


def _loads(text: Any) -> Any:
    if not isinstance(text, str) or not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return None


# ------------------------------------------------------------------ one board
def read_board_replay(db_path: Path, slug: str, frm: int, to: int, *, now: Optional[float] = None,
                      session_usage: Optional[Callable] = None) -> Optional[dict]:
    """One board over ``[frm, to]``: ``{slug, since, start, cards, facts, runs, silences}`` or None when the board
    cannot be read (flagged ``kanban:<slug>``). ``session_usage(profile, [session ids], source) -> ({id: usage}, reason)``
    joins the runs to their usage (the caller opens each profile's state.db once for all boards)."""
    now = time.time() if now is None else now
    source = f"kanban:{snapshot._safe(slug)}"
    if not Path(db_path).is_file():
        snapshot.flag(source, "missing")
        return None
    try:
        con = snapshot._ro(Path(db_path), BOARD_TIMEOUT_S)
    except sqlite3.Error as exc:
        snapshot.flag(source, snapshot.classify(exc))
        return None
    try:
        task_cols, event_cols, run_cols = (snapshot._columns(con, t) for t in ("tasks", "task_events", "task_runs"))
        if not ({"id", "title"} <= task_cols and {"id", "task_id", "run_id", "kind", "payload", "created_at"} <= event_cols
                and {"id", "task_id", "profile", "started_at", "ended_at", "outcome"} <= run_cols):
            snapshot.flag(source, "schema")   # the tables exist but are no longer the ones Hermes writes
            return None
        titles: dict[str, str] = {}
        state: dict[str, Optional[str]] = {}
        who: dict[str, Optional[str]] = {}
        wanted_cards: set = set()
        start_snapshot: Optional[list] = None
        facts: list = []
        sessions_of_run: dict[int, str] = {}
        runs = _runs_in_window(con, frm, to, now)
        wanted = {r["id"] for r in runs}
        beats: dict[int, list[int]] = defaultdict(list)

        def take_snapshot():
            return [[t, s, who.get(t)] for t, s in state.items() if s in OPEN_STATUSES]

        # only the heartbeats of the window's runs (two thirds of the rows) and only the payloads the fold reads are
        # loaded; a content payload (`worker_result.last_output`, `completed.summary`...) never enters this process
        if wanted:
            for run_id, ts in con.execute("SELECT run_id, created_at FROM task_events WHERE kind = 'heartbeat' AND run_id BETWEEN ? AND ?",
                                          (min(wanted), max(wanted))):
                if run_id in wanted and (ts := snapshot.task_epoch(ts)) is not None:
                    beats[run_id].append(ts)
        since: Optional[int] = snapshot.task_epoch(con.execute("SELECT min(created_at) FROM task_events WHERE kind = 'heartbeat'").fetchone()[0])
        for tid, run_id, kind, payload, ts in con.execute(
                f"SELECT task_id, run_id, kind, CASE WHEN kind IN ({','.join('?' * len(PAYLOAD_KINDS))}) THEN payload END, created_at "
                "FROM task_events WHERE kind != 'heartbeat' ORDER BY id", PAYLOAD_KINDS):
            ts = snapshot.task_epoch(ts)
            if ts is None or not isinstance(tid, str):
                continue
            since = ts if since is None else min(since, ts)
            if kind == "owner_admitted":   # read before the `to` cut: a run opened just before `to` is admitted seconds later
                pl = _loads(payload) if run_id in wanted else None
                if isinstance(pl, dict) and isinstance(pl.get("session_id"), str):
                    sessions_of_run[run_id] = pl["session_id"]
                continue
            if ts > to:
                continue
            if start_snapshot is None and ts >= frm:
                start_snapshot = take_snapshot()
            pl = _loads(payload)
            before = state.get(tid)
            after = next_status(kind, pl, before)
            state[tid] = after
            who[tid] = _assignee_after(kind, pl, who.get(tid))
            if kind in SERVED_KINDS and frm <= ts <= to:
                facts.append([ts, tid, kind, after if (after != before and after in STATUSES) else None, _extra(kind, pl, tid)])
        if start_snapshot is None:
            start_snapshot = take_snapshot()
        wanted_cards = {t for t, _, _ in start_snapshot} | {f[1] for f in facts} | {r["task"] for r in runs}
        for tid, title in _titles(con, wanted_cards):
            titles[tid] = _title(title)
        silences = _silences(runs, beats, frm, to, now)
        usage_of = session_usage(runs, sessions_of_run) if session_usage else {}
        out_runs = []
        for r in runs:
            u, why = usage_of.get(r["id"], (None, "no_session_link" if r["id"] not in sessions_of_run else "no_usage"))
            row = {"start": r["start"], "end": r["end"], "profile": r["profile"], "task": r["task"], "outcome": r["outcome"],
                   "usage": u}
            if u is None:
                row["why"] = why
            out_runs.append(row)
    except sqlite3.Error as exc:
        snapshot.flag(source, snapshot.classify(exc))
        return None
    finally:
        con.close()
    return {"slug": slug, "since": since, "start": start_snapshot,
            "cards": {t: titles[t] for t in sorted(wanted_cards) if t in titles}, "facts": facts, "runs": out_runs,
            "silences": silences}


def _runs_in_window(con: sqlite3.Connection, frm: int, to: int, now: float) -> list[dict]:
    """Runs open at some instant of ``[frm, to]`` (a run still open has no end)."""
    out = []
    for rid, task, profile, started, ended, outcome in con.execute(
            "SELECT id, task_id, profile, started_at, ended_at, outcome FROM task_runs ORDER BY started_at, id"):
        s, e = snapshot.task_epoch(started), snapshot.task_epoch(ended)
        if s is None or s > to or (e is not None and e < frm) or not isinstance(task, str) or not _ID_RE.fullmatch(task):
            continue
        prof = profile if isinstance(profile, str) and _PROFILE_RE.fullmatch(profile) else None
        if prof is None:
            continue   # a run without a profile is a « Launch » (the synthetic run `complete_task` writes for a guard), not an execution
        out.append({"id": rid, "start": s, "end": e, "profile": prof, "task": task,
                    "outcome": (outcome if outcome in OUTCOMES else "other") if outcome else None})
    return out


def _titles(con: sqlite3.Connection, ids: set) -> Iterable[tuple[str, str]]:
    ids = sorted(i for i in ids if isinstance(i, str))
    for at in range(0, len(ids), 400):
        chunk = ids[at:at + 400]
        yield from con.execute(f"SELECT id, title FROM tasks WHERE id IN ({','.join('?' * len(chunk))})", chunk)


def _silences(runs: list[dict], beats: dict[int, list[int]], frm: int, to: int, now: float) -> list[list]:
    """Gaps of more than five minutes between two signs of life of a run (its start counts as one): ``[profile, task,
    from, to]`` with ``from`` = the moment the run became « silent » (last sign + 5 min). Computed, never a note."""
    out = []
    for r in runs:
        if not r["profile"]:
            continue
        end = r["end"] if r["end"] is not None else min(int(now), to)
        marks = [r["start"]] + sorted(b for b in beats.get(r["id"], []) if r["start"] <= b <= end) + [end]
        for a, b in zip(marks, marks[1:]):
            if b - a > SILENCE_S and b >= frm and a + SILENCE_S <= to:
                out.append([r["profile"], r["task"], a + SILENCE_S, b])
    return out


# ------------------------------------------------------------------ other sources
def read_sessions_window(profile: str, home: Path, frm: int, to: int, hidden: Iterable[str], budget: usage.Budget) -> list[list]:
    """Conversations outside the kanban that STARTED in the window: ``[profile, source, start, end|null]``. Internal sources
    (kanban, tool, oneshot: Hermes lists none of them) and ``cron`` (its own list) are left out; titles, previews and messages
    are not columns of this query. An open session has no end: ``null``, nothing is said about its length."""
    source = f"sessions:{snapshot._safe(profile)}"
    db = Path(home) / "state.db"
    if not db.is_file():
        return []
    if budget.left() <= 0:
        snapshot.flag(source, "locked")
        return []
    skip = sorted({*(s.strip().lower() for s in hidden), "cron"})
    try:
        con = usage._open(db, budget.timeout())
    except sqlite3.Error as exc:
        usage._unreadable(source, exc)
        return []
    try:
        if not {"source", "started_at", "ended_at"} <= snapshot._columns(con, "sessions"):
            snapshot.flag(source, "schema")
            return []
        rows = con.execute(
            f"SELECT source, started_at, ended_at FROM sessions WHERE started_at >= ? AND started_at <= ? "
            f"AND lower(trim(coalesce(source, ''))) NOT IN ({','.join('?' * len(skip))}) ORDER BY started_at LIMIT ?",
            (frm, to, *skip, LIMITS["sessions"] + 1)).fetchall()
    except sqlite3.Error as exc:
        usage._unreadable(source, exc)
        return []
    finally:
        con.close()
    out = []
    for src, started, ended in rows:
        s, e = snapshot.task_epoch(started), snapshot.task_epoch(ended)
        src = src.strip().lower() if isinstance(src, str) else ""
        if s is not None and _SESSION_SOURCE_RE.fullmatch(src):
            out.append([profile, src, s, e if e is not None and e >= s else None])
    return out


def read_crons_window(profile: str, home: Path, frm: int, to: int) -> list[list]:
    """Cron executions that ended in the window: ``[profile, name, ts, 1|0]`` (name = ``snapshot._cron_name``: never
    a prompt). Hermes keeps the last 1 000 terminal executions of a profile: the page says since when (``since`` of the
    sources is not served here; an older window is simply emptier, never invented)."""
    db = Path(home) / "cron" / "executions.db"
    if not db.is_file():
        return []
    source = f"cron:{snapshot._safe(profile)}"
    names: dict[str, Any] = {}
    raw = snapshot._read_json(Path(home) / "cron" / "jobs.json", source)
    for j in (raw.get("jobs", []) if isinstance(raw, dict) else raw if isinstance(raw, list) else []):
        if isinstance(j, dict) and isinstance(j.get("id"), str):
            names[j["id"]] = snapshot._cron_name(j)
    try:
        con = snapshot._ro(db, usage.READ_TIMEOUT_S)
    except sqlite3.Error as exc:
        snapshot.flag(source, snapshot.classify(exc))
        return []
    out = []
    try:
        if not {"job_id", "status", "finished_at", "claimed_at"} <= snapshot._columns(con, "executions"):
            snapshot.flag(source, "schema")
            return []
        marks = ",".join("?" * len(snapshot.CRON_TERMINAL))
        for job_id, status, finished, claimed in con.execute(
                f"SELECT job_id, status, finished_at, claimed_at FROM executions WHERE status IN ({marks})", snapshot.CRON_TERMINAL):
            at = snapshot.iso_to_epoch(finished) or snapshot.iso_to_epoch(claimed)
            if at is not None and frm <= at <= to and names.get(job_id):
                out.append([profile, names[job_id], int(at), 1 if status == "completed" else 0])
    except sqlite3.Error as exc:
        snapshot.flag(source, snapshot.classify(exc))
        return []
    finally:
        con.close()
    return out


def read_orders_window(frm: int, to: int, directory: Optional[Path] = None) -> list[list]:
    """The audit journal lines of the window: ``[ts, verb, result, board, task, profile, choice, source]`` (the whitelist of
    ``audit.FIELDS`` again, minus what stays on ``GET /orders``: ``reason``, ``len``, ``before``, ``after``, ``request``)."""
    try:
        lines = audit.read_range(frm, to, directory=directory)
    except Exception as exc:   # noqa: BLE001 - an unreadable journal is said, not a 500
        log.warning("hermes-officecraft replay: audit unreadable: %s", type(exc).__name__)
        snapshot.flag("audit", "unreadable")
        return []
    lines = [e for e in lines if e.get("verb") != "notify_test"]   # a test message is not an order of the replay
    return [[e["ts"], e.get("verb"), e.get("result"), e.get("board"), e.get("task"), e.get("profile"), e.get("choice"), e.get("source")]
            for e in lines]


# ------------------------------------------------------------------ the route (the window is checked by ``api._window``)
def _truncate(body: dict) -> Optional[dict]:
    """Bounds (LIMITS): each list keeps its beginning; the replay is complete BEFORE ``truncated.at`` (the earliest first
    dropped item of any list), and every list is cut there so the page never shows a later partial tail."""
    cuts = []
    lists = {"facts": [(f, f[0]) for b in body["boards"] for f in b["facts"]], "runs": [(r, r["start"]) for b in body["boards"] for r in b["runs"]],
             "sessions": [(s, s[2]) for s in body["sessions"]], "crons": [(c, c[2]) for c in body["crons"]],
             "orders": [(o, o[0]) for o in body["orders"]]}
    for key, items in lists.items():
        stamps = sorted(ts for _, ts in items)
        if len(stamps) > LIMITS[key]:
            cuts.append(stamps[LIMITS[key]])
    if not cuts:
        return None
    at = min(cuts)
    for b in body["boards"]:
        b["facts"] = [f for f in b["facts"] if f[0] < at]
        b["runs"] = [r for r in b["runs"] if r["start"] < at]
        b["silences"] = [s for s in b["silences"] if s[2] < at]
    body["sessions"] = [s for s in body["sessions"] if s[2] < at]
    body["crons"] = [c for c in body["crons"] if c[2] < at]
    body["orders"] = [o for o in body["orders"] if o[0] < at]
    return {"at": at}


def read_replay(boards: Iterable[tuple[str, Path]], homes: list[tuple[str, Path]], frm: int, to: int, *,
                now: Optional[float] = None, hidden: Iterable[str] = snapshot.INTERNAL_LISTING_FALLBACK,
                audit_dir: Optional[Path] = None, prices: Optional[Callable] = None, budget_s: float = usage.BUDGET_S) -> dict:
    """The body of ``GET /replay`` (``ok`` / ``at`` / ``partial`` are added by the route)."""
    now = time.time() if now is None else now
    budget = usage.Budget(budget_s)
    homes = homes[:usage.MAX_PROFILES]
    home_of = dict(homes)
    cache: dict[str, tuple[dict, Optional[str]]] = {}   # profile -> ({session id: usage}, reason): each state.db opened once

    def session_usage(runs: list[dict], sessions_of_run: dict[int, str]) -> dict:
        out: dict = {}
        by_profile: dict[str, list] = defaultdict(list)
        for r in runs:
            sid = sessions_of_run.get(r["id"])
            if sid and r["profile"] in home_of:
                by_profile[r["profile"]].append((r["id"], sid))
        for prof, pairs in by_profile.items():
            found, reason = usage.read_session_usage(home_of[prof] / "state.db", [sid for _, sid in pairs],
                                                     source=f"sessions:{snapshot._safe(prof)}", budget=budget, prices=prices)
            for rid, sid in pairs:
                out[rid] = (found.get(sid), None) if sid in found else \
                    (None, {"missing": "no_store", "schema": "store_unreadable", "locked": "store_unreadable",
                            "unreadable": "store_unreadable"}.get(reason or "", "no_calls"))
        for r in runs:   # a run of a profile that does not exist here (deleted) has nowhere to look
            if r["id"] in sessions_of_run and r["id"] not in out:
                out[r["id"]] = (None, "no_store")
        return out

    out_boards = []
    for slug, db in boards:
        got = read_board_replay(db, slug, frm, to, now=now, session_usage=session_usage)
        if got is not None and got["since"] is not None:   # a board with no event at all (the empty `default`) is not a source of facts
            out_boards.append(got)
    sessions: list = []
    crons: list = []
    for name, home in homes:
        sessions.extend(read_sessions_window(name, home, frm, to, hidden, budget))
        crons.extend(read_crons_window(name, home, frm, to))
    sessions.sort(key=lambda s: (s[2], s[0]))
    crons.sort(key=lambda c: (c[2], c[0], c[1]))
    body = {"from": frm, "to": to, "boards": out_boards, "orders": read_orders_window(frm, to, audit_dir),
            "sessions": sessions, "crons": crons}
    body["truncated"] = _truncate(body)
    return body


def hermes_replay(frm: int, to: int, board: Optional[str] = None) -> dict:
    from hermes_cli.kanban_db_boards import list_boards
    boards = []
    try:
        for meta in list_boards(include_archived=False):
            slug = meta["slug"]
            if board is None or slug == board:
                boards.append((slug, Path(meta["db_path"])))
    except Exception as exc:   # noqa: BLE001 - the list of boards unreadable: the other sources are still served, and it is said
        log.warning("hermes-officecraft replay: boards unreadable: %s", type(exc).__name__)
        snapshot.flag("kanban", snapshot.classify(exc))
    return usage.one_at_a_time(lambda: read_replay(boards, usage.hermes_homes(), frm, to, hidden=snapshot.listing_sources()))
