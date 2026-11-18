"""Security of the agent half of ``GET /replay`` and ``GET /usage``. FAKE databases only.

Hole 1: two reads at once convoy on the GIL (sqlite releases it at every row): on large boards, 10 concurrent 7-day
        replays took 11 s each instead of 0.3 s, and their usage budget ran out on the kanban scan: every ``state.db`` was
        named ``locked`` and every run lost its usage. These reads now run one at a time (``usage.READ_LOCK``).
Hole 2: a replay read EVERY row of ``task_events`` into Python (heartbeats of all the history, and the payloads of kinds it
        never reads: ``worker_result.last_output``, ``completed.summary``...): 1 M events = 3.5 to 10 s per call. Only the
        heartbeats of the runs of the window and the payloads of the kinds the fold reads are loaded now; content payloads
        never enter this process.
"""

import json
import sys
import threading
import time
import types

from test_replay_usage import NOW, SECRET, R, S, U, make_board, only, replay


def test_m3_reads_run_one_at_a_time(monkeypatch):
    active, peak = [0], [0]

    def slow(*args, **kw):
        active[0] += 1
        peak[0] = max(peak[0], active[0])
        time.sleep(0.2)
        active[0] -= 1
        return {}

    monkeypatch.setattr(R, "read_replay", slow)
    monkeypatch.setattr(U, "read_usage", slow)
    monkeypatch.setattr(U, "hermes_homes", lambda: [])
    monkeypatch.setattr(R.snapshot, "listing_sources", lambda: frozenset())
    monkeypatch.setitem(sys.modules, "hermes_cli", types.ModuleType("hermes_cli"))
    monkeypatch.setitem(sys.modules, "hermes_cli.kanban_db_boards", types.SimpleNamespace(list_boards=lambda include_archived=False: []))
    calls = [lambda: R.hermes_replay(NOW - 10, NOW), lambda: U.hermes_usage(NOW - 10, NOW), lambda: R.hermes_replay(NOW - 10, NOW)]
    threads = [threading.Thread(target=c) for c in calls]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert peak[0] == 1


def test_a_read_that_cannot_get_its_turn_is_ok_false_not_a_hang(monkeypatch):
    monkeypatch.setattr(U, "READ_WAIT_S", 0.05)
    assert U.READ_LOCK.acquire(timeout=1)
    try:
        t = time.time()
        try:
            U.hermes_usage(NOW - 10, NOW)
            raised = None
        except TimeoutError as exc:
            raised = exc
        assert isinstance(raised, TimeoutError) and time.time() - t < 1
    finally:
        U.READ_LOCK.release()


def test_only_the_window_heartbeats_and_the_fold_payloads_are_loaded(tmp_path, monkeypatch):
    ev = [("t0", "created", None, NOW - 900_000), ("t0", "claimed", None, NOW - 899_000, 1)]
    ev += [("t0", "heartbeat", {"note": SECRET}, NOW - 899_000 + i, 1) for i in range(3000)]   # an old run, long gone
    ev += [("t0", "worker_result", {"last_output": SECRET}, NOW - 800_000, 1), ("t0", "completed", {"summary": SECRET}, NOW - 800_000, 1),
           ("t1", "created", {"assignee": "alice"}, NOW - 5000), ("t1", "claimed", None, NOW - 4000, 2),
           ("t1", "heartbeat", None, NOW - 3900, 2), ("t1", "heartbeat", None, NOW - 3000, 2), ("t1", "completed", None, NOW - 2990, 2)]
    runs = [(1, "t0", "alice", NOW - 899_000, NOW - 800_000, "completed"), (2, "t1", "alice", NOW - 4000, NOW - 2990, "completed")]
    board = make_board(tmp_path / "k.db", [("t0", "Zero"), ("t1", "One")], ev, runs)
    loaded, rows = [], [0]
    real_loads, real_epoch = R._loads, S.task_epoch
    monkeypatch.setattr(R, "_loads", lambda text: (loaded.append(text), real_loads(text))[1])
    monkeypatch.setattr(R.snapshot, "task_epoch", lambda v: (rows.__setitem__(0, rows[0] + 1), real_epoch(v))[1])
    body, partial = replay([("b", board)])
    assert not any(SECRET in (t or "") for t in loaded)            # a content payload never enters this process
    assert rows[0] < 100                                           # not the 3 000 heartbeats of a run outside the window
    b = only(body)
    assert b["silences"] == [["alice", "t1", NOW - 3600, NOW - 3000]] and b["since"] == NOW - 900_000 and partial == []
    assert SECRET not in json.dumps(body)
