"""REST routes mounted under ``/api/plugins/hermes-officecraft/``.

- ``GET /health``  : identity, ``reads`` (data this backend serves) and
  ``capabilities`` (exactly the orders it can execute, so the UI never offers
  an action the backend cannot perform).
- ``POST /campaign`` : a graph of cards behind a head guard, created in one transaction, re-read and compared.
- ``POST /orders`` : one kanban order (``unblock``, ``comment``, ``launch``, ``cancel_campaign``), executed by Hermes' ``kanban_db``,
  re-read and journaled (``orders.py``). Always POST + JSON, never GET.
- ``GET /orders?limit=N`` : the end of the audit journal, whitelisted fields only (``audit.py``).
- ``POST /audit``  : journal an order the PAGE did (approval, recruitment); executes nothing.
- ``GET /notify`` / ``POST /notify`` : the notification settings (types, routes per type, quiet hours; server side, all OFF by default), the recipients
  Hermes knows (no chat id) and the last sends; ``POST /notify/test`` (one test message) and ``POST /notify/trophy`` (the open page reports
  unlocked trophies); the hook that sends lives in ``notify.py``.
- ``GET /live``    : boards (cards, heartbeats) + gateway + cron jobs. Polled
  by the office every 5 s while the page is visible; no history, no skills.
- ``GET /history`` : profiles (session aggregates, skills) + boards with runs
  and events, for the game layer and the inspector. Fetched on demand.
- ``GET /replay?from&to[&board]`` : facts of the kanban (events, runs, silences), orders, sessions and crons of a window
  of at most 7 days; ``GET /usage?from&to`` : tokens, calls and recorded costs per profile (window <= 31 days);
  ``replay.py`` and ``usage.py``. Read-only, whitelisted, an absent figure is ``null`` with a reason, never 0.
- ``partial`` (all of them): ``[{source, reason}]``, always present, ``[]`` when everything was read: a source
  that could not be read is not a source that holds nothing.

The desktop half cannot read the kanban by itself (``ctx.rest`` is confined to
this namespace and the gateway has no kanban RPC): without this backend the
office shows the roster only.
"""

import logging
import re
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from . import __version__, audit, campaign, llm, notify, orders, replay, usage

API_VERSION = 1
CAPABILITIES: tuple[str, ...] = (*orders.VERBS, "campaign")   # the orders, plus the route that creates a campaign
READS: tuple[str, ...] = ("live", "history", "orders", "notify", "llm", "replay", "usage")

router = APIRouter()
log = logging.getLogger(__name__)


def health_payload() -> dict:
    # ``capabilities`` = exactly what this backend can do NOW: the orders, plus ``llm:<function>`` for each LLM function
    # whose model route exists (``ctx.llm`` attached by ``register`` and the auxiliary task declared). A function whose
    # switch is off is still announced: the switch is the user's, the route is what the plugin offers.
    return {
        "ok": True,
        "plugin": "hermes-officecraft",
        "version": __version__,
        "api": API_VERSION,
        "reads": list(READS),
        "capabilities": [*CAPABILITIES, *(f"llm:{f}" for f in llm.engine().features_available()),
                         *(["llm:override"] if llm.engine().override_state() == "granted" else [])],
    }


def _guard(name: str, fn) -> dict:
    """A failed read answers ``{ok: false}`` (the UI keeps its last good data) instead of a 500."""
    try:
        return {"ok": True, "at": time.time(), **fn()}
    except Exception as exc:   # noqa: BLE001 - a read must never take the page down
        log.warning("hermes-officecraft %s read failed: %s", name, exc)
        return {"ok": False, "at": time.time(), "error": type(exc).__name__}


# the name a failed source gets in ``partial`` (the readers name their own finer sources: ``kanban:<slug>``...)
_SOURCE_NAMES = {"boards": "kanban", "ops": "ops", "profiles": "profiles"}


def _sources(parts: dict) -> dict:
    """Read each source of a route on its own (``{key: (reader, value_when_it_fails)}``): a source that
    fails gives its fallback and a WARNING, and the others are still served. The failure is named in
    ``partial`` so the page can tell it from an empty source. When EVERY source fails the first error
    is raised, so ``_guard`` answers ``ok: false`` and the page keeps its last good data."""
    from . import snapshot
    out, errors = {}, []
    for key, (read, fallback) in parts.items():
        try:
            out[key] = read()
        except Exception as exc:   # noqa: BLE001 - one unreadable source must not hide the others
            log.warning("hermes-officecraft %s source failed: %s: %s", key, type(exc).__name__, exc)
            errors.append(exc)
            snapshot.flag(_SOURCE_NAMES.get(key, "unknown"), "unreadable")
            out[key] = fallback
    if errors and len(errors) == len(parts):
        raise errors[0]
    return out


