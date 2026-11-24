"""Notifications: tell the user on the messaging platforms Hermes already serves that a
decision waits, an agent went silent, the gateway came back, a cron failed, a campaign is ready, a review was sent back,
the LLM budget is near, a trophy was unlocked. No page needs to be open (except for trophies): the gateway's dispatcher
calls ``on_tick`` (hook ``on_kanban_dispatch_tick``) and the sending is Hermes' own ``send_message_tool`` (what
``hermes send`` does: no LLM, the credentials Hermes already holds).

Rules, each one tested (tests/python/test_notify.py, test_notify_routes.py):

* every type is OFF by default and nothing leaves until the user picked recipients (``routes``: 0 to 4 per type) among those
  Hermes knows;
* the settings and the memory live on the server (``PluginState`` of the plugin), not in the browser;
* one notification per FACT, PER RECIPIENT: a fact is remembered while it lasts and forgotten once resolved, so a fact that
  comes back is notified again; the facts already true when a type is routed to a recipient are that recipient's baseline;
* the facts that arrive together leave in ONE message per recipient; at most ``HOURLY_CAP`` messages per recipient per rolling
  hour, the rest waits; a failed send is retried after ``RETRY_AFTER_S`` for THAT recipient only (a Discord down does not
  hold Telegram back);
* quiet hours (server time zone): the facts of non-urgent types are KEPT; when the range ends ONE summary message per
  recipient says what is still true and how many were resolved meanwhile; urgent types leave at once;
* WHITELIST: a message is made of board, card code and title, agent, state, times and the counted fields of ``notify_format``,
  nothing else. Never a card body, a comment, a prompt, a session content, an approval command; ``sandbox-*`` boards and the
  cards titled as tests are never notified;
* « gateway down » is said on RETURN (« stopped from HH:MM to HH:MM »): everything that notifies lives in the gateway.
"""

import atexit
import hashlib
import json
import logging
import os
import re
import threading
import time
from pathlib import Path
from typing import Annotated, Any, Callable, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from . import audit
from .notify_format import (LABEL_DEFAULT, MAX_LINES, TITLE_MAX, WORDS, clock as _clock, format_line, format_message,
                            inert, sample_facts)

log = logging.getLogger(__name__)

PLUGIN_ID = audit.PLUGIN_ID
SETTINGS_KEY = "notify_settings"
STATE_KEY = "notify_state"
TROPHY_KEY = "notify_trophies"
TEST_KEY = "notify_test"

TYPES: tuple[str, ...] = ("decision", "silent", "gateway", "cron", "campaign", "review", "llm_cap", "trophy")
LEGACY_TYPES: tuple[str, ...] = TYPES[:4]       # the first four: the only ones the legacy single ``target`` ever served
LANGS: tuple[str, ...] = ("en", "fr", "es")
SANDBOX_PREFIX = "sandbox-"
STALE_AFTER_S = 300          # same as the office (src/core/office.js STALE_AFTER_MS): a running card silent for 5 min
EVAL_EVERY_S = 20            # the dispatcher ticks every few seconds; we look at the boards at most this often
HOURLY_CAP = 6               # messages per recipient per rolling hour
RETRY_AFTER_S = 300          # after a failed send, per recipient
MAX_ROUTES = 4               # recipients of one type
TEST_PER_MINUTE = 1
TEST_PER_DAY = 10
LLM_WARN_PCT = 90            # the LLM budget alert: 90 % of the cap, then the cap itself
TROPHY_TTL_S = 48 * 3600     # a recorded trophy is « present » for this long (the time to reach every recipient)
TROPHY_FIRST_SYNC = 3        # more new trophies than this in ONE post is a first sync of the page, not news (baseline)
TROPHY_MEMORY = 500
TROPHY_PENDING_MAX = 100     # trophies waiting to be told: bounded, so posts with ever-new ids cannot fill the state file


_TARGET_KEY_RE = re.compile(r"^[a-z0-9_]{1,32}#[0-9a-f]{8}$")
_LABEL_RE = re.compile(r"^[\[\]A-Za-z0-9 _.-]{1,32}$")
_CTRL_RE = re.compile(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]+")
_HHMM_RE = re.compile(r"^([01][0-9]|2[0-3]):[0-5][0-9]$")
_TROPHY_ID_RE = re.compile(r"^[a-z0-9_]{1,40}$")
_TEST_TITLE_RE = re.compile(r"^\s*\[(?:pool|test|oc-test)[^\]]*\]", re.IGNORECASE)   # the cards of a test pool

# the key prefixes of each type's facts (what a type owns in the memory)
_PREFIXES = {"decision": ("decision:", "approval:"), "silent": ("silent:",), "gateway": ("gateway:", "degraded:"), "cron": ("cron:",),
             "campaign": ("campaign:",), "review": ("review:",), "llm_cap": ("llm_cap:",), "trophy": ("trophy:",)}
_inert = inert   # kept name: a title made inert


def is_sandbox(slug: Any) -> bool:
    return isinstance(slug, str) and slug.startswith(SANDBOX_PREFIX)


def is_test_title(title: Any) -> bool:
    return isinstance(title, str) and _TEST_TITLE_RE.match(title) is not None


# ------------------------------------------------------------------ settings (server side)
def default_quiet() -> dict:
    return {"enabled": False, "from": "22:00", "to": "07:00", "urgent": []}


def default_settings() -> dict:
    return {"types": {t: False for t in TYPES}, "routes": {t: [] for t in TYPES}, "quiet": default_quiet(), "lang": "en", "label": LABEL_DEFAULT}


