"""A title Officecraft accepts (a ZWNJ / ZWJ that joins two letters or two pictograms) is served as written
in ``/office`` (``snapshot.printable``) and ``/replay`` (``replay._title``); every other invisible character still goes.
Without the rule the Persian half-space was dropped on the way back: « می‌خواهم » was drawn « میخواهم »."""

import json
import pathlib
import sqlite3

import pytest

from test_replay_usage import R

S = R.snapshot
CASES = json.loads((pathlib.Path(__file__).resolve().parents[1] / "joiner_cases.json").read_text(encoding="utf-8"))
PERSIAN = "می\u200cخواهم این را امتحان کنم"
FAMILY = "\U0001F468\u200d\U0001F469\u200d\U0001F467 team"


def _board(tmp_path, title):
    db = tmp_path / "kanban.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, assignee TEXT, status TEXT NOT NULL, created_at INTEGER,"
                " started_at INTEGER, completed_at INTEGER, last_heartbeat_at INTEGER)")
    con.execute("INSERT INTO tasks VALUES ('t1', ?, NULL, 'blocked', 1, NULL, NULL, NULL)", (title,))
    con.commit()
    con.close()
    return db


@pytest.mark.parametrize("title", [PERSIAN, FAMILY, "क्\u200dष"])
def test_a_joining_zwnj_or_zwj_is_served_as_written(tmp_path, title):
    assert S.read_board(_board(tmp_path, title), "demo", history=False)["tasks"][0]["title"] == title
    assert R._title(title) == title


@pytest.mark.parametrize("text,ok,why", CASES["cases"], ids=[c[2] for c in CASES["cases"]])
def test_served_text_keeps_a_joiner_only_where_a_write_accepts_it(text, ok, why):
    served = S.printable(text)
    assert all(c.isprintable() or c in "\u200c\u200d" for c in served), why
    if ok:
        assert served == text.strip(), why   # accepted on write -> drawn as written
    assert not any(c in served for c in "\u200b\u2060\ufeff\u200e\u200f\u202e\u2066\u00ad\u2028\x00"), why


def test_a_stray_joiner_and_a_bidi_override_still_go(tmp_path):
    title = S.read_board(_board(tmp_path, "\u200cFix \u202eatad\u2069 a\u200c b\u200d"), "demo", history=False)["tasks"][0]["title"]
    assert title == "Fix atad a b"
