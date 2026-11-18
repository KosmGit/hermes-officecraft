"""Security of the useful LLM functions (page + agent). A FAKE client only: no test reaches a model.

Hole 1: the model and provider Hermes REPORTS for a call (``result.model``, ``result.provider``) were kept in the stored spend (``last``), served by
``GET /llm`` (``route``) and in the answer of a draft call (``model``, ``provider``) after a mere ``clean`` (control characters out, 120 characters):
a value shaped like a key went through. Same rule as a model chosen in the settings (``clean_model``): a name shaped like a key is never
kept, never served (None).
"""

import json

import pytest

from test_llm import BASE, L, world  # noqa: F401  (the ``world`` fixture of test_llm)
import test_llm_campaign as LC

# shapes of a key, built at run time (no literal key in the repository)
KEYS = ["sk-" + "A1" * 12, "Bearer " + "x" * 16, "ghp_" + "Z" * 20, "f" * 40]


@pytest.fixture
def lm(world):
    world.readers.profiles = lambda: LC.ROSTER
    world.switch(lint=True)
    world.llm.reply = LC.GOOD_LINT
    return world


def reporting(w, model, provider):
    real = w.llm.complete_structured

    def spy(**kw):
        r = real(**kw)
        r.model, r.provider = model, provider
        return r
    w.llm.complete_structured = spy


@pytest.mark.parametrize("key", KEYS)
def test_a_reported_model_shaped_like_a_key_is_never_kept_nor_served(lm, key):
    reporting(lm, key, key)
    out = lm.client.post(f"{BASE}/llm/lint", json={"id": lm.uid(), **LC.BODIES["lint"]}).json()
    assert out["result"] == "done"
    assert out.get("model") is None and out.get("provider") is None
    assert key not in json.dumps(lm.store.data)
    state = lm.client.get(f"{BASE}/llm").json()
    assert key not in json.dumps(state)
    assert state["route"]["model"] is None and state["route"]["provider"] is None


def test_a_reported_model_that_reads_like_a_name_is_kept_and_served(lm):
    reporting(lm, "example/model-fast", "acme-cloud")
    out = lm.client.post(f"{BASE}/llm/lint", json={"id": lm.uid(), **LC.BODIES["lint"]}).json()
    assert (out["model"], out["provider"]) == ("example/model-fast", "acme-cloud")
    state = lm.client.get(f"{BASE}/llm").json()
    assert (state["route"]["model"], state["route"]["provider"]) == ("example/model-fast", "acme-cloud")


@pytest.mark.parametrize("key", KEYS)
def test_a_stored_last_route_shaped_like_a_key_is_not_served(lm, key):
    spend = L.empty_spend(lm.clock())
    spend["last"] = {"lint": {"usd": None, "at": lm.clock() - 5, "model": key, "provider": key, "status": "unknown"}}
    lm.store.data[L.SPEND_KEY] = spend
    state = lm.client.get(f"{BASE}/llm").json()
    assert key not in json.dumps(state)
