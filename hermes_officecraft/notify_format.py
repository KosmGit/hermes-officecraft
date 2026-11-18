"""The words of a notification: what the user reads on a phone, in two seconds.

One message = a first line that says the essential (« ⏸ 2 decisions are waiting for you · alpha »), then the facts
grouped by type, one short line per fact: the card CODE (first word of the title, ``API3``, never the ``t_…`` id), the title
cut cleanly (≤ 50 characters), the agent, how long (« for 12 min »), the project only when the message has several.
One symbol per type, readable without colour. Numbers and times lead.

Plain text everywhere (a message must read without any rendering). Bold only where Hermes renders it safely, and then
EVERYTHING that is not ours is escaped: Telegram goes to HTML as soon as a tag appears (``tools/send_message_senders.py``
``_telegram_format``), so there every dynamic text is HTML-escaped and only our own ``<b>`` stays; Discord reads Markdown, so
its specials are backslash-escaped; every other platform (Slack, e-mail, Signal, SMS…) gets plain text. On ALL of them a
title is made inert first (``inert``): no tag, no ``[text](link)``, no ``MEDIA:<path>`` file attachment, no ``@everyone``,
no ``scheme://``. Whitelist: board, card code and title, agent, state, times, and the counted fields named in ``_STATES``;
a fact is read through these fields only.
"""

import html
import re
import time
import unicodedata
from typing import Any, Optional

LABEL_DEFAULT = "Officecraft"
TITLE_MAX = 50               # a title in a line (the old 80 was a sentence); cut at a word
MAX_LINES = 8                # fact lines in one message, the others are counted

_TASK_RE = re.compile(r"^t_[0-9a-f]{8}$")
_BOARD_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.@ -]{0,63}$")
_LABEL_RE = re.compile(r"^[\[\]A-Za-z0-9 _.-]{1,32}$")
_CODE_RE = re.compile(r"^[A-Z][A-Z0-9]*(?:[.\-][A-Z0-9]+)*$")     # DOCS1, API2-B2, S4.1, R-DOCS1, WEB0
_SEP_RE = re.compile(r"^[\s—–:|·-]+")                              # what follows a code before the title proper
_ID_RE = re.compile(r"^[a-z0-9_]{1,40}$")
_TIERS = ("bronze", "silver", "gold")
_CLOCK_RE = re.compile(r"^[0-2][0-9]:[0-5][0-9]$")

# what Hermes' sender reads as an instruction rather than text: ``MEDIA:<path>`` attaches that local file
# (gateway/platforms/base.py MEDIA_TAG_CLEANUP_RE, IGNORECASE), one HTML tag switches a Telegram message to HTML parse
# mode, ``[text](url)`` is a MarkdownV2 link, ``[[...]]`` a directive, ``@everyone`` / ``@here`` a mass mention.
_MEDIA_TAG_RE = re.compile(r"(media)(\s*:)", re.IGNORECASE)
_MENTION_RE = re.compile(r"@(?=(?:everyone|here|channel|all)\b)", re.IGNORECASE)
_SCHEME_RE = re.compile(r"(?i)\b([a-z][a-z0-9+.-]{1,15}):(?=//)")
_MAILTO_RE = re.compile(r"(?i)\b(mailto|tel|sms):")
# a bare domain (« evil.example/pay », « www.evil.example »): messaging apps turn it into a link without any scheme
_DOMAIN_DOT_RE = re.compile(r"(?i)(?<=[a-z0-9])\.(?=[a-z]{2,24}(?:[^a-z0-9]|$))")
_INERT = str.maketrans({"<": "‹", ">": "›", "[": "(", "]": ")"})
ZWSP = "\u200b"
TITLE_READ_MAX = 2000   # a title is cut to 50 characters anyway: never clean more than this of a hostile one

SYMBOLS = {"decision": "⏸", "silent": "🔇", "gateway": "⚡", "cron": "⏰", "campaign": "🚀", "review": "↩", "llm_cap": "💳", "trophy": "🏆"}
QUIET_SYMBOL = "🌙"
TYPE_ORDER = tuple(SYMBOLS)
# state -> type (a fact's type is read from its state, never trusted from another field)
_STATES = {"blocked": "decision", "approval": "decision", "silent": "silent", "stopped": "gateway", "degraded": "gateway",
           "cron_failed": "cron", "camp_ready": "campaign", "camp_done": "campaign", "review_changes": "review",
           "review_blocked": "review", "llm_90": "llm_cap", "llm_cap": "llm_cap", "trophy": "trophy"}

