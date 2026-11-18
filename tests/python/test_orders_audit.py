"""Agent half: the journal stays append-only and an approval line can carry the
id of the request the page really saw (``request``), so the « Guardian » success can refuse a line without one.
Hermes does not hand the request id to the plugin's hooks (it is created after
``pre_approval_request`` fires, ``tools/approval_gateway_wait.py``), so the id comes from the page, which reads it in
``approval.pending`` before answering; the agent stores it and serves it back, nothing more."""

import uuid

import pytest

from test_orders import BASE, _m, audit_body, journal, world  # noqa: F401  (``world`` is the fixture)

REQUEST = uuid.uuid4().hex   # what Hermes calls ``request_id``: 32 hex characters


def approval(**kw):
    return audit_body(verb="approval", risk="safe", choice="deny", profile=None, **kw)


def test_an_approval_line_keeps_the_request_id_the_page_saw(world):
    body = approval(request=REQUEST)
    assert world.post(f"{BASE}/audit", json=body).status_code == 200
    assert journal(world)[-1]["request"] == REQUEST
    served = world.get(f"{BASE}/orders?limit=5").json()["entries"]
    assert served[0]["request"] == REQUEST


def test_a_line_without_a_request_stays_without_one(world):
    assert world.post(f"{BASE}/audit", json=approval()).status_code == 200
    assert "request" not in journal(world)[-1]
    assert "request" not in world.get(f"{BASE}/orders?limit=5").json()["entries"][0]


@pytest.mark.parametrize("bad", ["../../etc/passwd", "x" * 200, "a b", "", "id\nwith newline", "é" * 12, 12345678])
def test_a_request_id_that_is_not_an_opaque_id_is_refused(world, bad):
    assert world.post(f"{BASE}/audit", json=approval(request=bad)).status_code == 422
    assert journal(world) == []


def test_the_journal_stays_append_only(world):
    """Nothing in the routes edits or removes a line: a second line with another id adds, the first one is untouched."""
    world.post(f"{BASE}/audit", json=approval(request=REQUEST))
    first = journal(world)[0]
    world.post(f"{BASE}/audit", json=approval())
    lines = journal(world)
    assert lines[0] == first and len(lines) == 2
    audit = _m("audit")
    assert not [n for n in dir(audit) if n.startswith(("delete", "remove", "rewrite", "truncate"))]


def test_request_is_a_whitelisted_journal_field_and_bounded(world):
    audit = _m("audit")
    assert "request" in audit.FIELDS
    assert audit.clean({"id": "i", "request": REQUEST})["request"] == REQUEST
    assert "request" not in audit.clean({"id": "i", "request": "r" * 500})        # dropped, not cut: a cut id names nothing
    assert "request" not in audit.clean({"id": "i", "request": "../etc/passwd"})
