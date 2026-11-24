"""Audit journal of the orders: ``audit.jsonl`` in the data folder Hermes gives the plugin.

One JSON line per order TRIED (refused and failed ones included). Only the fields of ``FIELDS`` are ever written
or served, whatever the caller passes: never a comment text (its length only, like Hermes' own ``commented``
event), an approval command, a session title, a path, a token or a raw exception message. Strings are cut at 256
characters. The file is 0600 in a 0700 folder and rotates like Hermes' dashboard-auth journal (5 MB x 3 backups).
"""

import json
import logging
import os
import re
import threading
import time
from pathlib import Path

log = logging.getLogger(__name__)

PLUGIN_ID = "hermes-officecraft"
FILE_NAME = "audit.jsonl"
MAX_FIELD = 256
MAX_BYTES = 5 * 1024 * 1024
BACKUPS = 3
TAIL_BYTES = 512 * 1024   # how far back a `GET /orders` looks in one file
MAX_LIMIT = 50

# the only keys a line can carry (and the only ones served back)
FIELDS = ("ts", "id", "verb", "risk", "board", "task", "result", "reason", "before", "after", "len", "choice", "profile", "source", "request",
          "created", "links", "guards", "archived", "boardCreated", "boardArchived")   # counts and flags of a campaign, never a text
VERBS = ("unblock", "comment", "approval", "recruit", "revise", "campaign", "launch", "cancel_campaign", "notify_test")
COUNTS = ("created", "links", "guards", "archived")
FLAGS = ("boardCreated", "boardArchived")
RISKS = ("safe", "rev", "reversible", "final")   # `rev` = the page's reversible class (revise lines); `reversible` kept for old lines
RESULTS = ("done", "refused", "failed")
SOURCES = ("agent", "page")
CHOICES = ("deny", "once", "session", "always")
_STATUS_RE = re.compile(r"^[a-z_]{1,32}$")
# the id Hermes gave an approval request (`request_id`, a 32-hex uuid), as the page read it in `approval.pending`
# before answering. An opaque id, never a command or a description; anything else is dropped, not cut (a cut id names nothing).
REQUEST_RE = re.compile(r"^[A-Za-z0-9_-]{8,128}$")
# the other texts of a line are names and codes, each with its shape: a value of another shape is dropped, not cut, so that no free
# text (a board slug refused for its shape, a reason typed by hand) ever reaches the journal or is served back from it
_SHAPES = {"id": re.compile(r"^[A-Za-z0-9_#:.-]{1,128}$"),   # a uuid, or the short handle of a recipient (« platform#hash »)
           "board": re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$"), "profile": re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$"),
           "task": re.compile(r"^[A-Za-z0-9_-]{1,64}$"), "reason": re.compile(r"^[a-z][a-z0-9_]{0,63}$")}

_write_lock = threading.Lock()


def data_dir() -> Path:
    """The folder Hermes gives the plugin (``PluginState(...).data_dir``), never a path built by us or the client."""
    from hermes_cli.plugins_state import PluginState
    return Path(PluginState(PLUGIN_ID).data_dir)


def _text(value, limit: int = MAX_FIELD):
    if isinstance(value, bool) or value is None or not isinstance(value, str):
        return None
    return value[:limit]


def _statuses(value):
    """`before` / `after`: a status name and nothing else (`after.comments` is served by the route, not journaled)."""
    status = value.get("status") if isinstance(value, dict) else None
    # fullmatch, not match: `$` also matches before a final "\n"
    return {"status": status} if isinstance(status, str) and _STATUS_RE.fullmatch(status) else None


def clean(entry: dict) -> dict:
    """Keep the whitelisted fields, each with the right type and bounds; drop the rest, silently."""
    out: dict = {}
    for key in FIELDS:
        value = entry.get(key)
        if value is None:
            continue
        if key == "ts":
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                out[key] = int(value)
        elif key == "len":
            if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 1_000_000:
                out[key] = value
        elif key in COUNTS:
            if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 1_000:
                out[key] = value
        elif key in FLAGS:
            if isinstance(value, bool):
                out[key] = value
        elif key in ("before", "after"):
            statuses = _statuses(value)
            if statuses:
                out[key] = statuses
        elif key == "verb":
            if value in VERBS:
                out[key] = value
        elif key == "risk":
            if value in RISKS:
                out[key] = value
        elif key == "result":
            if value in RESULTS:
                out[key] = value
        elif key == "source":
            if value in SOURCES:
                out[key] = value
        elif key == "choice":
            if value in CHOICES:
                out[key] = value
        elif key == "request":
            if isinstance(value, str) and REQUEST_RE.fullmatch(value):
                out[key] = value
        else:   # id, board, task, reason, profile
            text = _text(value)
            if text is not None and _SHAPES[key].fullmatch(text):
                out[key] = text
    return out


