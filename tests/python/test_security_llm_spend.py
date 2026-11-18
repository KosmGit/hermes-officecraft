"""Security of the agent half of the useful LLM functions. A FAKE client only: no test reaches a model.

Hole 1: the ``last`` entries of the stored spend were read as stored. A hand-edited or damaged ``state.json`` (``usd`` as text, an entry that is
not a record) made every call of that function fail as ``model_error`` for the rest of the month (TypeError before the call), a ``NaN`` or negative
``usd`` cancelled the « the next call would pass the cap » check, and ``GET /llm`` served ``costs.lastUsd`` as stored. Rule: a damaged amount
reads as « cap reached », never as a fresh start, and nothing is served that is not a finite amount.
"""

import json
import math

import pytest

from test_llm import BASE, L, world  # noqa: F401  (the ``world`` fixture of test_llm)
import test_llm_campaign as LC


@pytest.fixture
def lm(world):
    world.readers.profiles = lambda: LC.ROSTER
    world.switch(lint=True)
    world.llm.reply = LC.GOOD_LINT
    return world


def lint(w):
    return w.client.post(f"{BASE}/llm/lint", json={"id": w.uid(), **LC.BODIES["lint"]})


def damage(w, last):
    spend = L.empty_spend(w.clock())
    spend["last"] = last
    w.store.data[L.SPEND_KEY] = spend


@pytest.mark.parametrize("entry", [{"usd": "abc"}, {"usd": math.nan}, {"usd": -1e9}, {"usd": math.inf}, {"usd": [1]}])
def test_a_damaged_last_amount_reads_as_cap_reached_and_calls_nothing(lm, entry):
    damage(lm, {"lint": {**entry, "at": lm.clock() - 10, "status": "estimated"}})
    out = lint(lm)
    assert out.status_code == 200
    assert (out.json()["result"], out.json().get("reason"), out.json().get("cap")) == ("refused", "cap_reached", "usd") and lm.llm.calls == []


@pytest.mark.parametrize("last", [{"lint": [1]}, {"lint": "x"}, "notadict", {"lint": {"at": "z", "usd": None}, "art": {"at": 5}}])
def test_a_damaged_last_entry_is_dropped_and_the_call_goes_out(lm, last):
    damage(lm, last)
    out = lint(lm).json()
    assert out["result"] == "done" and len(lm.llm.calls) == 1


def test_get_llm_serves_only_finite_amounts_of_the_last_calls(lm):
    damage(lm, {"lint": {"usd": "abc", "at": 1}, "decor": {"usd": None, "at": "z"}, "art": [1], "evil": {"usd": 1.0, "at": 1}})
    state = lm.client.get(f"{BASE}/llm").json()
    assert state["ok"] is True
    for feature, c in state["costs"].items():
        assert c["lastUsd"] is None or (isinstance(c["lastUsd"], (int, float)) and math.isfinite(c["lastUsd"]) and c["lastUsd"] >= 0), (feature, c)
    assert "evil" not in json.dumps(state["costs"])