def _route_list(value: Any) -> list[str]:
    out: list[str] = []
    for key in value if isinstance(value, list) else []:
        if isinstance(key, str) and _TARGET_KEY_RE.fullmatch(key) and key not in out:
            out.append(key)
    return out[:MAX_ROUTES]


def clean_quiet(raw: Any) -> dict:
    out = default_quiet()
    if not isinstance(raw, dict):
        return out
    out["enabled"] = raw.get("enabled") is True
    for key in ("from", "to"):
        if isinstance(raw.get(key), str) and _HHMM_RE.fullmatch(raw[key]):
            out[key] = raw[key]
    out["urgent"] = [t for t in TYPES if isinstance(raw.get("urgent"), list) and t in raw["urgent"]]
    return out


def clean_settings(raw: Any) -> dict:
    """Whatever was stored (or posted): back to the closed shape, every unknown thing dropped, defaults OFF.
    MIGRATION: a settings object of the first version has one ``target`` and no ``routes``: that target becomes the route of
    each ENABLED type (of every legacy type when none is enabled: the user loses nothing). Nothing is rewritten on disk."""
    out = default_settings()
    if not isinstance(raw, dict):
        return out
    types = raw.get("types")
    if isinstance(types, dict):
        for t in TYPES:
            out["types"][t] = types.get(t) is True
    if isinstance(raw.get("routes"), dict):
        for t in TYPES:
            out["routes"][t] = _route_list(raw["routes"].get(t))
    elif isinstance(raw.get("target"), str) and _TARGET_KEY_RE.fullmatch(raw["target"]):
        mine = [t for t in LEGACY_TYPES if out["types"][t]] or list(LEGACY_TYPES)
        for t in mine:
            out["routes"][t] = [raw["target"]]
    out["quiet"] = clean_quiet(raw.get("quiet"))
    if raw.get("lang") in LANGS:
        out["lang"] = raw["lang"]
    if isinstance(raw.get("label"), str) and _LABEL_RE.fullmatch(raw["label"]):
        out["label"] = raw["label"]
    return out


def legacy_target(settings: dict) -> Optional[str]:
    """The single ``target`` an older page still reads: the first route of the first enabled legacy type."""
    for t in LEGACY_TYPES:
        if settings["types"][t] and settings["routes"][t]:
            return settings["routes"][t][0]
    return next((settings["routes"][t][0] for t in LEGACY_TYPES if settings["routes"][t]), None)


def _state_store():
    from hermes_cli.plugins_state import PluginState
    return PluginState(PLUGIN_ID)


def load_settings(store=None) -> dict:
    try:
        return clean_settings((store or _state_store()).get(SETTINGS_KEY, None))
    except Exception as exc:   # noqa: BLE001 - an unreadable store means « nothing is on »
        log.warning("hermes-officecraft notify settings unreadable: %s", type(exc).__name__)
        return default_settings()


def save_settings(settings: dict, store=None) -> dict:
    cleaned = clean_settings(settings)
    store = store or _state_store()
    store.set(SETTINGS_KEY, cleaned)
    if getattr(store, "data_dir", None) is not None:
        audit.private_dir(Path(store.data_dir))   # PluginState creates it with the umask
    return cleaned