# the words of a message, per language (the page sends its language with the settings)
WORDS = {
    "en": {"facts1": "1 event", "factsn": "{n} events", "projects": "{n} projects", "more": "+{n} more",
           "decision1": "1 decision is waiting for you", "decisionn": "{n} decisions are waiting for you", "decision_s1": "1 decision", "decision_sn": "{n} decisions",
           "silent1": "1 agent silent", "silentn": "{n} agents silent",
           "gateway1": "1 gateway alert", "gatewayn": "{n} gateway alerts",
           "cron1": "1 scheduled job failed", "cronn": "{n} scheduled jobs failed",
           "campaign1": "1 campaign update", "campaignn": "{n} campaign updates",
           "review1": "1 review sent back", "reviewn": "{n} reviews sent back",
           "llm_cap1": "1 LLM budget alert", "llm_capn": "{n} LLM budget alerts",
           "trophy1": "1 trophy unlocked", "trophyn": "{n} trophies unlocked",
           "since": "for {span}", "ago": "{span} ago", "approval": "approval request waiting", "review_blocked": "reviewer needs your decision",
           "stopped": "stopped {start}–{end} · {span}", "degraded": "messaging app {name} needs attention",
           "camp_ready": "ready to launch · {n} cards", "camp_phase": "phase {letter}{name} ready to launch · {n} cards", "camp_done": "finished · {n} cards",
           "llm_90": "{pct} of the cap · {used} of {cap}", "llm_cap": "cap reached · {used} of {cap}",
           "llm_calls_90": "{pct} of the cap · {used} of {cap} calls", "llm_calls_cap": "cap reached · {used} of {cap} calls",
           "tier": "{tier} tier", "bronze": "bronze", "silver": "silver", "gold": "gold",
           "quiet": "Quiet hours {start}–{end}: {n} to review", "resolved": " · {m} resolved since", "resolved1": " · 1 resolved since",
           "test": "test", "sample_decision": "Sample decision to review", "sample_silent": "Sample silent card",
           "sample_cron": "nightly-sample", "sample_camp": "Sample campaign", "min": "min", "h": "h", "d": "d", "s": "s", "dollar": "${}", "pct": "{}%", "dec": "."},
    "fr": {"facts1": "1 événement", "factsn": "{n} événements", "projects": "{n} projets", "more": "+{n} autres",
           "decision1": "1 décision vous attend", "decisionn": "{n} décisions vous attendent", "decision_s1": "1 décision", "decision_sn": "{n} décisions",
           "silent1": "1 agent silencieux", "silentn": "{n} agents silencieux",
           "gateway1": "1 alerte gateway", "gatewayn": "{n} alertes gateway",
           "cron1": "1 tâche planifiée en échec", "cronn": "{n} tâches planifiées en échec",
           "campaign1": "1 nouveauté de campagne", "campaignn": "{n} nouveautés de campagne",
           "review1": "1 revue refusée", "reviewn": "{n} revues refusées",
           "llm_cap1": "1 alerte de budget LLM", "llm_capn": "{n} alertes de budget LLM",
           "trophy1": "1 trophée débloqué", "trophyn": "{n} trophées débloqués",
           "since": "depuis {span}", "ago": "il y a {span}", "approval": "demande d’approbation en attente", "review_blocked": "le relecteur attend votre décision",
           "stopped": "arrêté de {start} à {end} · {span}", "degraded": "la messagerie {name} est en difficulté",
           "camp_ready": "prête à lancer · {n} cartes", "camp_phase": "phase {letter}{name} prête à lancer · {n} cartes", "camp_done": "terminée · {n} cartes",
           "llm_90": "{pct} du plafond · {used} sur {cap}", "llm_cap": "plafond atteint · {used} sur {cap}",
           "llm_calls_90": "{pct} du plafond · {used} appels sur {cap}", "llm_calls_cap": "plafond atteint · {used} appels sur {cap}",
           "tier": "palier {tier}", "bronze": "bronze", "silver": "argent", "gold": "or",
           "quiet": "Heures calmes {start}–{end}\u00a0: {n} à voir", "resolved": " · {m} résolus entre-temps", "resolved1": " · 1 résolu entre-temps",
           "test": "test", "sample_decision": "Exemple de décision à prendre", "sample_silent": "Exemple de carte silencieuse",
           "sample_cron": "nuit-exemple", "sample_camp": "Campagne d’exemple", "min": "min", "h": "h", "d": "j", "s": "s", "dollar": "{} $", "pct": "{} %", "dec": ","},
    "es": {"facts1": "1 evento", "factsn": "{n} eventos", "projects": "{n} proyectos", "more": "+{n} más",
           "decision1": "1 decisión te espera", "decisionn": "{n} decisiones te esperan", "decision_s1": "1 decisión", "decision_sn": "{n} decisiones",
           "silent1": "1 agente en silencio", "silentn": "{n} agentes en silencio",
           "gateway1": "1 alerta del gateway", "gatewayn": "{n} alertas del gateway",
           "cron1": "1 tarea programada fallida", "cronn": "{n} tareas programadas fallidas",
           "campaign1": "1 novedad de campaña", "campaignn": "{n} novedades de campaña",
           "review1": "1 revisión devuelta", "reviewn": "{n} revisiones devueltas",
           "llm_cap1": "1 alerta de presupuesto LLM", "llm_capn": "{n} alertas de presupuesto LLM",
           "trophy1": "1 trofeo desbloqueado", "trophyn": "{n} trofeos desbloqueados",
           "since": "desde hace {span}", "ago": "hace {span}", "approval": "solicitud de aprobación en espera", "review_blocked": "el revisor espera tu decisión",
           "stopped": "detenido de {start} a {end} · {span}", "degraded": "la app de mensajería {name} necesita atención",
           "camp_ready": "lista para lanzar · {n} tarjetas", "camp_phase": "fase {letter}{name} lista para lanzar · {n} tarjetas", "camp_done": "terminada · {n} tarjetas",
           "llm_90": "{pct} del límite · {used} de {cap}", "llm_cap": "límite alcanzado · {used} de {cap}",
           "llm_calls_90": "{pct} del límite · {used} llamadas de {cap}", "llm_calls_cap": "límite alcanzado · {used} llamadas de {cap}",
           "tier": "categoría {tier}", "bronze": "bronce", "silver": "plata", "gold": "oro",
           "quiet": "Horas de silencio {start}–{end}: {n} por revisar", "resolved": " · {m} resueltos entretanto", "resolved1": " · 1 resuelto entretanto",
           "test": "prueba", "sample_decision": "Decisión de ejemplo por tomar", "sample_silent": "Tarjeta en silencio de ejemplo",
           "sample_cron": "noche-ejemplo", "sample_camp": "Campaña de ejemplo", "min": "min", "h": "h", "d": "d", "s": "s", "dollar": "{} $", "pct": "{} %", "dec": ","},
}
NBSP = "\u00a0"


