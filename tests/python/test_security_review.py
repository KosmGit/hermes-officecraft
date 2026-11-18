"""Security review before publication: the fixes it led to, each one failing without its fix.

1. The monthly LLM cap stays closed when the spending cannot be written (a full state file, a read-only disk).
2. The trophies waiting to be told are bounded: posts with ever-new ids cannot fill the state file.
3. The link filter applied to a model's answer runs in linear time on a long word.
4. A bare domain in a card title is not left clickable in a notification.
5. A card title is bounded before it is cleaned and served.
"""

import sys
import time

from test_llm import DECOR, L, world  # noqa: F401 - the fixture
from test_notify import N, Store
from test_notify_routes import NOW, T1

PKG = N.__name__.rsplit(".", 1)[0]
F = sys.modules[PKG + ".notify_format"]
S = sys.modules[PKG + ".snapshot"]


def test_no_model_call_when_the_spending_cannot_be_written(world):
    world.switch(decor=True)
    world.llm.reply = DECOR
    real_set = world.store.set

    def refusing(key, value):
        if key == L.SPEND_KEY:
            raise ValueError("plugin state quota exceeded")
        return real_set(key, value)

    world.store.set = refusing
    for _ in range(3):
        answer = world.post("decor").json()
        assert answer["result"] == "refused" and answer["reason"] == "unavailable", answer
    assert world.llm.calls == [], "a call that cannot be counted must not reach the model"
    world.store.set = real_set
    assert world.post("decor").json()["result"] == "done" and len(world.llm.calls) == 1


def test_pending_trophies_are_bounded():
    store = Store()
    store.set(N.SETTINGS_KEY, {"types": {"trophy": True}, "routes": {"trophy": [T1]}})
    for i in range(N.TROPHY_PENDING_MAX):   # 3 new ids per post: each post is « news », never a first sync
        N.record_trophies(N.TrophiesIn(trophies=[{"id": f"x{i}_{k}", "name": "n"} for k in range(N.TROPHY_FIRST_SYNC)]), store, now=NOW)
    rec = store.data[N.TROPHY_KEY]
    assert len(rec["pending"]) == N.TROPHY_PENDING_MAX
    assert rec["pending"][-1]["id"] == f"x{N.TROPHY_PENDING_MAX - 1}_{N.TROPHY_FIRST_SYNC - 1}", "the newest are the ones kept"
    assert len(rec["seen"]) <= N.TROPHY_MEMORY


def test_the_link_filters_are_linear_on_a_long_word():
    word = "a" * 8000
    for rx in (L._SCHEME_RE, L._LINK_RE):
        t0 = time.perf_counter()
        for _ in range(5):
            assert rx.search(word) is None
        assert time.perf_counter() - t0 < 0.5, rx.pattern   # quadratic: 2.5 s and more for the same five searches
        # the verdicts are the ones of before
        assert rx.search("see evil.example/pay") and rx.search("a-b.co/x")
        assert rx.search("llm.py") is None and rx.search("global.css and S4.1") is None


def test_a_bare_domain_in_a_title_is_not_left_clickable():
    for title, links in (("API1 urgent: verify at evil.example/pay now", ("evil.example",)),
                         ("go to www.evil.example", ("www.evil", "evil.example")),
                         ("t.me/joinchat", ("t.me",)),
                         ("README.md and snapshot.py", ("README.md", "snapshot.py"))):
        out = N.format_message([{"type": "decision", "state": "blocked", "board": "b", "task": "t_0123abcd", "title": title, "agent": "dev"}], "en")
        for link in links:
            assert link not in out, out
    # what is not a domain is untouched: a version, a card code, a decimal
    plain = N.format_message([{"type": "decision", "state": "blocked", "board": "b", "task": "t_0123abcd", "title": "S4.1 — v2.0 at 3.5 x", "agent": "dev"}], "en")
    assert "S4.1" in plain and "v2.0" in plain and "3.5" in plain


def test_a_title_is_bounded_before_it_is_cleaned():
    hostile = "\u202e" + "a\u200b" * 400_000
    t0 = time.perf_counter()
    out = S._title(hostile)
    assert time.perf_counter() - t0 < 0.2
    assert len(out) <= S.TITLE_MAX and "\u202e" not in out and "\u200b" not in out
    assert S._title("Sprint plan") == "Sprint plan" and S._title(None) == ""
    code, rest = F.split_title("API3 — " + "x" * 400_000)
    assert code == "API3" and len(rest) <= 2000
