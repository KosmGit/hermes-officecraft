"""The session phase of `/history` inside the gateway. One pool task per bot (refs + aggregates), no 30 s
skip for a bot cut only for lack of time, partial marking (only the bots really not read), budget 2.0 s.
Real SQLite files; the cost of a read inside a busy gateway is simulated by a delay in `_session_refs`."""

import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from hermes_officecraft import snapshot  # noqa: E402
from test_history_sessions import NOW, _db  # noqa: E402


def _roster(tmp_path, n):
    roster = []
    for i in range(n):
        home = tmp_path / f"b{i:02d}"
        _db(home, [{"id": f"s{i}", "title": f"T{i}", "active": NOW - 5, "count": 3, "model": "m"}])
        roster.append(SimpleNamespace(name=f"b{i:02d}", path=home))
    return roster


def _slow_refs(monkeypatch, delay):
    real = snapshot._session_refs

    def slow(*a, **k):
        time.sleep(delay)
        return real(*a, **k)

    monkeypatch.setattr(snapshot, "_session_refs", slow)


def _facts(roster):
    with snapshot.partial_scope() as flags:
        facts = snapshot._session_facts(roster)
    return facts, snapshot.partial_list(flags)


def test_one_pool_task_per_bot_carries_the_refs_and_the_aggregates(tmp_path, monkeypatch):
    roster = _roster(tmp_path, 13)
    submitted = []

    class Counting(ThreadPoolExecutor):
        def submit(self, fn, *a, **k):
            submitted.append(fn.__name__)
            return super().submit(fn, *a, **k)

    pool = Counting(max_workers=4)
    monkeypatch.setattr(snapshot, "_session_pool", lambda: pool)
    monkeypatch.setattr(snapshot, "_SLOW_SESSIONS", {})
    facts, partial = _facts(roster)
    pool.shutdown()
    assert submitted == ["_bot_session_job"] * 13, submitted   # was 26: one for the refs and one for the aggregates
    assert partial == []
    for f in facts.values():
        assert f["lastSession"] and f["stats"]["firstSeen"] is not None


def test_a_bot_cut_only_for_lack_of_time_is_not_skipped_for_30_seconds(tmp_path, monkeypatch):
    """"did not answer within 0.02s": the budget ran out, the store is not wedged."""
    roster = _roster(tmp_path, 1)
    skipped = {}
    monkeypatch.setattr(snapshot, "_SLOW_SESSIONS", skipped)
    monkeypatch.setattr(snapshot, "SESSION_READ_TIMEOUT_S", 0.3)
    monkeypatch.setattr(snapshot, "SESSIONS_BUDGET_S", 0.02)
    monkeypatch.setattr(snapshot, "SESSION_PER_BOT_S", 0.0)
    monkeypatch.setattr(snapshot, "SESSIONS_GRACE_S", 0.0)
    _slow_refs(monkeypatch, 0.1)
    facts, partial = _facts(roster)
    assert partial == [{"source": "sessions:b00", "reason": "locked"}]   # not read, said so, for this read
    assert facts["b00"]["lastSession"] is None
    assert skipped == {}, "a store cut by the budget must be read again on the next call"


def test_a_store_that_really_ran_past_its_slot_is_still_skipped(tmp_path, monkeypatch):
    roster = _roster(tmp_path, 1)
    skipped = {}
    monkeypatch.setattr(snapshot, "_SLOW_SESSIONS", skipped)
    monkeypatch.setattr(snapshot, "SESSION_READ_TIMEOUT_S", 0.1)
    _slow_refs(monkeypatch, 0.4)
    facts, partial = _facts(roster)
    assert partial == [{"source": "sessions:b00", "reason": "locked"}]
    assert len(skipped) == 1 and next(iter(skipped.values())) > time.time() + 20
    _, partial = _facts(roster)   # next read: left alone, still named
    assert partial == [{"source": "sessions:b00", "reason": "locked"}]


def test_a_task_still_queued_behind_the_pool_is_not_a_wedged_store(tmp_path, monkeypatch):
    roster = _roster(tmp_path, 1)
    skipped = {}
    monkeypatch.setattr(snapshot, "_SLOW_SESSIONS", skipped)
    monkeypatch.setattr(snapshot, "SESSION_READ_TIMEOUT_S", 0.1)
    busy = ThreadPoolExecutor(max_workers=1)
    busy.submit(time.sleep, 0.5)            # the only thread is taken: our task never starts inside its slot
    monkeypatch.setattr(snapshot, "_session_pool", lambda: busy)
    _, partial = _facts(roster)
    busy.shutdown(wait=True)
    assert partial == [{"source": "sessions:b00", "reason": "locked"}]
    assert skipped == {}