@router.get("/health")
def health() -> dict:
    return health_payload()


def _with_partial(name: str, fn) -> dict:
    """``_guard`` + the ``partial`` list, present on every answer: ``[]`` when everything was read, and on
    ``ok: false`` (there is no data to qualify: the page keeps its last answer and reads ``error``)."""
    from . import snapshot
    with snapshot.partial_scope() as flags:
        body = _guard(name, fn)
    return {**body, "partial": snapshot.partial_list(flags) if body.get("ok") else []}


@router.get("/live")
def live() -> dict:
    from .snapshot import hermes_boards, hermes_ops
    return _with_partial("live", lambda: _sources({"boards": (lambda: hermes_boards(history=False, reasons=True), []),
                                                   "ops": (hermes_ops, None)}))


@router.get("/history")
def history() -> dict:
    from . import snapshot
    from .snapshot import hermes_boards, hermes_cron_runs, hermes_profiles

    def crons() -> list:
        # cron outcome history, for one achievement only. Optional: a failing store never hides the rest nor turns the route to `ok: false`
        try:
            return hermes_cron_runs()
        except Exception as exc:   # noqa: BLE001
            log.warning("hermes-officecraft crons source failed: %s: %s", type(exc).__name__, exc)
            snapshot.flag("cron", "unreadable")
            return []

    return _with_partial("history", lambda: {**_sources({"profiles": (hermes_profiles, []),
                                                  "boards": (lambda: hermes_boards(history=True), [])}), "crons": crons()})


_EPOCH_RE = re.compile(r"^[0-9]{1,11}$")
_BOARD_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def _unprocessable(what: str) -> HTTPException:
    # like `_read_body`: a refusal says which parameter, never echoes its value
    return HTTPException(status_code=422, detail=[{"type": "value_error", "loc": ["query", what], "msg": "invalid"}])


def _window(frm: Optional[str], to: Optional[str], longest: int, now: float) -> tuple[int, int]:
    """``?from=&to=`` in epoch seconds (default: the 24 h up to now); 422 for anything outside what is served."""
    for name, value in (("from", frm), ("to", to)):
        if value is not None and not _EPOCH_RE.fullmatch(value):
            raise _unprocessable(name)
    end = int(now) if to is None else int(to)
    start = end - 86_400 if frm is None else int(frm)
    if start < 0 or end <= start:
        raise _unprocessable("from")
    if end - start > longest:
        raise _unprocessable("to")
    if end > now + replay.FUTURE_SLACK_S:
        raise _unprocessable("to")
    return start, end


@router.get("/replay")
def get_replay(frm: Optional[str] = Query(None, alias="from"), to: Optional[str] = None, board: Optional[str] = None) -> dict:
    """What happened, as facts: kanban events and runs, silences, orders, sessions, crons. No content."""
    start, end = _window(frm, to, replay.MAX_WINDOW_S, time.time())
    if board is not None and not _BOARD_RE.fullmatch(board):
        raise _unprocessable("board")
    return _with_partial("replay", lambda: replay.hermes_replay(start, end, board))


@router.get("/usage")
def get_usage(frm: Optional[str] = Query(None, alias="from"), to: Optional[str] = None) -> dict:
    """Tokens, calls and recorded costs per profile over a window; an absent figure is `null` with a reason."""
    start, end = _window(frm, to, usage.MAX_WINDOW_S, time.time())
    return _with_partial("usage", lambda: usage.hermes_usage(start, end))