TargetKey = Annotated[str, StringConstraints(pattern=r"^[a-z0-9_]{1,32}#[0-9a-f]{8}$")]
HHMM = Annotated[str, StringConstraints(pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$")]


class TypesIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: bool = False
    silent: bool = False
    gateway: bool = False
    cron: bool = False
    campaign: bool = False
    review: bool = False
    llm_cap: bool = False
    trophy: bool = False


class RoutesIn(BaseModel):
    """One list of recipient keys per type (0 to 4). A type that is not named keeps its route."""
    model_config = ConfigDict(extra="forbid")
    decision: Optional[list[TargetKey]] = Field(default=None, max_length=MAX_ROUTES)
    silent: Optional[list[TargetKey]] = Field(default=None, max_length=MAX_ROUTES)
    gateway: Optional[list[TargetKey]] = Field(default=None, max_length=MAX_ROUTES)
    cron: Optional[list[TargetKey]] = Field(default=None, max_length=MAX_ROUTES)
    campaign: Optional[list[TargetKey]] = Field(default=None, max_length=MAX_ROUTES)
    review: Optional[list[TargetKey]] = Field(default=None, max_length=MAX_ROUTES)
    llm_cap: Optional[list[TargetKey]] = Field(default=None, max_length=MAX_ROUTES)
    trophy: Optional[list[TargetKey]] = Field(default=None, max_length=MAX_ROUTES)


class QuietIn(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    enabled: bool = False
    from_: HHMM = Field(default="22:00", alias="from")
    to: HHMM = "07:00"
    urgent: list[Literal["decision", "silent", "gateway", "cron", "campaign", "review", "llm_cap", "trophy"]] = Field(default_factory=list, max_length=len(TYPES))


class NotifyIn(BaseModel):
    """``POST /notify``: the switch board (closed fields; a type not sent is OFF). ``routes`` and ``quiet`` that are not sent
    keep their stored value; the legacy single ``target`` (an older page) still works: it routes the four legacy types."""
    model_config = ConfigDict(extra="forbid")
    types: TypesIn
    routes: Optional[RoutesIn] = None
    quiet: Optional[QuietIn] = None
    target: Optional[TargetKey] = None
    lang: Literal["en", "fr", "es"] = "en"


def apply_settings(body: NotifyIn, known: list[dict], store=None) -> tuple[bool, dict]:
    """Save the switch board. A recipient Hermes does not know is refused (``unknown_target``), never stored."""
    keys = {t["key"] for t in known}
    current = load_settings(store)
    routes = {t: list(current["routes"][t]) for t in TYPES}
    asked: list[str] = []
    if body.routes is not None:
        for t in TYPES:
            given = getattr(body.routes, t)
            if given is not None:
                routes[t] = _route_list(given)
                asked += given
    if body.target is not None:
        asked.append(body.target)
    if any(k not in keys for k in asked):
        return False, {"ok": False, "reason": "unknown_target"}
    if body.routes is None and "target" in body.model_fields_set:
        for t in LEGACY_TYPES:
            routes[t] = [body.target] if body.target else []
    quiet = clean_quiet(body.quiet.model_dump(by_alias=True)) if body.quiet is not None else current["quiet"]
    save_settings({"types": body.types.model_dump(), "routes": routes, "quiet": quiet, "lang": body.lang, "label": current["label"]}, store)
    return True, {"ok": True, **settings_payload(store, known)}


# ------------------------------------------------------------------ recipients Hermes knows
def _key(platform: str, target: str) -> str:
    return f"{platform}#{hashlib.sha1(target.encode('utf-8')).hexdigest()[:8]}"   # a short handle for the page: the chat id itself is never served (its last 4 characters are, in the label)


def _mask(chat: str) -> str:
    return "…" + chat[-4:] if len(chat) > 6 else chat


def platform_of(key: str) -> str:
    return key.split("#", 1)[0]


def known_targets(directory: Optional[dict] = None, cron_delivers: Optional[list] = None,
                  homes: Optional[list] = None) -> list[dict]:
    """The recipients Hermes already knows: its channel directory, the destinations its cron jobs deliver to, the home
    channel of each connected platform. ``{key, platform, label, source, target}``; ``target`` is for the sender only
    and is stripped from what the route serves (``public_targets``)."""
    out: dict[str, dict] = {}

    def add(platform: str, target: str, label: str, source: str):
        if not re.fullmatch(r"[a-z0-9_]{1,32}", platform) or not target:
            return
        key = _key(platform, target)
        out.setdefault(key, {"key": key, "platform": platform, "label": label[:60], "source": source, "target": target})

    for platform in homes or []:
        add(platform, platform, "home", "home")
    for platform, entries in ((directory or {}).get("platforms") or {}).items():
        for e in entries if isinstance(entries, list) else []:
            if isinstance(e, dict) and isinstance(e.get("id"), (str, int)):
                chat = str(e["id"])
                name = _CTRL_RE.sub(" ", str(e.get("name") or "")).strip()[:40]
                add(str(platform), f"{platform}:{chat}", f"{name} {_mask(chat)}".strip(), "directory")
    for deliver in cron_delivers or []:
        if isinstance(deliver, str) and ":" in deliver:
            platform, chat = deliver.split(":", 1)
            if chat and platform not in ("local", "origin"):
                add(platform, deliver, _mask(chat.split(":")[0]), "cron")
    return list(out.values())


def public_targets(targets: list[dict]) -> list[dict]:
    return [{k: t[k] for k in ("key", "platform", "label", "source")} for t in targets]


def hermes_targets() -> list[dict]:
    """Read the real recipients from Hermes (imports are lazy: CI has no Hermes)."""
    directory, delivers, homes = {}, [], []
    try:
        from gateway.channel_directory import load_directory
        directory = load_directory()
    except Exception as exc:   # noqa: BLE001
        log.debug("hermes-officecraft notify: channel directory unreadable: %s", type(exc).__name__)
    try:
        from hermes_cli.profiles import list_profiles
        for p in list_profiles(lazy_skill_count=True):
            f = Path(p.path) / "cron" / "jobs.json"
            if f.is_file():
                raw = json.loads(f.read_text(encoding="utf-8-sig"))
                jobs = raw.get("jobs", []) if isinstance(raw, dict) else raw if isinstance(raw, list) else []
                delivers += [j.get("deliver") for j in jobs if isinstance(j, dict)]
    except Exception as exc:   # noqa: BLE001
        log.debug("hermes-officecraft notify: cron destinations unreadable: %s", type(exc).__name__)
    try:
        from gateway.config import load_gateway_config
        cfg = load_gateway_config()
        for plat in cfg.get_connected_platforms():
            name = getattr(plat, "value", str(plat))
            if name not in ("local", "api_server", "webhook") and cfg.get_home_channel(plat):
                homes.append(name)
    except Exception as exc:   # noqa: BLE001
        log.debug("hermes-officecraft notify: home channels unreadable: %s", type(exc).__name__)
    return known_targets(directory, delivers, homes)


def hermes_connected(platform: str) -> Optional[bool]:
    """Is this messaging platform connected in the gateway config? ``None`` when Hermes cannot say (then the send is tried)."""
    try:
        from gateway.config import load_gateway_config
        return platform in {getattr(p, "value", str(p)) for p in load_gateway_config().get_connected_platforms()}
    except Exception as exc:   # noqa: BLE001
        log.debug("hermes-officecraft notify: connected platforms unreadable: %s", type(exc).__name__)
        return None


# ------------------------------------------------------------------ quiet hours
def _minutes(hhmm: str) -> int:
    return int(hhmm[:2]) * 60 + int(hhmm[3:])


def in_quiet(quiet: dict, now: float) -> bool:
    """Is ``now`` (the server's local time) inside the quiet range? The range may cross midnight (22:00 → 07:00); ``from == to``
    is an empty range: no effect (same rule as the night replay)."""
    if not isinstance(quiet, dict) or quiet.get("enabled") is not True:
        return False
    start, end = quiet.get("from"), quiet.get("to")
    if not (isinstance(start, str) and isinstance(end, str) and _HHMM_RE.fullmatch(start) and _HHMM_RE.fullmatch(end)):
        return False
    a, b = _minutes(start), _minutes(end)
    if a == b:
        return False
    lt = time.localtime(now)
    t = lt.tm_hour * 60 + lt.tm_min
    return a <= t < b if a < b else (t >= a or t < b)


def timezone_info(now: Optional[float] = None) -> dict:
    lt = time.localtime(now if now is not None else time.time())
    off = lt.tm_gmtoff or 0
    sign = "+" if off >= 0 else "-"
    return {"name": lt.tm_zone or "", "offset": f"{sign}{abs(off) // 3600:02d}:{(abs(off) % 3600) // 60:02d}"}


# ------------------------------------------------------------------ facts (pure)
def detect(boards: list, ops: Optional[dict], now: float, *, approvals: Optional[list] = None,
           gateway_return: Optional[dict] = None, extras: Optional[list] = None, llm: Optional[dict] = None,
           trophies: Optional[list] = None) -> list[dict]:
    """The facts true NOW, in the whitelisted fields only. Reads cards by id, title, status, assignee and heartbeat,
    never a body or a result (the snapshot does not even carry them). ``extras`` = ``snapshot.hermes_notify_extras()``
    (when a card was blocked, reviews, campaigns), ``llm`` = ``{spend, settings}``, ``trophies`` = the recorded ones."""
    facts: list[dict] = []
    extra_by_board = {e.get("slug"): e for e in extras or [] if isinstance(e, dict)}
    for board in boards or []:
        slug = board.get("slug")
        if not isinstance(slug, str) or is_sandbox(slug):
            continue
        ex = extra_by_board.get(slug) or {}
        blocked_at = ex.get("blockedAt") if isinstance(ex.get("blockedAt"), dict) else {}
        tasks = {t.get("id"): t for t in board.get("tasks") or []}
        review_blocked = {r["task"] for r in ex.get("reviews") or [] if r.get("kind") == "blocked"}
        for t in tasks.values():
            status, task = t.get("status"), t.get("id")
            if is_test_title(t.get("title")):
                continue
            base = {"board": slug, "task": task, "title": t.get("title") or "", "agent": t.get("assignee")}
            if status == "blocked":
                fact = {**base, "type": "decision", "key": f"decision:{slug}:{task}", "state": "blocked"}
                if isinstance(blocked_at.get(task), (int, float)):
                    fact["since"] = int(blocked_at[task])
                if t.get("guard") or task in review_blocked:
                    fact["covered_by"] = "campaign" if t.get("guard") else "review"   # said by that type, not twice
                facts.append(fact)
            elif status == "running":
                freshest = max(t.get("heartbeatAt") or 0, t.get("startedAt") or 0)
                if freshest and now - freshest > STALE_AFTER_S:
                    facts.append({**base, "type": "silent", "key": f"silent:{slug}:{task}", "state": "silent",
                                  "span": int(now - freshest), "since": int(freshest)})
        for r in ex.get("reviews") or []:
            t = tasks.get(r.get("task"))
            if t is None or is_test_title(t.get("title")):
                continue
            facts.append({"type": "review", "key": f"review:{slug}:{t['id']}:{r.get('event')}", "board": slug, "task": t["id"],
                          "title": t.get("title") or "", "agent": t.get("assignee"), "since": r.get("ts"),
                          "state": "review_blocked" if r.get("kind") == "blocked" else "review_changes"})
        for c in ex.get("campaigns") or []:
            if is_test_title(c.get("name")):
                continue
            for p in c.get("phases") or []:
                facts.append({"type": "campaign", "key": f"campaign:{slug}:{c.get('id')}:G{p.get('phase')}", "state": "camp_ready",
                              "board": slug, "name": c.get("name"), "phase": p.get("phase"), "title": p.get("name"), "count": p.get("count")})
            if c.get("done"):
                facts.append({"type": "campaign", "key": f"campaign:{slug}:{c.get('id')}:done", "state": "camp_done",
                              "board": slug, "name": c.get("name"), "count": c.get("cards")})
    for request in approvals or []:
        facts.append({"type": "decision", "key": f"approval:{request}", "state": "approval"})
    gw = (ops or {}).get("gateway") or {}
    for p in gw.get("platforms") or []:
        if gw.get("state") == "running" and isinstance(p.get("name"), str) and (p.get("needsAttention") or p.get("state") not in ("connected", None)):
            facts.append({"type": "gateway", "key": f"degraded:{p['name']}:{p.get('state')}", "state": "degraded", "title": p["name"]})
    if gateway_return:
        facts.append({"type": "gateway", "key": gateway_return["key"], "state": "stopped",
                      "start": gateway_return["from"], "end": gateway_return["to"]})
    for c in (ops or {}).get("crons") or []:
        if c.get("enabled") is not False and c.get("last_status") == "error" and c.get("last_run_at"):
            facts.append({"type": "cron", "key": f"cron:{c.get('profile')}:{c.get('name')}:{int(c['last_run_at'])}",
                          "state": "cron_failed", "title": c.get("name") or "", "agent": c.get("profile"), "since": int(c["last_run_at"])})
    facts += llm_cap_facts(llm)
    for tr in trophies or []:
        if isinstance(tr, dict) and isinstance(tr.get("ts"), (int, float)) and now - tr["ts"] < TROPHY_TTL_S:
            facts.append({"type": "trophy", "key": f"trophy:{tr.get('id')}:{tr.get('tier') or '-'}", "state": "trophy",
                          "name": tr.get("name"), "tier": tr.get("tier")})
    return facts


def llm_cap_facts(llm: Optional[dict]) -> list[dict]:
    """The LLM budget of the month (``llm_spend`` against ``capUsd`` and ``callCap``): at 90 % of a cap, then at the cap. One
    fact per level, per cap and per month (a new month starts again); a cap of 0 is no budget to watch."""
    if not isinstance(llm, dict):
        return []
    spend, settings = llm.get("spend") or {}, llm.get("settings") or {}
    month = spend.get("month") if isinstance(spend.get("month"), str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}", spend.get("month")) else None
    out = []
    for kind, used_key, cap_key in (("usd", "usd", "capUsd"), ("calls", "calls", "callCap")):
        used, cap = spend.get(used_key), settings.get(cap_key)
        if month is None or not all(isinstance(v, (int, float)) and not isinstance(v, bool) and v == v for v in (used, cap)) or cap <= 0:
            continue
        pct = used / cap * 100
        if pct >= 100:
            level = "cap"
        elif pct >= LLM_WARN_PCT:
            level = "90"
        else:
            continue
        out.append({"type": "llm_cap", "key": f"llm_cap:{month}:{kind}:{level}", "state": "llm_cap" if level == "cap" else "llm_90",
                    "kind": kind, "pct": int(pct), "used": used, "cap": cap})
    return out


def plan(facts: list[dict], routes: dict, enabled: set, state: dict, now: float, *, quiet_now: bool = False,
         urgent: tuple = (), quiet: Optional[dict] = None) -> tuple[list[dict], dict]:
    """What to send now: ``(dispatches, new_state)``. Pure. ``routes`` = ``{type: [recipient key]}`` (known recipients only),
    ``state`` = ``{armed, seen, sent, retry_after, held}`` each ``{recipient: ...}``. A dispatch = ``{to, facts, quiet, held}``:
    one per recipient per call, either the SUMMARY of the end of quiet hours (``quiet`` set: ``{from, to, resolved}``) or the
    new facts together.

    * a type just routed to a recipient is ARMED for it with its present facts as the baseline (no message for the past);
    * ``seen[recipient]`` keeps the facts already notified for as long as they last: no repeat; a resolved fact leaves it,
      so a fact that returns is new again;
    * in quiet hours the new facts of a non-urgent type are HELD (and seen); once the range ends one summary leaves, made of
      the held facts that are still true, with the count of those resolved meanwhile; a summary with nothing left is dropped;
    * a recipient at its hourly cap, or in backoff after a failure, gets nothing now (the facts stay unseen / held).
    """
    state = {**state, "armed": {r: dict(v) for r, v in (state.get("armed") or {}).items()}, "seen": {r: dict(v) for r, v in (state.get("seen") or {}).items()},
             "sent": {r: [s for s in v if isinstance(s, (int, float)) and now - s < 3600] for r, v in (state.get("sent") or {}).items()},
             "retry_after": dict(state.get("retry_after") or {}), "held": {r: dict(v) for r, v in (state.get("held") or {}).items()}}
    by_type = {t: [f for f in facts if f["type"] == t] for t in TYPES}
    present = {f["key"] for f in facts}
    recipients = sorted({r for t in TYPES if t in enabled for r in routes.get(t, [])})
    for r in list(state["armed"]):
        for t in TYPES:
            if state["armed"][r].get(t) and not (t in enabled and r in routes.get(t, [])):
                state["armed"][r][t] = False
                owns = _PREFIXES[t]
                state["seen"][r] = {k: v for k, v in state["seen"].get(r, {}).items() if not k.startswith(owns)}
                state["held"][r] = {k: v for k, v in state["held"].get(r, {}).items() if not k.startswith(owns)}
    dispatches: list[dict] = []
    for r in recipients:
        arm, seen, held = state["armed"].setdefault(r, {}), state["seen"].setdefault(r, {}), state["held"].setdefault(r, {})
        types_r = {t for t in TYPES if t in enabled and r in routes.get(t, [])}
        new: list[dict] = []
        for t in TYPES:
            if t not in types_r:
                continue
            mine, owns = by_type[t], _PREFIXES[t]
            if not arm.get(t):
                arm[t] = True
                for f in mine:
                    seen[f["key"]] = int(now)
                continue
            keys = {f["key"] for f in mine}
            for k in [k for k in seen if k.startswith(owns) and k not in keys]:
                del seen[k]
            for f in mine:
                if f["key"] in seen:
                    continue
                if f.get("covered_by") in types_r:       # said by another type this recipient gets: not twice
                    seen[f["key"]] = int(now)
                elif quiet_now and t not in urgent:
                    held[f["key"]] = {**f, "held_at": int(now)}
                    seen[f["key"]] = int(now)
                else:
                    new.append(f)
        blocked = len(state["sent"].get(r, [])) >= HOURLY_CAP or now < (state["retry_after"].get(r) or 0)
        if held and not quiet_now:
            still = [f for k, f in held.items() if k in present]
            if not still:
                held.clear()                              # everything was resolved while it was quiet: nothing to say
            elif not blocked:
                dispatches.append({"to": r, "facts": still, "quiet": {"from": (quiet or {}).get("from"), "to": (quiet or {}).get("to"),
                                                                     "resolved": len(held) - len(still)}, "held": True})
                continue
        if new and not blocked:
            dispatches.append({"to": r, "facts": new, "quiet": None, "held": False})
    return dispatches, state


def mark_sent(dispatch: dict, state: dict, now: float) -> dict:
    r = dispatch["to"]
    seen = state["seen"].setdefault(r, {})
    for f in dispatch["facts"]:
        seen[f["key"]] = int(now)
    if dispatch.get("held"):
        state["held"][r] = {}
    state["sent"][r] = [*state["sent"].get(r, []), int(now)]
    state["retry_after"][r] = 0
    return state


def mark_failed(dispatch: dict, state: dict, now: float) -> dict:
    state["retry_after"][dispatch["to"]] = int(now + RETRY_AFTER_S)
    return state


def migrate_state(state: dict, routes: dict) -> dict:
    """The first version of the memory was for ONE recipient (flat ``armed``, ``seen``, ``sent``, ``retry_after``): it becomes the memory of
    each recipient the type is routed to now, so the user gets no repeat of what was already said."""
    if not isinstance(state, dict) or state.get("v") == 2:
        return state if isinstance(state, dict) else {"v": 2}
    out = {k: v for k, v in state.items() if k not in ("armed", "seen", "sent", "retry_after")}
    out.update({"v": 2, "armed": {}, "seen": {}, "sent": {}, "retry_after": {}, "held": {}})
    old_armed = state.get("armed") if isinstance(state.get("armed"), dict) else {}
    old_seen = state.get("seen") if isinstance(state.get("seen"), dict) else {}
    old_sent = state.get("sent") if isinstance(state.get("sent"), list) else []
    retry = state.get("retry_after") if isinstance(state.get("retry_after"), (int, float)) else 0
    for t in TYPES:
        for r in routes.get(t, []):
            out["armed"].setdefault(r, {})[t] = old_armed.get(t) is True
            seen = out["seen"].setdefault(r, {})
            seen.update({k: v for k, v in old_seen.items() if k.startswith(_PREFIXES[t])})
            out["sent"][r] = list(old_sent)
            out["retry_after"][r] = retry
    return out


# ------------------------------------------------------------------ sending
def hermes_send(target: str, message: str) -> dict:
    """``send_message_tool`` of Hermes (what ``hermes send`` runs). The result is cut to what we keep."""
    try:
        from gateway.outbound.send import send_message_tool
    except ImportError:   # Hermes before the outbound senders moved
        from tools.send_message_tool import send_message_tool
    res = json.loads(send_message_tool({"action": "send", "target": target, "message": message}))
    return {"success": bool(res.get("success")), "error": "send_failed" if not res.get("success") else None}


def render(dispatch: dict, settings: dict, now: float) -> str:
    return format_message(dispatch["facts"], settings["lang"], settings["label"], platform=platform_of(dispatch["to"]), now=now, quiet=dispatch.get("quiet"))


# ------------------------------------------------------------------ the notifier (gateway process)
class Notifier:
    """One per process. ``on_tick`` is called by the dispatcher hook (once per board per tick): it returns at once, the
    work (reads, sending) runs in a daemon thread, one at a time, at most every ``EVAL_EVERY_S``."""

    def __init__(self, *, store=None, send: Callable[[str, str], dict] = hermes_send, read: Optional[Callable[[], tuple]] = None,
                 targets: Callable[[], list] = hermes_targets, clock: Callable[[], float] = time.time,
                 gateway_pid: Optional[Callable[[], Optional[int]]] = None, threaded: bool = True, every: float = EVAL_EVERY_S,
                 extras: Optional[Callable[[list, set], dict]] = None):
        self.store, self.send, self.read, self.targets, self.clock = store, send, read or _read_hermes, targets, clock
        self.extras = extras or _read_extras
        self.gateway_pid = gateway_pid or _gateway_pid
        self.threaded, self.every = threaded, every
        self.started = clock()           # when this process loaded the plugin: the moment the gateway came back
        self._lock = threading.Lock()
        self._last = float("-inf")
        self._approvals: list[str] = []
        self._exit_hooked = False
        self.last_result: Optional[dict] = None

    # -- hooks (never raise, never block)
    def on_tick(self, **_kwargs) -> None:
        try:
            now = time.monotonic()
            if now - self._last < self.every or self._lock.locked():
                return
            self._last = now
            if self.threaded:
                threading.Thread(target=self.tick, name="officecraft-notify", daemon=True).start()
            else:
                self.tick()
        except Exception as exc:   # noqa: BLE001 - a hook must never break the dispatcher
            log.warning("hermes-officecraft notify tick failed: %s", type(exc).__name__)

    def on_approval(self, surface=None, **_kwargs) -> None:
        """``pre_approval_request``: only that a request exists, never its command, description or session."""
        if surface in ("cli", "gateway"):
            self._approvals.append(f"{int(self.clock() * 1000)}-{len(self._approvals)}")

    def on_approval_done(self, surface=None, **_kwargs) -> None:
        """``post_approval_response``: only the answer to a request ``on_approval`` counted. The smart approver and
        plugin transports fire it too (their pre-hook is ignored); popping on those would drop a human request."""
        if surface in ("cli", "gateway") and self._approvals:
            self._approvals.pop(0)

    # -- work
    def tick(self) -> Optional[dict]:
        if not self._lock.acquire(blocking=False):
            return None
        try:
            return self._tick()
        except Exception as exc:   # noqa: BLE001
            log.warning("hermes-officecraft notify failed: %s: %s", type(exc).__name__, exc)
            return None
        finally:
            self._lock.release()

    def _tick(self) -> Optional[dict]:
        store = self.store or _state_store()
        settings = load_settings(store)
        now = self.clock()
        known = {t["key"]: t for t in self.targets()} if any(settings["types"].values()) else {}
        routes = {t: [r for r in settings["routes"][t] if r in known] for t in TYPES}
        enabled = {t for t in TYPES if settings["types"][t] and routes[t]}
        state = migrate_state(store.get(STATE_KEY, None) or {}, routes)
        if not enabled:
            if any(v for a in (state.get("armed") or {}).values() for v in a.values()):
                store.set(STATE_KEY, plan([], routes, set(), state, now)[1])   # disarm: the next switch-on starts from a new baseline
            return None
        boards, ops = self.read()
        self._gateway_return(state, enabled, now)
        extra = self.extras(boards, enabled) or {}
        facts = detect(boards, ops, now, approvals=list(self._approvals), gateway_return=state.get("return"),
                       extras=extra.get("extras"), llm=extra.get("llm"), trophies=extra.get("trophies"))
        quiet = settings["quiet"]
        dispatches, state = plan(facts, routes, enabled, state, now, quiet_now=in_quiet(quiet, now), urgent=tuple(quiet["urgent"]), quiet=quiet)
        result = None
        for d in dispatches:
            try:
                res = self.send(known[d["to"]]["target"], render(d, settings, now))
            except Exception as exc:   # noqa: BLE001
                res = {"success": False, "error": type(exc).__name__}
                log.warning("hermes-officecraft notification not sent: %s", type(exc).__name__)   # the class only, never the message or the target
            result = {"success": bool(res.get("success")), "count": len(d["facts"]), "at": int(now)}
            state = mark_sent(d, state, now) if result["success"] else mark_failed(d, state, now)
            state["last"] = result
            state.setdefault("lastBy", {})[d["to"]] = result
            self.last_result = result
        store.set(STATE_KEY, state)
        return result

    def _gateway_return(self, state: dict, enabled: set, now: float) -> None:
        """Gateway tracking, only in the process that IS the gateway: the last sign of life, and on a new process the
        stop that just ended (« from the last sign of life to the return »), kept in the state until it is notified."""
        if "gateway" not in enabled or self.gateway_pid() != os.getpid():
            return
        pid = os.getpid()
        if state.get("pid") not in (None, pid) and state.get("alive") and (state.get("return") or {}).get("key") != f"gateway:{pid}":
            state["return"] = {"key": f"gateway:{pid}", "from": int(state["alive"]), "to": int(min(self.started, now))}
        state["pid"], state["alive"] = pid, int(now)
        if not self._exit_hooked:
            self._exit_hooked = True
            atexit.register(self._at_exit)

    def _at_exit(self) -> None:
        try:
            store = self.store or _state_store()
            state = store.get(STATE_KEY, None) or {}
            if state.get("pid") == os.getpid():
                state["alive"] = int(self.clock())
                store.set(STATE_KEY, state)
        except Exception:   # noqa: BLE001, S110 - best effort at interpreter exit
            pass


def _gateway_pid() -> Optional[int]:
    try:
        from hermes_constants import get_hermes_home
        pid = json.loads((Path(get_hermes_home()) / "gateway_state.json").read_text(encoding="utf-8-sig")).get("pid")
        return pid if isinstance(pid, int) else None
    except Exception:   # noqa: BLE001
        return None


def _read_hermes() -> tuple:
    from .snapshot import hermes_boards, hermes_ops
    return hermes_boards(history=False), hermes_ops()


def _read_extras(boards: list, enabled: set) -> dict:
    """What only some types need, read only when one of them is on: the kanban extras (campaign, review, since when a card is
    blocked), the LLM budget, the trophies the page recorded. A source that fails says nothing (never a false fact)."""
    out: dict = {}
    if enabled & {"decision", "campaign", "review"}:
        try:
            from .snapshot import hermes_notify_extras
            out["extras"] = hermes_notify_extras()
        except Exception as exc:   # noqa: BLE001
            log.debug("hermes-officecraft notify extras unreadable: %s", type(exc).__name__)
    if "llm_cap" in enabled:
        try:
            from . import llm
            engine = llm.engine()
            out["llm"] = {"spend": engine.spend(), "settings": engine.settings()}
        except Exception as exc:   # noqa: BLE001
            log.debug("hermes-officecraft notify llm budget unreadable: %s", type(exc).__name__)
    if "trophy" in enabled:
        try:
            out["trophies"] = list((_state_store().get(TROPHY_KEY, None) or {}).get("pending") or [])
        except Exception as exc:   # noqa: BLE001
            log.debug("hermes-officecraft notify trophies unreadable: %s", type(exc).__name__)
    return out


_notifier: Optional[Notifier] = None


def notifier() -> Notifier:
    global _notifier
    if _notifier is None:
        _notifier = Notifier()
    return _notifier


# ------------------------------------------------------------------ trophies (POST /notify/trophy)
class TrophyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Annotated[str, StringConstraints(pattern=r"^[a-z0-9_]{1,40}$")]
    name: Annotated[str, StringConstraints(min_length=1, max_length=60)]
    tier: Optional[Literal["bronze", "silver", "gold"]] = None


class TrophiesIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    trophies: list[TrophyIn] = Field(max_length=12)


_trophy_lock = threading.Lock()


def record_trophies(body: TrophiesIn, store=None, now: Optional[float] = None) -> dict:
    """The page tells the server which trophies it just saw unlocked (only when it is open: the game layer is computed by the
    page). Idempotent: a trophy (id + tier) is recorded ONCE, however many tabs report it. It becomes a fact only when the
    ``trophy`` type is on and routed, and not when the post is a first sync (more than ``TROPHY_FIRST_SYNC`` new at once)."""
    store = store or _state_store()
    now = time.time() if now is None else now
    settings = load_settings(store)
    live = settings["types"]["trophy"] and bool(settings["routes"]["trophy"])
    with _trophy_lock:
        rec = store.get(TROPHY_KEY, None)
        rec = rec if isinstance(rec, dict) else {}
        seen = dict(rec.get("seen") or {})
        pending = [p for p in rec.get("pending") or [] if isinstance(p, dict) and isinstance(p.get("ts"), (int, float)) and now - p["ts"] < TROPHY_TTL_S]
        fresh = []
        for t in body.trophies:
            key = f"{t.id}:{t.tier or '-'}"
            if key not in seen and key not in {x["key"] for x in fresh}:
                fresh.append({"key": key, "id": t.id, "name": _clean_name(t.name), "tier": t.tier})
        first_sync = len(fresh) > TROPHY_FIRST_SYNC
        for f in fresh:
            seen[f["key"]] = int(now)
            if live and not first_sync:
                pending.append({"id": f["id"], "name": f["name"], "tier": f["tier"], "ts": int(now)})
        seen = dict(sorted(seen.items(), key=lambda kv: kv[1])[-TROPHY_MEMORY:])
        store.set(TROPHY_KEY, {"seen": seen, "pending": pending[-TROPHY_PENDING_MAX:]})
    news = 0 if (first_sync or not live) else len(fresh)
    return {"ok": True, "recorded": len(fresh), "notify": news, "firstSync": first_sync}


def _clean_name(name: str) -> str:
    from .notify_format import _plain
    return _plain(name)[:60] or "?"


# ------------------------------------------------------------------ the test message (POST /notify/test)
class NotifyTestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target: TargetKey


_test_lock = threading.Lock()


def run_test(target_key: str, known: list[dict], *, store=None, send: Optional[Callable[[str, str], dict]] = None,
             now: Optional[float] = None, connected: Optional[Callable[[str], Optional[bool]]] = None,
             journal: Optional[Callable[[dict], Any]] = None) -> tuple[int, dict]:
    """ONE realistic test message (the real format, example facts marked « test ») to the recipient, at most 1 per minute and
    10 per day (every try that reaches the sender counts, so a failing platform is not hammered). The answer is
    ``{ok, error}``; the journal gets the verb, the recipient key and the result, never the text."""
    store = store or _state_store()
    now = time.time() if now is None else now
    send, connected, journal = send or hermes_send, connected or hermes_connected, journal or audit.append   # resolved now: a test can replace them
    entry = {"verb": "notify_test", "id": target_key, "source": "page", "risk": "safe", "ts": now}

    def done(status: int, body: dict, result: str, reason: Optional[str] = None) -> tuple[int, dict]:
        try:
            journal({**entry, "result": result, **({"reason": reason} if reason else {})})
        except Exception as exc:   # noqa: BLE001 - a journal that cannot be written never hides the answer
            log.warning("hermes-officecraft notify test journal failed: %s", type(exc).__name__)
        return status, body

    target = next((t for t in known if t["key"] == target_key), None)
    if target is None:
        return done(422, {"ok": False, "error": "unknown_target"}, "refused", "unknown_target")
    if connected(target["platform"]) is False:
        return done(409, {"ok": False, "error": "platform_not_connected"}, "refused", "platform_not_connected")
    with _test_lock:
        rec = store.get(TEST_KEY, None)
        recent = [s for s in (rec or {}).get("sent", []) if isinstance(s, (int, float)) and now - s < 86400]
        if recent and now - max(recent) < 60:
            wait = int(60 - (now - max(recent))) + 1
            return done(429, {"ok": False, "error": "rate_limited", "retryAfter": wait}, "refused", "rate_limited")
        if len(recent) >= TEST_PER_DAY:
            wait = int(86400 - (now - min(recent))) + 1
            return done(429, {"ok": False, "error": "daily_limit", "retryAfter": wait}, "refused", "daily_limit")
        store.set(TEST_KEY, {"sent": [*recent, int(now)]})
    settings = load_settings(store)
    message = format_message(sample_facts(settings["lang"], now), settings["lang"], settings["label"], platform=target["platform"], now=now, test=True)
    try:
        res = send(target["target"], message)
    except Exception as exc:   # noqa: BLE001
        log.warning("hermes-officecraft notify test send failed: %s", type(exc).__name__)
        res = {"success": False}
    if not res.get("success"):
        return done(502, {"ok": False, "error": "send_failed"}, "failed", "send_failed")
    return done(200, {"ok": True, "error": None}, "done")


def settings_payload(store=None, targets: Optional[list] = None) -> dict:
    """What ``GET /notify`` serves: the settings, the recipients (no chat id), the last results of the notifier."""
    store = store or _state_store()
    settings = load_settings(store)
    known = hermes_targets() if targets is None else targets
    keys = {t["key"] for t in known}
    state = store.get(STATE_KEY, None) or {}
    last = state.get("last") if isinstance(state.get("last"), dict) else None
    by = state.get("lastBy") if isinstance(state.get("lastBy"), dict) else {}
    routes = {t: [r for r in settings["routes"][t] if r in keys] for t in TYPES}
    legacy = legacy_target({**settings, "routes": routes})
    return {"settings": {"types": settings["types"], "routes": routes, "quiet": settings["quiet"], "lang": settings["lang"], "target": legacy},
            "targets": public_targets(known), "types": list(TYPES), "hourlyCap": HOURLY_CAP, "maxRoutes": MAX_ROUTES,
            "timezone": timezone_info(), "testLimits": {"perMinute": TEST_PER_MINUTE, "perDay": TEST_PER_DAY},
            "last": {k: last.get(k) for k in ("success", "count", "at")} if last else None,
            "lastBy": {r: {k: v.get(k) for k in ("success", "count", "at")} for r, v in by.items() if r in keys and isinstance(v, dict)}}