# ------------------------------------------------------------------ text made safe
def _plain(text: Any) -> str:
    """One line of plain text: control, format (bidi, zero-width) and separator characters out, blanks collapsed."""
    if not isinstance(text, str):
        return ""
    kept = "".join(" " if unicodedata.category(c) in ("Zl", "Zp", "Cc") else ("" if unicodedata.category(c) == "Cf" else c) for c in text)
    return re.sub(r"\s+", " ", kept).strip()


def inert(text: str) -> str:
    """A title as plain text for every platform: no file attachment, no tag, no link markup, no mass mention."""
    text = _MEDIA_TAG_RE.sub(r"\1 \2", text.translate(_INERT))
    text = _MENTION_RE.sub("@" + ZWSP, text)
    text = _SCHEME_RE.sub(lambda m: m.group(1) + ":" + ZWSP, text)
    text = _MAILTO_RE.sub(lambda m: m.group(1) + ZWSP + ":", text)
    return _DOMAIN_DOT_RE.sub("." + ZWSP, text)


class Style:
    """How a platform renders: ``esc`` makes ANY dynamic text literal, ``bold`` wraps ours. ``plain`` does neither."""
    def __init__(self, kind: str = "plain"):
        self.kind = kind

    def esc(self, text: str) -> str:
        if self.kind == "html":
            return html.escape(text, quote=False)
        if self.kind == "markdown":
            return re.sub(r"([\\*_~`|>#])", r"\\\1", text)
        return text

    def bold(self, text: str) -> str:
        return {"html": f"<b>{text}</b>", "markdown": f"**{text}**"}.get(self.kind, text)


