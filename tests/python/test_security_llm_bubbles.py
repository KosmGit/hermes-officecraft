"""Security of the LLM functions (page + agent). FAKE client only: no test reaches a model.

Hole 1: a thought bubble is the only free text of the model the page shows; the contract says « no link », but only
        « :// » and « www. » were refused: ``javascript:…``, ``data:…``, ``mailto:…``, ``MEDIA:/path`` and
        ``evil.example/pay`` reached the office as a bubble.
Plus a guard: the page cannot move the monthly cap past its bounds nor reset the month's spend by re-saving settings.
"""

import pytest

from test_llm import BASE, DECOR, L, world  # noqa: F401 - the shared fixture (fake client, fake store, TestClient)

LINKS = ["javascript:alert(1)", "MEDIA:/etc/passwd", "data:text/html,x", "mailto:a@evil.example", "file:/etc/shadow",
         "vbscript:msgbox(1)", "Pay now at evil.example/pay", "see EVIL.EXAMPLE/x"]
FINE = ["I reread llm.py and the tests", "Note : the review moves on", "I run the tests again", "Step 2: fixing the build",
        "I’m looking into the LLM functions", "12:30, one more test"]


@pytest.mark.parametrize("text", LINKS)
def test_a_bubble_carries_no_link(text):
    assert not L.valid_thought(text)


@pytest.mark.parametrize("text", FINE)
def test_ordinary_bubbles_still_pass(text):
    assert L.valid_thought(text)


def test_a_link_bubble_from_the_model_is_dropped_alone(world):
    world.llm.reply = {"thoughts": [{"name": "writer", "text": "javascript:alert(1)"}, {"name": "dev", "text": "I reread llm.py"}]}
    world.switch(thoughts=True)
    body = world.post("thoughts").json()
    assert body["result"] == "done"
    assert [t["text"] for t in body["fiche"]["thoughts"]] == ["I reread llm.py"]
    assert all("javascript" not in t["text"] for t in world.client.get(f"{BASE}/llm").json()["fiches"]["thoughts"])


@pytest.mark.parametrize("patch", [{"capUsd": 100.01}, {"capUsd": -1}, {"callCap": 10_001}, {"callCap": -1}, {"spend": {"usd": 0}}])
def test_the_page_cannot_post_caps_out_of_bounds_nor_a_spend(world, patch):
    body = {"features": {f: False for f in L.FEATURES}, "capUsd": 1, "callCap": 300, **patch}
    assert world.client.post(f"{BASE}/llm/settings", json=body).status_code == 422


def test_resaving_the_settings_never_resets_the_spend(world):
    world.engine.cost_fn = lambda r: (None, "unknown")
    world.llm.reply = DECOR
    world.switch(decor=True, callCap=3)
    for i in range(5):
        world.post("decor", style=f"s{i}")
    world.switch(decor=False, callCap=3)
    world.switch(decor=True, callCap=3)
    answer = world.post("decor", style="again").json()
    assert len(world.llm.calls) == 3 and answer["reason"] == "cap_reached" and answer["cap"] == "calls"
