"""``GET /usage`` and the usage numbers of ``GET /replay``: tokens, calls and costs Hermes recorded.

Read-only, whitelisted. Golden rule: a number is served only when a column Hermes wrote holds it;
a missing source is ``null`` with a reason, never ``0``; a dollar
amount is served only for a route whose price Hermes' own estimator knows, labelled by its source, and is never
added across priced and unpriced routes. Never a title, a preview, a message, a prompt, a path or a session id.

Per profile: ``<home>/state.db`` (``sessions`` totals, ``session_model_usage`` breakdown), opened ``mode=ro`` with a
short timeout; one that cannot be read gives ``null`` numbers, a ``reason`` and an entry in ``partial``.
"""

from __future__ import annotations

import logging
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

from . import snapshot

log = logging.getLogger(__name__)

MAX_WINDOW_S = 31 * 86_400
MAX_PROFILES = 30
MAX_MODEL_ROWS = 20            # per profile: the biggest, the rest folded in one ``other`` row
NAME_MAX = 120
READ_TIMEOUT_S = 1.0           # busy timeout of one state.db (own handle, read-only)
BUDGET_S = 8.0                 # the whole read: a store that does not answer inside it is `locked`, the others are served
COST_SOURCES = ("provider_cost_api", "provider_generation_api", "provider_models_api", "official_docs_snapshot",
                "user_override", "custom_contract", "none")   # agent/usage_pricing.py:59-60
PRICED_STATUSES = ("estimated", "actual")
TOKEN_COLUMNS = (("input", "input_tokens"), ("output", "output_tokens"), ("cacheRead", "cache_read_tokens"),
                 ("cacheWrite", "cache_write_tokens"), ("reasoning", "reasoning_tokens"))
_TASK_RE = re.compile(r"^[a-z_]{0,40}$")
# The window reads (/replay, /usage) run one at a time. Two at once convoy on the GIL (sqlite hands it back at every
# row): 10 concurrent 7-day replays took 11 s each instead of 0.3 s and ran out of their budget (every store
# `locked`). A read that cannot get its turn within READ_WAIT_S raises TimeoutError: the route answers `ok: false`.
READ_LOCK = threading.Lock()
READ_WAIT_S = 30.0


def one_at_a_time(read: Callable[[], dict]) -> dict:
    if not READ_LOCK.acquire(timeout=READ_WAIT_S):
        raise TimeoutError("busy")
    try:
        return read()
    finally:
        READ_LOCK.release()

# ------------------------------------------------------------------ the price of a route
_PRICE_LOCK = threading.Lock()
_PRICES: dict[tuple[str, str], dict] = {}   # (model, provider) -> {priced, source}; a route's price does not change inside a process


def hermes_route_price(model: str, provider: str) -> tuple[bool, Optional[str]]:
    """Is the price of ``model`` on ``provider`` known to Hermes' own estimator? ``(priced, source)``. The question
    is « one million input tokens, no answer from the provider » (``estimate_usage_cost``, no model call): ``estimated``
    / ``actual`` with an amount = a priced route; ``unknown`` / ``included`` = an unknown price (a subscription's list-price
    equivalent is not an invoice). Same criterion as ``route.priced`` of ``/llm``."""
    from agent.usage_pricing import CanonicalUsage, estimate_usage_cost
    cost = estimate_usage_cost(model, CanonicalUsage(input_tokens=1_000_000), provider=provider or None)
    amount = None if cost.amount_usd is None else float(cost.amount_usd)
    source = str(cost.source) if str(cost.source) in COST_SOURCES else None
    return (str(cost.status) in PRICED_STATUSES and amount is not None and amount >= 0), source


def route_price(model: Any, provider: Any, probe: Optional[Callable[[str, str], tuple[bool, Optional[str]]]] = None) -> dict:
    """``{priced, source}`` of a route, asked once per process. An estimator that fails = price unknown (never a price)."""
    key = (_name(model) or "", _name(provider) or "")
    with _PRICE_LOCK:
        hit = _PRICES.get(key)
    if hit is not None and probe is None:
        return hit
    try:
        priced, source = (probe or hermes_route_price)(*key)
    except Exception as exc:   # noqa: BLE001 - no estimate = price unknown
        log.debug("hermes-officecraft usage: price lookup failed: %s", type(exc).__name__)
        priced, source = False, None
    hit = {"priced": bool(priced), "source": source}
    if probe is None:
        with _PRICE_LOCK:
            _PRICES[key] = hit
    return hit