def style_for(platform: Optional[str]) -> Style:
    return Style({"telegram": "html", "discord": "markdown"}.get(platform or "", "plain"))


# ------------------------------------------------------------------ pieces of a line
def split_title(title: Any) -> tuple[Optional[str], str]:
    """``("API3", "Leftovers of S4: launches")`` from « API3 — Leftovers of S4: launches » (the code is the first word when it
    looks like one: capitals, digits, ``.`` and ``-``; a plain first word is part of the title)."""
    text = _plain(title[:TITLE_READ_MAX] if isinstance(title, str) else title)
    head, _, rest = text.partition(" ")
    if _CODE_RE.fullmatch(head) and len(head) <= 16 and (any(c.isdigit() for c in head) or _SEP_RE.match(rest) or not rest):
        return head, _SEP_RE.sub("", rest).strip()
    return None, text


def cut(text: str, limit: int = TITLE_MAX) -> str:
    """Cut at a word, with an ellipsis; a word longer than the limit is cut where it stands."""
    if len(text) <= limit:
        return text
    head = text[:limit - 1]
    at = head.rfind(" ")
    head = head[:at] if at >= limit // 2 else head
    return head.rstrip(" ,;:.—–-·(") + "…"


def clock(ts: Any) -> str:
    return time.strftime("%H:%M", time.localtime(ts)) if isinstance(ts, (int, float)) and not isinstance(ts, bool) else "?"


def span(seconds: Any, lang: str = "en") -> str:
    """« 12 min », « 3 h 5 min », « 5 h », « 2 j » (a no-break space between the number and its unit in French). Never « 3 h 05 »:
    after « depuis » it reads as a time of day."""
    w = WORDS.get(lang, WORDS["en"])
    sp = NBSP if lang == "fr" else " "
    s = int(seconds) if isinstance(seconds, (int, float)) and not isinstance(seconds, bool) and seconds >= 0 else 0
    if s >= 86400:
        return f"{s // 86400}{sp}{w['d']}"
    if s >= 3600:
        m = (s % 3600) // 60
        return f"{s // 3600}{sp}{w['h']}" + (f"{sp}{m}{sp}{w['min']}" if m else "")
    return f"{s // 60}{sp}{w['min']}" if s >= 60 else f"{s}{sp}{w['s']}"


def _num(value: Any, lang: str) -> str:
    n = round(float(value), 2) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0.0
    text = f"{n:.2f}".rstrip("0").rstrip(".")
    return text.replace(".", WORDS.get(lang, WORDS["en"])["dec"])


def _money(value: Any, lang: str) -> str:
    return WORDS.get(lang, WORDS["en"])["dollar"].format(_num(value, lang)).replace(" ", NBSP if lang != "en" else " ")


def _int(value: Any, default: int = 0, top: int = 1_000_000) -> int:
    return min(max(int(value), 0), top) if isinstance(value, (int, float)) and not isinstance(value, bool) else default


def _age(fact: dict, now: Optional[float]) -> Optional[float]:
    since = fact.get("since")
    if isinstance(since, (int, float)) and not isinstance(since, bool) and now is not None:
        return max(now - since, 0)
    return None


# ------------------------------------------------------------------ one fact = one line
def clean_fact(fact: dict) -> Optional[dict]:
    """The fact re-validated, whitelisted fields only (a fact built from anything else stays safe): board and card code by
    pattern, texts cleaned (control and format characters out) and made inert, state from a closed list, counts as bounded
    integers. Any other key (body, comment, command...) is never read."""
    if not isinstance(fact, dict):
        return None
    state = fact.get("state")
    if state not in _STATES:
        return None
    out: dict = {"state": state, "type": _STATES[state]}
    if isinstance(fact.get("board"), str) and _BOARD_RE.fullmatch(fact["board"]):
        out["board"] = fact["board"]
    if isinstance(fact.get("task"), str) and _TASK_RE.fullmatch(fact["task"]):
        out["task"] = fact["task"]
    if isinstance(fact.get("agent"), str) and _NAME_RE.fullmatch(fact["agent"]):
        out["agent"] = fact["agent"]
    for key in ("title", "name"):
        text = fact.get(key) if isinstance(fact.get(key), str) else ""
        out[key] = text
    for key in ("span", "since", "start", "end", "count", "pct", "used", "cap"):
        v = fact.get(key)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) < 1e12:
            out[key] = v
    if isinstance(fact.get("phase"), int) and not isinstance(fact.get("phase"), bool) and 0 <= fact["phase"] <= 7:
        out["phase"] = fact["phase"]
    if fact.get("kind") in ("usd", "calls"):
        out["kind"] = fact["kind"]
    if fact.get("tier") in _TIERS:
        out["tier"] = fact["tier"]
    return out


