"""Security of the names and titles served, page and agent. FAKE files only.

Hole 1: a cron name was served as written (``snapshot._cron_name``): a right-to-left override (U+202E), an isolate, a zero-width
        space or a line break in it reached the page, in the replay journal (``GET /replay`` ``crons``) and in ``/live``, and
        reordered what is drawn after it on the same line (« backup ‮atad lla eteled · default » is drawn « backup tluafed · delete
        all data »), with no length bound (5 018 characters served for one name). A card title had the same hole in ``/live``
        (``/replay`` already kept printable characters only, ``replay._title``). Both are now printable text, the name ≤ 120.
Hole 2: an Agencement fiche (pairs) whose name is a list or an object made the validator's own diagnostic line raise
        (``frozenset`` of a list): the fiche was still refused, but as « model_error » instead of « invalid_output », with no
        diagnostic line, and the answer was not kept for its id. The validator now refuses it like any other bad pair.
"""

import json
import sqlite3
import time

from test_replay_usage import R

S = R.snapshot
TRAP = "nightly\u202ekcab\u2066x\u2069\u200b\n\u2028\u2029\x07" + "A" * 5000


def _printable_only(text):
    return all(c.isprintable() for c in text)


def _cron_home(tmp_path, name):
    (tmp_path / "cron").mkdir()
    (tmp_path / "cron" / "jobs.json").write_text(json.dumps({"jobs": [{"id": "j1", "name": name, "schedule": {"kind": "cron", "expr": "0 3 * * *"}}]}))
    con = sqlite3.connect(tmp_path / "cron" / "executions.db")
    con.execute("CREATE TABLE executions (job_id TEXT, status TEXT, finished_at TEXT, claimed_at TEXT)")
    at = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(time.time() - 60))
    con.execute("INSERT INTO executions VALUES ('j1', 'completed', ?, ?)", (at, at))
    con.commit()
    con.close()
    return tmp_path


def test_a_cron_name_is_served_as_printable_text_in_replay_and_live(tmp_path):
    home = _cron_home(tmp_path, TRAP)
    now = int(time.time())
    rows = R.read_crons_window("default", home, now - 3600, now)
    assert len(rows) == 1
    name = rows[0][1]
    assert _printable_only(name) and name.startswith("nightlykcabx") and len(name) <= S.CRON_NAME_MAX
    live = S.read_crons(home / "cron" / "jobs.json", "default")
    assert live[0]["name"] == name


def test_a_cron_without_a_name_falls_back_to_a_printable_skill_or_id(tmp_path):
    assert S._cron_name({"id": "j\u202e9", "skills": ["\u2066tidy\u2069"]}) == "tidy"
    assert S._cron_name({"id": "j\u202e9\n"}) == "j9"
    assert S._cron_name({"id": "\u200b", "name": "\u202e"}) is None


def test_a_card_title_in_live_is_printable_text(tmp_path):
    db = tmp_path / "kanban.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, assignee TEXT, status TEXT NOT NULL, created_at INTEGER,"
                " started_at INTEGER, completed_at INTEGER, last_heartbeat_at INTEGER)")
    con.execute("INSERT INTO tasks VALUES ('t1', ?, NULL, 'blocked', 1, NULL, NULL, NULL)", ("Fix \u202eatad lla eteled\u2069 <b>x</b>\n",))
    con.commit()
    con.close()
    title = S.read_board(db, "demo", history=False)["tasks"][0]["title"]
    assert title == "Fix atad lla eteled <b>x</b>"   # the markup stays text (the page never injects HTML); invisible controls go


from test_llm import L, world  # noqa: E402,F401  (the fake-model world of the LLM tests)


def test_a_pair_named_by_a_list_or_an_object_is_an_invalid_output(world, caplog):  # noqa: F811
    world.switch(seating=True)
    for bad in (["dev"], {"n": "dev"}):
        world.llm.reply = {"pairs": [{"a": bad, "b": "writer", "why": "relay"}]}
        out = world.post("seating").json()
        assert (out["result"], out["reason"]) == ("failed", "invalid_output")
    assert L.validate_seating({"pairs": [{"a": ["dev"], "b": ["dev"], "why": "relay"}]}, ["dev", "writer"]) is None
    assert "seating rejected: pairs=1" in caplog.text   # the diagnostic line (counters, never a name) is written
