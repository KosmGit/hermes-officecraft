"""Agent half: the joiner rule of ``_m("campaign")._printable`` (ZWNJ / ZWJ between two letters or inside an emoji sequence, the rest of
Unicode Cf refused) and runs without a profile (a « Launch » is not an execution). The case table is shared with tests/js/campaign.test.mjs."""

import json
import pathlib

import pytest

from test_campaign import _m

CASES = json.loads((pathlib.Path(__file__).resolve().parents[1] / "joiner_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("text,ok,why", CASES["cases"], ids=[c[2] for c in CASES["cases"]])
def test_printable_joiners(text, ok, why):
    assert _m("campaign")._printable(text) is ok, (why, ascii(text))


@pytest.mark.parametrize("text,ok,why", CASES["multiline"], ids=[c[2] for c in CASES["multiline"]])
def test_printable_joiners_multiline(text, ok, why):
    assert _m("campaign")._printable(text, multiline=True) is ok, (why, ascii(text))


def test_a_line_break_is_refused_outside_instructions():
    assert _m("campaign")._printable("a\nb") is False
    assert _m("campaign")._printable("a\nb", multiline=True) is True


def test_the_models_use_the_rule():
    """Every field that carries free text goes through the same rule (title, goal, phase name, project name, instructions)."""
    persian = "می\u200cخواهم"
    assert _m("campaign").PhaseIn(name=persian).name == persian
    assert _m("campaign").NewBoardIn(slug="ok", name=persian).name == persian
    assert _m("campaign").CardIn(ref="a", kind="card", phase=0, assignee="alpha", title=persian, body="x\n" + persian).title == persian
    for bad in ("\u200cabc", "a\u200c\u200cb", "to\u200bdo", "a\u202eb"):
        with pytest.raises(ValueError):
            _m("campaign").PhaseIn(name=bad)
        with pytest.raises(ValueError):
            _m("campaign").NewBoardIn(slug="ok", name=bad)
        with pytest.raises(ValueError):
            _m("campaign").CardIn(ref="a", kind="card", phase=0, assignee="alpha", title=bad)


# ------------------------------------------------------------------ a « Launch » is not an execution

def _board_with_launch(tmp_path):
    """A worker's run, and the synthetic run `complete_task` writes for a guard (no profile, no pid)."""
    import sqlite3
    from test_replay_usage import make_board
    db = make_board(tmp_path / "kanban.db", tasks=[("t1", "Guard"), ("t2", "Work")],
                    events=[("t1", "completed", None, 1_799_990_100, 1), ("t2", "completed", None, 1_799_990_300, 2)],
                    runs=[(1, "t1", None, 1_799_990_100, 1_799_990_100, "completed"),
                          (2, "t2", "alice", 1_799_990_200, 1_799_990_300, "completed"),
                          (3, "t1", "", 1_799_990_400, 1_799_990_400, "completed")])
    return db


def test_snapshot_serves_no_run_without_a_profile(tmp_path):
    from test_replay_usage import S
    board = S.read_board(_board_with_launch(tmp_path), "demo")
    assert [r["profile"] for r in board["runs"]] == ["alice"]


def test_replay_serves_no_run_without_a_profile(tmp_path):
    from test_replay_usage import NOW, R, replay
    body, _ = replay([("b", _board_with_launch(tmp_path))])
    runs = next(b for b in body["boards"] if b["slug"] == "b")["runs"]
    assert [r["profile"] for r in runs] == ["alice"] and all(r["profile"] for r in runs)