def _head_text(f: dict, lang: str, style: Style, now: Optional[float], multi_project: bool, hide_title: bool = False) -> str:
    """The code (bold where bold exists) and the short title of a card fact."""
    code, rest = split_title(f.get("title"))
    rest = cut(inert(rest))
    parts = []
    if code:
        parts.append(style.bold(style.esc(code)))
    if rest:
        parts.append(style.esc(rest))
    return " ".join(parts)


def format_line(fact: dict, lang: str = "en", *, now: Optional[float] = None, multi_project: bool = False, style: Optional[Style] = None) -> str:
    """ONE fact as a short line, without bullet: ``API3 Leftovers of S4: launches · frontend · for 12 min``."""
    w = WORDS.get(lang, WORDS["en"])
    style = style or Style()
    f = clean_fact(fact)
    if f is None:
        return ""
    state, esc = f["state"], style.esc
    sp = NBSP if lang == "fr" else " "
    age = _age(f, now)
    if state == "stopped":
        dur = f["end"] - f["start"] if "start" in f and "end" in f and f["end"] >= f["start"] else 0
        return w["stopped"].format(start=clock(f.get("start")), end=clock(f.get("end")), span=span(dur, lang))
    if state == "approval":
        return w["approval"]
    if state == "degraded":
        name = _plain(f.get("title"))
        return w["degraded"].format(name=esc(inert(name)) if _NAME_RE.fullmatch(name) else "?")
    if state in ("llm_90", "llm_cap"):
        calls = f.get("kind") == "calls"
        key = ("llm_calls_" if calls else "llm_") + ("90" if state == "llm_90" else "cap")
        fmt = (lambda v: str(_int(v))) if calls else (lambda v: _money(v, lang))
        return w[key].format(pct=w["pct"].format(_int(f.get("pct"), 0, 999)).replace(" ", NBSP if lang != "en" else " "), used=fmt(f.get("used")), cap=fmt(f.get("cap")))
    if state in ("camp_ready", "camp_done"):
        name = cut(inert(_plain(f.get("name"))), 40)
        n = _int(f.get("count"))
        if state == "camp_done":
            what = w["camp_done"].format(n=n)
        elif "phase" in f and f["phase"] > 0:
            pname = cut(inert(_plain(f.get("title"))), 30)
            what = w["camp_phase"].format(letter=chr(ord("A") + f["phase"]), name=(f" ({esc(pname)})" if pname else ""), n=n)
        else:
            what = w["camp_ready"].format(n=n)
        parts = [style.bold(esc(name)) if name else "", what]
    elif state == "trophy":
        name = cut(inert(_plain(f.get("name"))), 40)
        tier = w["tier"].format(tier=w[f["tier"]]) if "tier" in f else ""
        parts = [style.bold(esc(name)) if name else "", tier]
    elif state == "cron_failed":
        name = cut(inert(_plain(f.get("title"))), 40)
        parts = [style.bold(esc(name)) if name else "", esc(inert(f["agent"])) if "agent" in f else "", w["ago"].format(span=span(age, lang)) if age is not None else ""]
    else:   # a card: blocked, silent, review_changes, review_blocked (the agent is made inert too: free text in the kanban)
        parts = [_head_text(f, lang, style, now, multi_project), esc(inert(f["agent"])) if "agent" in f else ""]
        if state == "silent":
            seconds = age if age is not None else f.get("span")
            parts.append(w["since"].format(span=span(seconds, lang)) if seconds is not None else "")
        elif state == "blocked":
            parts.append(w["since"].format(span=span(age, lang)) if age is not None else "")
        elif state == "review_changes":
            parts.append(w["ago"].format(span=span(age, lang)) if age is not None else "")
        elif state == "review_blocked":
            parts.append(w["review_blocked"])
    if multi_project and "board" in f:
        parts.append(esc(f["board"]))
    return " · ".join(p for p in parts if p)