def forget_prices() -> None:
    with _PRICE_LOCK:
        _PRICES.clear()


# ------------------------------------------------------------------ small helpers
def _name(value: Any) -> Optional[str]:
    """A model / provider name as written (control characters out, bounded); None when absent."""
    if not isinstance(value, str):
        return None
    text = "".join(c for c in value if c.isprintable()).strip()[:NAME_MAX]
    return text or None


def _int(value: Any) -> Optional[int]:
    """A count Hermes wrote; None when absent or not a plain non-negative number (never a guess, never 0 for 'absent')."""
    if value is None or isinstance(value, bool):
        return None
    try:
        n = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return n if n >= 0 and float(n) == float(value) else None


def _money(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    try:
        x = float(value)
    except (TypeError, ValueError):
        return None
    return round(x, 6) if x == x and x not in (float("inf"), float("-inf")) and x >= 0 else None


def _source(value: Any) -> Optional[str]:
    return value if isinstance(value, str) and value in COST_SOURCES else None


def _open(db: Path, timeout: float) -> sqlite3.Connection:
    return snapshot._ro(db, timeout)


class Budget:
    """The time one read may spend on stores that are being written: what is left when a store is reached."""

    def __init__(self, seconds: float = BUDGET_S):
        self.deadline = time.monotonic() + seconds

    def left(self) -> float:
        return self.deadline - time.monotonic()

    def timeout(self) -> float:
        return min(READ_TIMEOUT_S, max(self.left(), 0.0))


def _unreadable(source: str, exc: BaseException) -> str:
    reason = snapshot.classify(exc)
    snapshot.flag(source, reason)
    return reason


# ------------------------------------------------------------------ one run's usage (the replay joins it)
def read_session_usage(db: Path, session_ids: Iterable[str], *, source: str, budget: Optional[Budget] = None,
                       prices: Optional[Callable] = None) -> tuple[dict[str, dict], Optional[str]]:
    """``({session id: usage}, reason)`` for the sessions asked, from the ``sessions`` row of that profile's state.db.
    A session with no model call (``api_call_count`` 0 or NULL) or not found has NO entry (absent, not zero).
    ``reason`` is set when the store itself could not be read (the caller says why each run has no usage)."""
    ids = [s for s in dict.fromkeys(session_ids) if isinstance(s, str) and 0 < len(s) <= 256]
    if not ids:
        return {}, None
    if not Path(db).is_file():
        return {}, "missing"
    budget = budget or Budget()
    if budget.left() <= 0:
        snapshot.flag(source, "locked")
        return {}, "locked"
    out: dict[str, dict] = {}
    try:
        con = _open(db, budget.timeout())
    except sqlite3.Error as exc:
        return {}, _unreadable(source, exc)
    try:
        have = snapshot._columns(con, "sessions")
        if not {"id", "api_call_count", "input_tokens", "output_tokens"} <= have:
            snapshot.flag(source, "schema")
            return {}, "schema"
        cols = ["id", "api_call_count"] + [c for _, c in TOKEN_COLUMNS if c in have]
        extra = [c for c in ("model", "billing_provider", "estimated_cost_usd", "actual_cost_usd", "cost_source") if c in have]
        for at in range(0, len(ids), 400):
            chunk = ids[at:at + 400]
            marks = ",".join("?" * len(chunk))
            for row in con.execute(f"SELECT {', '.join(cols + extra)} FROM sessions WHERE id IN ({marks})", chunk):
                r = dict(zip(cols + extra, row))
                calls = _int(r["api_call_count"])
                if not calls:
                    continue   # no model call: no usage (a session that never reached the model is not « 0 tokens »)
                out[r["id"]] = _usage_row(r, calls, prices)
    except sqlite3.Error as exc:
        return {}, _unreadable(source, exc)
    finally:
        con.close()
    return out, None


def _usage_row(r: dict, calls: int, prices: Optional[Callable] = None) -> dict:
    """The whitelisted usage of one session row (``sessions`` columns), costs only for a priced route."""
    model, provider = _name(r.get("model")), _name(r.get("billing_provider"))
    tokens = {k: _int(r.get(col)) for k, col in TOKEN_COLUMNS}
    price = route_price(model, provider, prices) if model else {"priced": False, "source": None}
    return {"apiCalls": calls, "tokens": tokens, "model": model, "provider": provider,
            **_cost(price["priced"], _money(r.get("actual_cost_usd")), _money(r.get("estimated_cost_usd")), _source(r.get("cost_source")))}


def _cost(route_priced: bool, actual: Optional[float], estimated: Optional[float], source: Optional[str]) -> dict:
    """``priced`` / ``usd`` / ``costSource`` / ``costKind``: a dollar amount only for a priced route and a recorded
    amount; ``actual`` only when Hermes recorded a real cost (> 0); everything else is ``unpriced`` with no amount."""
    if route_priced and actual is not None and actual > 0:
        return {"priced": True, "usd": actual, "costSource": source, "costKind": "actual"}
    if route_priced and estimated is not None:
        return {"priced": True, "usd": estimated, "costSource": source, "costKind": "estimated"}
    return {"priced": False, "usd": None, "costSource": source, "costKind": "unpriced"}


# ------------------------------------------------------------------ GET /usage
def _sum_tokens(rows: list[dict]) -> dict:
    out: dict = {}
    for key, _ in TOKEN_COLUMNS:
        values = [r["tokens"][key] for r in rows if r["tokens"][key] is not None]
        out[key] = sum(values) if values else None
    return out


def read_profile_usage(profile: str, home: Path, frm: int, to: int, *, budget: Optional[Budget] = None,
                       prices: Optional[Callable] = None) -> tuple[dict, dict]:
    """``(entry, routes)`` of one profile: sessions STARTED in ``[frm, to]`` with at least one model call (the window
    attribution: a session's tokens are not dated call by call). ``routes`` = ``{(model, provider): price}``."""
    source = f"sessions:{snapshot._safe(profile)}"
    entry: dict = {"profile": profile, "sessions": None, "apiCalls": None, "tokens": None, "models": None, "reason": None}
    routes: dict = {}
    db = Path(home) / "state.db"
    if not db.is_file():
        entry["reason"] = "missing"   # a profile that never ran has no store: said, not flagged (nothing is unreadable)
        return entry, routes
    budget = budget or Budget()
    if budget.left() <= 0:
        snapshot.flag(source, "locked")
        entry["reason"] = "locked"
        return entry, routes
    try:
        con = _open(db, budget.timeout())
    except sqlite3.Error as exc:
        entry["reason"] = _unreadable(source, exc)
        return entry, routes
    try:
        have = snapshot._columns(con, "sessions")
        if not {"started_at", "api_call_count", "input_tokens", "output_tokens"} <= have:
            snapshot.flag(source, "schema")
            entry["reason"] = "schema"
            return entry, routes
        sums = ", ".join(f"sum({c})" if c in have else "NULL" for _, c in TOKEN_COLUMNS)
        n, calls, *tok = con.execute(
            f"SELECT count(*), sum(api_call_count), {sums} FROM sessions WHERE started_at >= ? AND started_at <= ? AND api_call_count > 0",
            (frm, to)).fetchone()
        entry["sessions"] = n
        if not n:
            entry["reason"] = "no_sessions"   # no session in the window: there is nothing to total (not « 0 tokens »)
            entry["models"] = []
            return entry, routes
        entry["apiCalls"] = _int(calls)
        entry["tokens"] = {k: _int(v) for (k, _), v in zip(TOKEN_COLUMNS, tok)}
        entry["models"], breakdown_reason = _breakdown(con, frm, to, routes, prices, source)
        if breakdown_reason:
            entry["reason"] = breakdown_reason
    except sqlite3.Error as exc:
        entry.update(sessions=None, apiCalls=None, tokens=None, models=None, reason=_unreadable(source, exc))
    finally:
        con.close()
    return entry, routes


def _breakdown(con: sqlite3.Connection, frm: int, to: int, routes: dict, prices: Optional[Callable], source: str):
    """The ``session_model_usage`` lines of the same sessions, grouped by (model, route, task, cost source): « auxiliary
    tasks included », presented as a breakdown, never added to the totals. ``(rows | None, reason)``."""
    smu = snapshot._columns(con, "session_model_usage")
    need = {"session_id", "model", "billing_provider", "task", "api_call_count", "input_tokens", "output_tokens"}
    if not need <= smu:
        snapshot.flag(source, "schema")
        return None, "no_breakdown"
    pick = lambda c: f"sum(u.{c})" if c in smu else "NULL"   # noqa: E731
    cost_source = "u.cost_source" if "cost_source" in smu else "NULL"
    rows = []
    for model, provider, task, src, calls, *rest in con.execute(
            f"SELECT u.model, u.billing_provider, u.task, {cost_source}, sum(u.api_call_count), "
            + ", ".join(pick(c) for _, c in TOKEN_COLUMNS) + f", {pick('estimated_cost_usd')}, {pick('actual_cost_usd')} "
            "FROM session_model_usage u JOIN sessions s ON s.id = u.session_id "
            "WHERE s.started_at >= ? AND s.started_at <= ? AND s.api_call_count > 0 "
            f"GROUP BY u.model, u.billing_provider, u.task, {cost_source}", (frm, to)):
        *tok, est, act = rest
        m, p = _name(model), _name(provider)
        price = route_price(m, p, prices) if m else {"priced": False, "source": None}
        if m:
            routes[(m, p or "")] = price
        task = task if isinstance(task, str) and _TASK_RE.fullmatch(task) else ""
        rows.append({"model": m, "provider": p, "task": task, "apiCalls": _int(calls),
                     "tokens": {k: _int(v) for (k, _), v in zip(TOKEN_COLUMNS, tok)},
                     **_cost(price["priced"], _money(act), _money(est), _source(src))})
    rows.sort(key=lambda r: -sum(v or 0 for v in r["tokens"].values()))
    if len(rows) > MAX_MODEL_ROWS:
        head, rest_rows = rows[:MAX_MODEL_ROWS - 1], rows[MAX_MODEL_ROWS - 1:]
        priced = [r for r in rest_rows if r["priced"]]
        other = {"model": None, "provider": None, "task": "other", "apiCalls": sum(r["apiCalls"] or 0 for r in rest_rows),
                 "tokens": _sum_tokens(rest_rows),
                 # the folded rows keep an amount only when EVERY one of them is priced (no sum across priced and unpriced routes)
                 **({"priced": True, "usd": round(sum(r["usd"] for r in priced), 6), "costSource": None, "costKind": "estimated"}
                    if priced and len(priced) == len(rest_rows) else
                    {"priced": False, "usd": None, "costSource": None, "costKind": "unpriced"})}
        rows = head + [other]
    return rows, None


def read_usage(homes: list[tuple[str, Path]], frm: int, to: int, *, prices: Optional[Callable] = None,
               budget_s: float = BUDGET_S) -> dict:
    """The body of ``GET /usage`` (without ``ok`` / ``at`` / ``partial``, added by the route)."""
    budget = Budget(budget_s)
    profiles, routes = [], {}
    for name, home in homes[:MAX_PROFILES]:
        entry, found = read_profile_usage(name, home, frm, to, budget=budget, prices=prices)
        profiles.append(entry)
        routes.update(found)
    return {"from": frm, "to": to, "attribution": "session_start", "profiles": profiles,
            "routes": [{"model": m, "provider": p or None, "priced": v["priced"], "costSource": v["source"]}
                       for (m, p), v in sorted(routes.items())]}


def hermes_homes() -> list[tuple[str, Path]]:
    """``[(profile, home)]`` of this Hermes home, as ``/live`` reads them."""
    from hermes_cli.profiles import list_profiles
    return [(p.name, Path(p.path)) for p in list_profiles(lazy_skill_count=True)]


def hermes_usage(frm: int, to: int) -> dict:
    return one_at_a_time(lambda: read_usage(hermes_homes(), frm, to))
