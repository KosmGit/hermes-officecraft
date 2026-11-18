"""Security of the orders: the body of an order route is bounded BEFORE it is read whole, a body
that FastAPI's 422 cannot render (NaN) is a 422 and not a 500, a 422 never echoes the text it refused, and a status
name with a trailing newline is not a status name (Python's ``$`` matches before a final ``\\n``)."""

import asyncio
import json
import uuid

from fastapi.testclient import TestClient

from test_orders import BASE, world  # noqa: F401 - the shared fixture (fake kanban, journal in tmp_path)

MB = 1024 * 1024


class Counting:
    """ASGI wrapper: how many body bytes the app pulled before it answered."""

    def __init__(self, app):
        self.app, self.read = app, 0

    async def __call__(self, scope, receive, send):
        self.read = 0

        async def counted():
            message = await receive()
            self.read += len(message.get("body", b""))
            return message
        await self.app(scope, counted, send)


def _chunks(n_mb):
    yield b'{"id":"'
    for _ in range(n_mb):
        yield b"a" * MB
    yield b'"}'


def _stream(app, path, n_mb):
    """Drive the ASGI app as a server does with a chunked body (TestClient would hand it over in one piece)."""
    parts = list(_chunks(n_mb))
    pulled, said = [0], {}

    async def receive():
        if pulled[0] < len(parts):
            pulled[0] += 1
            return {"type": "http.request", "body": parts[pulled[0] - 1], "more_body": pulled[0] < len(parts)}
        return {"type": "http.disconnect"}

    async def send(message):
        if message["type"] == "http.response.start":
            said["status"] = message["status"]

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "scheme": "http",
             "path": BASE + path, "raw_path": (BASE + path).encode(), "root_path": "", "query_string": b"",
             "headers": [(b"content-type", b"application/json"), (b"transfer-encoding", b"chunked")],
             "client": ("127.0.0.1", 1), "server": ("127.0.0.1", 80)}
    asyncio.run(app(scope, receive, send))
    return said.get("status"), sum(len(p) for p in parts[:pulled[0]])


def test_a_streamed_body_beyond_the_bound_is_413_before_it_is_read_whole(world):
    for path in ("/orders", "/audit"):
        status, read = _stream(world.app, path, 8)
        assert status == 413, (path, status)
        assert read <= 2 * MB, (path, read)   # not the 8 MB sent


def test_a_declared_oversize_body_is_refused_without_being_read(world):
    app = Counting(world.app)
    r = TestClient(app).post(BASE + "/orders", content=b"a" * (4 * MB), headers={"content-type": "application/json"})
    assert r.status_code == 413
    assert app.read == 0


def test_nan_and_infinity_are_422_not_500(world):
    client = TestClient(world.app, raise_server_exceptions=False)
    for raw in (b'{"id":NaN,"verb":"unblock","board":"sandbox","task":"t_00000001"}',
                b'{"id":"x","verb":"unblock","board":"sandbox","task":Infinity}'):
        for path in ("/orders", "/audit"):
            r = client.post(BASE + path, content=raw, headers={"content-type": "application/json"})
            assert r.status_code == 422, (path, raw, r.status_code)
    assert world.fake.status("sandbox", "t_00000001") == "blocked"


def test_a_422_does_not_echo_the_refused_text(world):
    secret = "SECRET-do-not-echo-" + "z" * 4000
    body = {"id": str(uuid.uuid4()), "verb": "comment", "board": "sandbox", "task": "t_00000002", "text": secret}
    r = world.post(BASE + "/orders", json=body)
    assert r.status_code == 422
    assert "SECRET-do-not-echo" not in r.text


def test_only_declared_json_is_parsed(world):
    raw = json.dumps({"id": str(uuid.uuid4()), "verb": "unblock", "board": "sandbox", "task": "t_00000001"}).encode()
    for headers in ({}, {"content-type": "text/plain"}, {"content-type": "application/x-www-form-urlencoded"}):
        assert world.post(BASE + "/orders", content=raw, headers=headers).status_code == 422, headers
    assert world.fake.status("sandbox", "t_00000001") == "blocked"
    ok = world.post(BASE + "/orders", content=raw, headers={"content-type": "application/json; charset=utf-8"})
    assert ok.status_code == 200 and ok.json()["result"] == "done"


def test_a_status_with_a_trailing_newline_is_not_journaled(world):
    body = {"id": str(uuid.uuid4()), "verb": "approval", "risk": "safe", "result": "done",
            "before": {"status": "blocked\n"}, "after": {"status": "ready\n"}}
    assert world.post(BASE + "/audit", json=body).status_code == 200
    last = json.loads((world.audit_dir / "audit.jsonl").read_text().splitlines()[-1])
    assert last["id"] == body["id"]
    assert "before" not in last and "after" not in last, last