def test_when_the_budget_runs_out_what_is_read_is_served_and_only_the_unread_are_marked(tmp_path, monkeypatch):
    roster = _roster(tmp_path, 8)
    monkeypatch.setattr(snapshot, "_SLOW_SESSIONS", {})
    monkeypatch.setattr(snapshot, "SESSIONS_BUDGET_S", 0.1)
    monkeypatch.setattr(snapshot, "SESSION_PER_BOT_S", 0.0)
    monkeypatch.setattr(snapshot, "SESSIONS_GRACE_S", 0.0)
    monkeypatch.setattr(snapshot, "_ROTATION", iter(range(0, 1000, 8)))   # start at the first bot
    _slow_refs(monkeypatch, 0.04)
    facts, partial = _facts(roster)
    unread = {n for n, f in facts.items() if f["lastSession"] is None}
    read = set(facts) - unread
    assert read and unread, (read, unread)
    assert {f["source"] for f in partial} == {f"sessions:{n}" for n in unread}, "exactly the bots not read are marked"
    assert all(f["stats"] and f["lastSession"] for n, f in facts.items() if n in read)
    assert unread == {f"b{i:02d}" for i in range(len(read), 8)}, "the tail, in order"


def test_past_the_budget_the_remaining_bots_still_get_a_short_slot(tmp_path, monkeypatch):
    """A read costs ~5 ms: after the budget the tail is not written off in one block, each bot tries once more."""
    roster = _roster(tmp_path, 8)
    monkeypatch.setattr(snapshot, "_SLOW_SESSIONS", {})
    monkeypatch.setattr(snapshot, "SESSIONS_BUDGET_S", 0.1)
    monkeypatch.setattr(snapshot, "SESSION_PER_BOT_S", 0.0)
    monkeypatch.setattr(snapshot, "_ROTATION", iter(range(0, 1000, 8)))
    _slow_refs(monkeypatch, 0.04)           # 8 x 0.04 = 0.32 s: the budget (0.1 s) is gone after 2-3 bots
    t0 = time.perf_counter()
    facts, partial = _facts(roster)
    assert partial == [] and all(f["lastSession"] for f in facts.values())
    assert time.perf_counter() - t0 < 0.1 + snapshot.SESSIONS_GRACE_S + 0.3


def test_past_the_budget_one_wedged_bot_cannot_eat_the_grace_of_the_others(tmp_path, monkeypatch):
    """The late slot is short (not a whole SESSION_READ_TIMEOUT_S slot past the budget), so
    a wedged store met after the budget costs its own bot only, the bots after it are still read."""
    roster = _roster(tmp_path, 4)
    skipped = {}
    monkeypatch.setattr(snapshot, "_SLOW_SESSIONS", skipped)
    monkeypatch.setattr(snapshot, "SESSIONS_BUDGET_S", 0.0)       # already past the budget at the first bot
    monkeypatch.setattr(snapshot, "SESSION_PER_BOT_S", 0.0)
    monkeypatch.setattr(snapshot, "SESSIONS_GRACE_S", 0.25)
    monkeypatch.setattr(snapshot, "_ROTATION", iter(range(0, 1000, 4)))   # the wedged bot b00 comes first
    real = snapshot._session_refs

    def wedged_first(db_path, *a, **k):
        if Path(db_path).parent.name == "b00":
            time.sleep(0.6)
        return real(db_path, *a, **k)

    monkeypatch.setattr(snapshot, "_session_refs", wedged_first)
    facts, partial = _facts(roster)
    assert partial == [{"source": "sessions:b00", "reason": "locked"}], partial
    assert all(facts[f"b{i:02d}"]["lastSession"] for i in range(1, 4))
    assert skipped == {}, "cut by its short late slot, not wedged for a whole slot"


def test_the_budget_covers_what_the_gateway_measured(tmp_path, monkeypatch):
    """The phase was measured at 0.07-0.48 s in the gateway: 0.45 s cut a read in 50, 1.0 s a read in ~35 on a loaded host, 2.0 s does not."""
    assert snapshot.SESSIONS_BUDGET_S >= 2.0   # live, host loaded: phase up to 1.26 s with a 1.0 s budget (3 reads in 100 locked)
    roster = _roster(tmp_path, 13)
    monkeypatch.setattr(snapshot, "_SLOW_SESSIONS", {})
    _slow_refs(monkeypatch, 0.045)          # 13 x 0.045 = 0.585 s: over the old budget, inside the new one
    facts, partial = _facts(roster)
    assert partial == [] and all(f["lastSession"] for f in facts.values())
