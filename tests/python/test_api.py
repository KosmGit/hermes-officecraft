import importlib.util
from pathlib import Path

import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]


def _load_router():
    spec = importlib.util.spec_from_file_location("floor_plugin_api", ROOT / "dashboard" / "plugin_api.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.router


def _client():
    app = FastAPI()
    app.include_router(_load_router(), prefix="/api/plugins/hermes-officecraft")
    return TestClient(app)


def test_health_reports_identity_and_exactly_the_implemented_orders():
    response = _client().get("/api/plugins/hermes-officecraft/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["plugin"] == "hermes-officecraft"
    assert body["api"] == 1
    # unblock and comment, launch, cancel_campaign and the campaign route: nothing else may be advertised.
    assert body["capabilities"] == ["unblock", "comment", "launch", "cancel_campaign", "campaign"]
    assert body["reads"] == ["live", "history", "orders", "notify", "llm", "replay", "usage"]


def test_reads_degrade_to_ok_false_instead_of_500():
    # Hermes is not importable in the test venv: the routes must answer, not crash.
    client = _client()
    for route in ("live", "history"):
        response = client.get(f"/api/plugins/hermes-officecraft/{route}")
        assert response.status_code == 200
        body = response.json()
        assert body["ok"] is False and "error" in body and "at" in body


def test_versions_agree_across_manifests():
    manifest = yaml.safe_load((ROOT / "plugin.yaml").read_text())
    import json

    dashboard = json.loads((ROOT / "dashboard" / "manifest.json").read_text())
    package = json.loads((ROOT / "dev" / "package.json").read_text())
    body = _client().get("/api/plugins/hermes-officecraft/health").json()
    assert manifest["version"] == dashboard["version"] == package["version"] == body["version"]


def test_agent_half_declares_no_tools_hooks_or_secrets():
    manifest = yaml.safe_load((ROOT / "plugin.yaml").read_text())
    assert manifest["name"] == "hermes-officecraft"
    assert manifest["kind"] == "standalone"
    for key in ("provides_tools", "provides_middleware", "requires_env"):
        assert manifest[key] == [], key
    # the only hooks are the notifier's three, and register() hangs exactly those
    assert manifest["provides_hooks"] == ["on_kanban_dispatch_tick", "pre_approval_request", "post_approval_response"]