async def _read_body(request: Request, model, limit: int = orders.MAX_BODY_BYTES):
    """Hermes bounds neither the body of a plugin route nor what FastAPI reads before a dependency runs:
    read at most MAX_BODY_BYTES, declared or streamed, JSON only. A refusal is a 422 WITHOUT the input: FastAPI's
    own echoes the refused text and dies on a NaN (500)."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise HTTPException(status_code=413, detail="body too large")
    raw = bytearray()
    async for chunk in request.stream():
        raw += chunk
        if len(raw) > limit:
            raise HTTPException(status_code=413, detail="body too large")
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
        raise HTTPException(status_code=422, detail=[{"type": "content_type", "loc": ["body"], "msg": "application/json expected"}])
    try:
        return model.model_validate_json(bytes(raw))
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=[{"type": e["type"], "loc": [str(p) for p in e["loc"]], "msg": e["msg"]}
                                                     for e in exc.errors(include_url=False, include_input=False, include_context=False)])


@router.post("/orders")
async def post_order(request: Request) -> JSONResponse:
    order = await _read_body(request, orders.OrderIn)
    status, body = await run_in_threadpool(orders.run_order, order)
    return JSONResponse(body, status_code=status)


@router.post("/campaign")
async def post_campaign(request: Request) -> JSONResponse:
    """Create a graph of cards behind a head guard, in one transaction, re-read and compared (campaign.py)."""
    body = await _read_body(request, campaign.CampaignIn, campaign.MAX_BODY_BYTES)
    status, answer = await run_in_threadpool(campaign.run_campaign, body)
    return JSONResponse(answer, status_code=status)


@router.get("/orders")
def get_orders(limit: int = Query(20, ge=1, le=audit.MAX_LIMIT)) -> dict:
    return _guard("orders", lambda: {"entries": audit.read_tail(limit)})


@router.post("/audit")
async def post_audit(request: Request) -> JSONResponse:
    entry = await _read_body(request, orders.AuditIn)
    try:
        return JSONResponse(await run_in_threadpool(orders.run_audit, entry))
    except Exception as exc:   # noqa: BLE001 - a journal that cannot be written is said, not a 500
        log.warning("hermes-officecraft audit route failed: %s", type(exc).__name__)
        return JSONResponse({"ok": False, "id": entry.id, "reason": "audit_unavailable"}, status_code=503)


@router.get("/notify")
def get_notify() -> dict:
    return _guard("notify", notify.settings_payload)


@router.post("/notify")
async def post_notify(request: Request) -> JSONResponse:
    body = await _read_body(request, notify.NotifyIn)
    try:
        known = await run_in_threadpool(notify.hermes_targets)
        ok, out = await run_in_threadpool(notify.apply_settings, body, known)
    except Exception as exc:   # noqa: BLE001 - settings that cannot be saved are said, not a 500
        log.warning("hermes-officecraft notify route failed: %s", type(exc).__name__)
        return JSONResponse({"ok": False, "reason": "notify_unavailable"}, status_code=503)
    return JSONResponse(out, status_code=200 if ok else 422)


@router.post("/notify/test")
async def post_notify_test(request: Request) -> JSONResponse:
    """ONE test message in the real format to a recipient Hermes knows (1 per minute, 10 per day, audited)."""
    body = await _read_body(request, notify.NotifyTestIn)
    try:
        known = await run_in_threadpool(notify.hermes_targets)
        status, out = await run_in_threadpool(notify.run_test, body.target, known)
    except Exception as exc:   # noqa: BLE001 - a test that cannot run is said, never a 500 and never the exception's text
        log.warning("hermes-officecraft notify test route failed: %s", type(exc).__name__)
        return JSONResponse({"ok": False, "error": "notify_unavailable"}, status_code=503)
    return JSONResponse(out, status_code=status)


@router.post("/notify/trophy")
async def post_notify_trophy(request: Request) -> JSONResponse:
    """The page (open) reports the trophies it just saw unlocked; idempotent, whitelisted (id, name, tier)."""
    body = await _read_body(request, notify.TrophiesIn)
    try:
        out = await run_in_threadpool(notify.record_trophies, body)
    except Exception as exc:   # noqa: BLE001
        log.warning("hermes-officecraft notify trophy route failed: %s", type(exc).__name__)
        return JSONResponse({"ok": False, "reason": "notify_unavailable"}, status_code=503)
    return JSONResponse(out)


# ------------------------------------------------------------------ LLM functions (hermes_officecraft/llm.py)
@router.get("/llm")
def get_llm() -> dict:
    return _guard("llm", llm.engine().payload)


@router.post("/llm/settings")
async def post_llm_settings(request: Request) -> JSONResponse:
    body = await _read_body(request, llm.SettingsIn, llm.MAX_BODY_BYTES)
    try:
        engine = llm.engine()
        await run_in_threadpool(engine.save_settings, body.raw())
        return JSONResponse(_guard("llm", engine.payload))
    except Exception as exc:   # noqa: BLE001 - settings that cannot be saved are said, not a 500
        log.warning("hermes-officecraft llm settings route failed: %s", type(exc).__name__)
        return JSONResponse({"ok": False, "reason": "llm_unavailable"}, status_code=503)


async def _llm_call(request: Request, feature: str, model) -> JSONResponse:
    body = await _read_body(request, model, llm.BODY_LIMITS.get(feature, llm.MAX_BODY_BYTES))   # three routes take a bigger body, the rest 8 KiB
    try:
        status, answer = await run_in_threadpool(llm.engine().run, feature, body)
    except Exception as exc:   # noqa: BLE001 - never the text of an exception, never a 500
        log.warning("hermes-officecraft llm %s route failed: %s", feature, type(exc).__name__)
        return JSONResponse({"ok": False, "id": body.id, "feature": feature, "result": "failed", "reason": "model_error"})
    return JSONResponse(answer, status_code=status)


@router.post("/llm/decor")
async def post_llm_decor(request: Request) -> JSONResponse:
    return await _llm_call(request, "decor", llm.DecorIn)


@router.post("/llm/decor/reset")
async def post_llm_decor_reset(request: Request) -> JSONResponse:
    body = await _read_body(request, llm.IdIn, llm.MAX_BODY_BYTES)
    status, answer = await run_in_threadpool(llm.engine().reset_decor, body)
    return JSONResponse(answer, status_code=status)


@router.post("/llm/decor/resolve")
async def post_llm_decor_resolve(request: Request) -> JSONResponse:
    body = await _read_body(request, llm.ResolveIn, llm.MAX_BODY_BYTES)
    status, answer = await run_in_threadpool(llm.engine().resolve_decor, body)
    return JSONResponse(answer, status_code=status)


@router.post("/llm/outfits")
async def post_llm_outfits(request: Request) -> JSONResponse:
    return await _llm_call(request, "outfits", llm.OutfitsIn)


@router.post("/llm/art")
async def post_llm_art(request: Request) -> JSONResponse:
    return await _llm_call(request, "art", llm.ArtIn)


@router.post("/llm/seating")
async def post_llm_seating(request: Request) -> JSONResponse:
    return await _llm_call(request, "seating", llm.SeatingIn)


@router.post("/llm/thoughts")
async def post_llm_thoughts(request: Request) -> JSONResponse:
    return await _llm_call(request, "thoughts", llm.ThoughtsIn)


# the model fills a DRAFT; nothing is created, changed or launched by these routes
@router.post("/llm/recruit")
async def post_llm_recruit(request: Request) -> JSONResponse:
    return await _llm_call(request, "recruit", llm.RecruitIn)


@router.post("/llm/revise")
async def post_llm_revise(request: Request) -> JSONResponse:
    return await _llm_call(request, "revise", llm.ReviseIn)


# A plan, the instructions of one card, a review: drafts and remarks only. Nothing here creates, changes or launches a card:
# ``POST /campaign`` stays the only way a graph is written, and these routes never open the kanban.
@router.post("/llm/campaign")
async def post_llm_campaign(request: Request) -> JSONResponse:
    return await _llm_call(request, "campaign", llm.CampaignLlmIn)


@router.post("/llm/cardbody")
async def post_llm_cardbody(request: Request) -> JSONResponse:
    return await _llm_call(request, "cardbody", llm.CardbodyIn)


@router.post("/llm/lint")
async def post_llm_lint(request: Request) -> JSONResponse:
    return await _llm_call(request, "lint", llm.LintIn)


@router.get("/llm/draft")
def get_llm_draft(feature: str = Query(..., pattern="^(" + "|".join(llm.DRAFTS) + ")$"), id: str = Query(..., pattern=llm._ID_RE)) -> dict:
    """The draft a closed window did not get to read: read only, no model, whatever the switches say."""
    return llm.engine().get_draft(feature, id)


@router.post("/llm/draft/forget")
async def post_llm_draft_forget(request: Request) -> JSONResponse:
    body = await _read_body(request, llm.DraftIn, llm.MAX_BODY_BYTES)
    return JSONResponse(await run_in_threadpool(llm.engine().forget_draft, body))