def private_dir(folder: Path) -> None:
    """The data folder is 0700 even when Hermes' ``PluginState`` created it first with the umask (0775):
    ``mkdir(mode=0o700, exist_ok=True)`` never narrows a folder that already exists."""
    try:
        if os.stat(folder).st_mode & 0o077:
            os.chmod(folder, 0o700)
    except OSError as exc:
        log.warning("hermes-officecraft data folder mode not set: %s", type(exc).__name__)


def _rotate(path: Path) -> None:
    if not path.exists() or path.stat().st_size < MAX_BYTES:
        return
    for n in range(BACKUPS, 0, -1):
        src = path if n == 1 else path.with_name(f"{path.name}.{n - 1}")
        if src.exists():
            os.replace(src, path.with_name(f"{path.name}.{n}"))


def append(entry: dict, directory: Path | None = None) -> dict:
    """Write one line (whitelisted, stamped with the time when the caller gave none); returns what was written."""
    line = clean(entry)
    line.setdefault("ts", int(time.time()))   # a caller's bad `ts` is dropped by `clean`: the line is still stamped
    folder = Path(directory) if directory is not None else data_dir()
    with _write_lock:
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        private_dir(folder)
        path = folder / FILE_NAME
        _rotate(path)
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        try:
            os.write(fd, (json.dumps(line, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
        finally:
            os.close(fd)
    return line


def _tail_lines(path: Path) -> list[str]:
    try:
        with open(path, "rb") as handle:
            size = handle.seek(0, os.SEEK_END)
            handle.seek(max(0, size - TAIL_BYTES))
            raw = handle.read()
    except OSError:
        return []
    lines = raw.decode("utf-8", errors="replace").splitlines()
    if size > TAIL_BYTES and lines:
        lines = lines[1:]   # the first line may be cut in two
    return lines


def read_tail(limit: int = 20, directory: Path | None = None, *, cap: int = MAX_LIMIT) -> list[dict]:
    """The last ``limit`` (at most ``cap``: 50 for the route) entries, newest first, each passed through the whitelist again."""
    limit = max(1, min(int(limit), cap))
    folder = Path(directory) if directory is not None else data_dir()
    entries: list[dict] = []
    for name in (FILE_NAME, FILE_NAME + ".1"):
        for line in reversed(_tail_lines(folder / name)):
            try:
                parsed = json.loads(line)
            except ValueError:
                continue
            cleaned = clean(parsed) if isinstance(parsed, dict) else {}
            if cleaned.get("id"):
                entries.append(cleaned)
                if len(entries) >= limit:
                    return entries
    return entries


def read_range(frm: int, to: int, directory: Path | None = None) -> list[dict]:
    """Every journaled order with ``frm <= ts <= to`` (replay), oldest first, each line passed through the whitelist
    again. Reads the live file and its backups (each at most ``MAX_BYTES``). An absent file is an empty journal; a file that
    exists and cannot be read raises ``OSError`` (the route then names the source in ``partial``)."""
    folder = Path(directory) if directory is not None else data_dir()
    entries: list[dict] = []
    for name in [f"{FILE_NAME}.{n}" for n in range(BACKUPS, 0, -1)] + [FILE_NAME]:
        entries.extend(_range_of(folder / name, frm, to))
    entries.sort(key=lambda e: e["ts"])
    return entries


def _range_of(path: Path, frm: int, to: int) -> list[dict]:
    try:
        with open(path, "rb") as handle:
            raw = handle.read(MAX_BYTES + 65_536)
    except FileNotFoundError:
        return []
    out = []
    for line in raw.decode("utf-8", errors="replace").splitlines():
        try:
            parsed = json.loads(line)
        except ValueError:
            continue
        cleaned = clean(parsed) if isinstance(parsed, dict) else {}
        if cleaned.get("id") and "ts" in cleaned and frm <= cleaned["ts"] <= to:
            out.append(cleaned)
    return out