# ------------------------------------------------------------------ one message
def _projects(facts: list[dict]) -> list[str]:
    seen: list[str] = []
    for f in facts:
        b = f.get("board")
        if isinstance(b, str) and _BOARD_RE.fullmatch(b) and b not in seen:
            seen.append(b)
    return seen


def _count_phrase(kind: str, n: int, lang: str, short: bool = False) -> str:
    w = WORDS.get(lang, WORDS["en"])
    if kind == "decision" and short:
        return w["decision_s1" if n == 1 else "decision_sn"].format(n=n)
    return w[f"{kind}{'1' if n == 1 else 'n'}"].format(n=n)


def format_message(facts: list[dict], lang: str = "en", label: str = LABEL_DEFAULT, *, platform: Optional[str] = None,
                   now: Optional[float] = None, quiet: Optional[dict] = None, test: bool = False) -> str:
    """The message for one recipient. ``quiet = {from, to, resolved}`` makes it the summary of the end of the quiet hours;
    ``test`` prefixes the first line with ``[test <label>]``."""
    w = WORDS.get(lang, WORDS["en"])
    style = style_for(platform)
    label = label if isinstance(label, str) and _LABEL_RE.fullmatch(label) else LABEL_DEFAULT
    cleaned = [c for c in (clean_fact(f) for f in facts) if c is not None]
    projects = _projects(cleaned)
    multi = len(projects) > 1
    by_type = {t: [f for f in cleaned if f["type"] == t] for t in TYPE_ORDER}
    types = [t for t in TYPE_ORDER if by_type[t]]
    where = (" · " + style.esc(projects[0])) if len(projects) == 1 else (" · " + w["projects"].format(n=len(projects))) if multi else ""
    if quiet is not None:
        start = quiet.get("from") if isinstance(quiet.get("from"), str) and _CLOCK_RE.fullmatch(quiet["from"]) else "?"
        end = quiet.get("to") if isinstance(quiet.get("to"), str) and _CLOCK_RE.fullmatch(quiet["to"]) else "?"
        resolved = _int(quiet.get("resolved"))
        head = f"{QUIET_SYMBOL} " + style.bold(w["quiet"].format(start=start, end=end, n=len(cleaned)) + (w["resolved1" if resolved == 1 else "resolved"].format(m=resolved) if resolved else "")) + where
    elif len(types) == 1:
        head = f"{SYMBOLS[types[0]]} " + style.bold(_count_phrase(types[0], len(by_type[types[0]]), lang)) + where
    else:
        head = style.bold(w["facts1"] if len(cleaned) == 1 else w["factsn"].format(n=len(cleaned))) + where
    if test:
        head = f"[test {label}] " + head
    lines = [head]
    shown = 0
    for t in types:
        group = by_type[t]
        block = []
        for f in group:
            if shown >= MAX_LINES:
                break
            line = format_line(f, lang, now=now, multi_project=multi, style=style)
            if line:
                block.append(line)
                shown += 1
        if len(types) > 1 or quiet is not None:
            if block:
                lines.append(f"{SYMBOLS[t]} " + style.bold(_count_phrase(t, len(group), lang, short=True)))
        lines += block
    extra = len(cleaned) - shown
    if extra > 0:
        lines.append(w["more"].format(n=extra))
    return "\n".join(lines)


def sample_facts(lang: str, now: float) -> list[dict]:
    """The example facts of the test message: the real format, every card code and project marked « test »."""
    w = WORDS.get(lang, WORDS["en"])
    mark = w["test"].upper()
    return [
        {"state": "blocked", "board": w["test"], "task": "t_00000001", "title": f"{mark}-1 — {w['sample_decision']}", "agent": "backend", "since": now - 12 * 60},
        {"state": "silent", "board": w["test"], "task": "t_00000002", "title": f"{mark}-2 — {w['sample_silent']}", "agent": "frontend", "since": now - 7 * 60},
        {"state": "cron_failed", "title": w["sample_cron"], "agent": "default", "since": now - 3 * 60},
        {"state": "camp_ready", "board": w["test"], "name": w["sample_camp"], "count": 5, "phase": 0},
    ]
