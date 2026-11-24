"""Two models (strong, light), the model imposed per call, the fallback and the cap.
A FAKE client stands in for ``ctx.llm``: no test reaches a model. The five decorative functions are the only ones served yet (all on the
light lane); the lane table also names the five drafting functions, so their routes only have to be added."""

import json

import pytest

from test_llm import BASE, GOOD, L, SECRETS, Result, world  # noqa: F401  (the ``world`` fixture is the one of test_llm)

LIGHT = {"provider": "acme-cloud", "model": "example/model-fast"}
STRONG = {"provider": "acme-plan", "model": "example/model-large"}
# what the five functions passed before there were two models: the non-regression reference (task, no override, the old limits and delay)
LEGACY_MAX_TOKENS = {"decor": 1200, "outfits": 1500, "art": 1200, "seating": 1200, "thoughts": 1200}
IMPOSED_MAX_TOKENS = {"seating": 4000, "outfits": 3000}   # measured on a model that thinks: seating needed 2 077 tokens, failed at 1 200
LEGACY_KEYS = {"system_prompt", "instructions", "input", "json_schema", "schema_name", "max_tokens", "timeout", "purpose", "task"}


class Trust(PermissionError):
    """Named like Hermes' ``PluginLlmTrustError``: the engine reads the class name, never imports Hermes."""


Trust.__name__ = "PluginLlmTrustError"


def set_models(w, strong=None, light=None, **extra):
    body = {"features": {f: bool(extra.get(f, True)) for f in L.FEATURES}, "capUsd": extra.get("capUsd", 1), "callCap": extra.get("callCap", 300),
            "models": {"strong": strong, "light": light}}
    r = w.client.post(f"{BASE}/llm/settings", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def grant(w, value=True):
    w.engine.has_capability = lambda cap: value


def get(w):
    return w.client.get(f"{BASE}/llm").json()


def call(w, feature):
    w.llm.reply = GOOD[feature]
    w.clock.t += 120   # past the bubbles' minute
    return w.post(feature).json()


# ------------------------------------------------------------------ 1. the matrix: function x (none, light, strong, both) x (granted, not)
@pytest.mark.parametrize("granted", [True, False])
@pytest.mark.parametrize("config", ["none", "light", "strong", "both"])
@pytest.mark.parametrize("feature", L.DECORATIVE)
def test_the_fake_client_receives_exactly_the_expected_route(world, feature, config, granted):
    grant(world, granted)
    set_models(world, strong=STRONG if config in ("strong", "both") else None, light=LIGHT if config in ("light", "both") else None)
    out = call(world, feature)
    assert out["result"] == "done" and len(world.llm.calls) == 1
    kw = world.llm.calls[0]
    # every function of today is on the light lane: its model, else the strong one when it is the only one filled, else none
    expected = {"none": None, "light": LIGHT, "strong": STRONG, "both": LIGHT}[config]
    if expected and granted:
        assert (kw["provider"], kw["model"]) == (expected["provider"], expected["model"]) and "task" not in kw
        assert set(kw) == (LEGACY_KEYS - {"task"}) | {"provider", "model"}
    else:
        assert "provider" not in kw and "model" not in kw and kw["task"] == "officecraft"
        assert set(kw) == LEGACY_KEYS
    # an imposed model may be one that thinks: seating and outfits get a bigger limit then (measured), the task route never changes
    imposed = bool(expected and granted)
    assert kw["max_tokens"] == (IMPOSED_MAX_TOKENS.get(feature, LEGACY_MAX_TOKENS[feature]) if imposed else LEGACY_MAX_TOKENS[feature])
    assert kw["timeout"] == 60 and kw["purpose"] == f"officecraft.{feature}"


@pytest.mark.parametrize("feature", L.DECORATIVE)
def test_nothing_set_passes_the_same_arguments_as_before_there_were_two_models(world, feature):
    """Non-regression: no model set (and every capability granted, and a price table that would know everything) = the legacy kwargs."""
    grant(world, True)
    world.engine.price_fn = lambda m, p: pytest.fail("no model imposed: no price to look up")
    set_models(world)
    call(world, feature)
    kw = world.llm.calls[0]
    assert set(kw) == LEGACY_KEYS and kw["task"] == "officecraft" and kw["timeout"] == 60 and kw["max_tokens"] == LEGACY_MAX_TOKENS[feature]
    assert kw["json_schema"] == (L.seating_schema(json.loads(kw["input"][0]["text"])["agents"]) if feature == "seating" else L.SCHEMAS[feature])
    assert kw["schema_name"] == f"officecraft_{feature}" and kw["input"][0]["type"] == "text"


def test_a_model_set_without_the_grant_is_never_tried(world):
    set_models(world, light=LIGHT)   # world.engine.has_capability is None: Hermes too old
    assert get(world)["override"] == "unsupported"
    call(world, "decor")
    grant(world, False)
    assert get(world)["override"] == "not_granted"
    call(world, "decor")
    assert all("model" not in kw and "provider" not in kw and kw["task"] == "officecraft" for kw in world.llm.calls) and len(world.llm.calls) == 2


def test_one_of_the_two_capabilities_is_not_enough(world):
    set_models(world, light=LIGHT)
    world.engine.has_capability = lambda cap: cap == "llm.model_override"
    assert get(world)["override"] == "not_granted"
    call(world, "decor")
    assert "model" not in world.llm.calls[0]
    world.engine.has_capability = lambda cap: cap == "llm.provider_override"
    assert get(world)["override"] == "not_granted"


def test_an_unreadable_consent_is_a_refusal_and_is_read_again_each_time(world):
    set_models(world, light=LIGHT)
    state = {"ok": True}

    def has(cap):
        if state["ok"] is None:
            raise OSError("config unreadable")
        return state["ok"]

    world.engine.has_capability = has
    assert get(world)["override"] == "granted"
    state["ok"] = None
    assert get(world)["override"] == "not_granted"
    state["ok"] = False
    assert get(world)["override"] == "not_granted"
    state["ok"] = True   # granted while the gateway runs: seen at the next read, no restart
    assert get(world)["override"] == "granted"
    call(world, "art")
    assert world.llm.calls[0]["model"] == LIGHT["model"]


# ------------------------------------------------------------------ 2. Hermes refuses at the call
def test_a_refusal_of_hermes_replays_once_without_a_model_and_says_not_granted(world):
    grant(world, True)
    set_models(world, light=LIGHT)
    assert get(world)["override"] == "granted"
    world.llm.refuse_override = Trust
    out = call(world, "decor")
    assert out["result"] == "done" and out["ok"] is True   # the function works, on the task
    assert len(world.llm.calls) == 2
    first, second = world.llm.calls
    assert (first["provider"], first["model"]) == (LIGHT["provider"], LIGHT["model"]) and "task" not in first
    assert "provider" not in second and "model" not in second and second["task"] == "officecraft"
    assert get(world)["override"] == "not_granted"
    assert get(world)["spend"]["calls"] == 1, "the refused attempt reached no model: nothing is counted for it"
    # the next calls go straight to the task: no new attempt with a model
    call(world, "art")
    assert len(world.llm.calls) == 3 and "model" not in world.llm.calls[2]
    # a new settings save earns a new try
    set_models(world, light=LIGHT)
    assert get(world)["override"] == "granted"
    call(world, "outfits")
    assert "model" in world.llm.calls[3] and len(world.llm.calls) == 5


def test_a_second_refusal_on_the_task_is_not_allowed_and_nothing_loops(world):
    grant(world, True)
    set_models(world, light=LIGHT)

    def always(**kw):
        world.llm.calls.append(kw)
        raise Trust("no")

    world.llm.complete_structured = always
    out = call(world, "decor")
    assert (out["result"], out["reason"]) == ("failed", "not_allowed")
    assert len(world.llm.calls) == 2, "one replay, never more"


def test_another_error_on_the_imposed_model_is_not_replayed(world):
    grant(world, True)
    set_models(world, light=LIGHT)
    world.llm.error = RuntimeError("provider down")
    out = call(world, "decor")
    assert (out["result"], out["reason"]) == ("failed", "model_error") and len(world.llm.calls) == 1
    assert get(world)["override"] == "granted", "a provider failure is not a refusal of the grant"


# ------------------------------------------------------------------ 3. the cap, before the call, with the price of the model chosen
def price(inp, out, req=0.0):
    return lambda model, provider: {"input": inp, "output": out, "request": req}


def test_a_known_price_that_would_pass_the_dollar_cap_is_refused_before_any_call(world):
    grant(world, True)
    # worst case = (chars sent) x 1 $/M in + 1200 tokens x 100 $/M out = about 0.12 $ + the prompt: over a 0.10 $ cap, under a 1 $ cap
    world.engine.price_fn = price(1.0, 100.0)
    set_models(world, light=LIGHT, capUsd=0.10)
    out = call(world, "decor")
    assert (out["result"], out["reason"], out["cap"]) == ("refused", "cap_reached", "usd")
    assert world.llm.calls == [], "0 call reached the fake client"
    assert get(world)["spend"]["calls"] == 0
    set_models(world, light=LIGHT, capUsd=1)
    assert call(world, "decor")["result"] == "done" and len(world.llm.calls) == 1


def test_the_dollar_cap_is_never_passed_on_a_priced_model(world):
    grant(world, True)
    world.engine.price_fn = price(1.0, 100.0)
    world.engine.cost_fn = lambda result: (0.1, "estimated")   # each call really costs 0.10 $; the worst case of the next is about 0.12 $
    set_models(world, light=LIGHT, capUsd=0.30)
    done = 0
    for _ in range(6):
        out = call(world, "decor")
        done += out["result"] == "done"
        assert get(world)["spend"]["usd"] <= 0.30
    assert done == 2 and len(world.llm.calls) == 2   # 0.10 + 0.12 <= 0.30, then 0.20 + 0.12 > 0.30: refused before the call


def test_two_lanes_in_flight_never_pass_the_dollar_cap_together(world, monkeypatch):
    """One lock PER LANE lets two calls run at once; the worst cost of a priced call in flight is reserved, so the other lane
    checks against it. Without the reservation both ran: 0.24 $ spent on a 0.20 $ cap."""
    import threading
    monkeypatch.setitem(L.LANE_OF, "art", "strong")   # a call on the 2nd lane (campaign, cardbody)
    grant(world, True)
    world.engine.price_fn = price(1.0, 100.0)   # worst case of each call: about 0.12 $
    world.engine.cost_fn = lambda result: (0.12, "estimated")
    set_models(world, light=LIGHT, capUsd=0.20)
    world.llm.reply = lambda kw: GOOD[kw["purpose"].split(".")[1]]
    world.llm.gate = threading.Event()
    world.clock.t += 120
    out = {}
    first = threading.Thread(target=lambda: out.update(a=world.post("decor").json()))
    first.start()
    for _ in range(300):
        if world.llm.calls:
            break
        threading.Event().wait(0.01)
    second = threading.Thread(target=lambda: out.update(b=world.post("art").json()))
    second.start()
    second.join(2)
    world.llm.gate.set()
    first.join(5)
    second.join(5)
    assert out["a"]["result"] == "done" and (out["b"]["result"], out["b"]["reason"], out["b"]["cap"]) == ("refused", "cap_reached", "usd")
    assert len(world.llm.calls) == 1 and get(world)["spend"]["usd"] <= 0.20
    assert world.engine._reserved == {"strong": 0.0, "light": 0.0}, "released when the call ends"


def test_the_request_fee_counts_in_the_worst_case(world):
    grant(world, True)
    world.engine.price_fn = price(0.001, 0.001, req=0.5)
    set_models(world, light=LIGHT, capUsd=0.4)
    assert call(world, "decor")["reason"] == "cap_reached" and world.llm.calls == []


def test_an_unknown_price_is_counted_in_calls_not_in_dollars(world):
    grant(world, True)
    world.engine.price_fn = lambda m, p: None
    world.engine.cost_fn = lambda result: (None, "unknown")
    set_models(world, light=LIGHT, capUsd=0.01, callCap=2)
    assert get(world)["lanes"]["light"]["priced"] is False
    # the first rule still holds for what is not priced: the spend (0 $) is under the cap, so the calls are what counts
    assert call(world, "decor")["result"] == "done" and call(world, "art")["result"] == "done"
    spend = get(world)["spend"]
    assert (spend["calls"], spend["unpriced"], spend["usd"]) == (2, 2, 0.0)
    out = call(world, "outfits")
    assert (out["reason"], out["cap"]) == ("cap_reached", "calls") and len(world.llm.calls) == 2


def test_the_price_of_the_model_chosen_is_looked_up_and_only_for_an_imposed_model(world):
    grant(world, True)
    asked = []
    world.engine.price_fn = lambda m, p: asked.append((m, p)) or price(0.001, 0.001)(m, p)
    set_models(world, strong=STRONG)   # only the strong one is filled: it serves the light lane too
    call(world, "decor")
    assert (STRONG["model"], STRONG["provider"]) in asked
    grant(world, False)
    asked.clear()
    call(world, "decor")
    assert asked == [], "a call on the task looks no price up"
    assert "model" not in world.llm.calls[-1]


def test_the_spend_carries_the_model_really_used(world):
    grant(world, True)
    world.engine.price_fn = price(0.001, 0.001)
    set_models(world, light=LIGHT)
    call(world, "decor")
    state = get(world)
    assert state["route"] == {"provider": LIGHT["provider"], "model": LIGHT["model"], "priced": True}
    assert state["spend"]["usd"] == 0.0004 and state["spend"]["byFeature"]["decor"]["calls"] == 1
    # after a refusal of Hermes the call ran on the task: the spend says the model of the task, not the one asked for
    world.llm.refuse_override = Trust
    set_models(world, light=LIGHT)
    call(world, "art")
    assert get(world)["route"] == {"provider": "fake-provider", "model": "fake-model", "priced": True}


def test_the_price_lookup_of_hermes_is_safe(monkeypatch):
    import types
    import sys

    def entry(**kw):
        return types.SimpleNamespace(**{"input_cost_per_million": None, "output_cost_per_million": None, "request_cost": None, "pricing_version": "x", **kw})

    cases = {"known": (entry(input_cost_per_million=0.036, output_cost_per_million=0.5), {"input": 0.036, "output": 0.5, "request": 0.0}),
             "subscription": (entry(input_cost_per_million=0, output_cost_per_million=0, pricing_version="included-route"), None),
             "zero": (entry(input_cost_per_million=0, output_cost_per_million=0), None), "half": (entry(input_cost_per_million=1), None),
             "none": (None, None), "negative": (entry(input_cost_per_million=-1, output_cost_per_million=1), None)}
    for name, (e, want) in cases.items():
        mod = types.ModuleType("agent.usage_pricing")
        mod.get_pricing_entry = lambda model, provider=None, _e=e: _e
        monkeypatch.setitem(sys.modules, "agent", types.ModuleType("agent"))
        monkeypatch.setitem(sys.modules, "agent.usage_pricing", mod)
        assert L.hermes_price("m", "p") == want, name
    mod.get_pricing_entry = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("network"))
    assert L.hermes_price("m", "p") is None   # a failed lookup = price unknown, never a failed call


# ------------------------------------------------------------------ 4. settings
BAD_PICKS = [
    "model-5", 5, True, [], [LIGHT], {}, {"provider": "acme-cloud"}, {"model": "m"}, {"provider": "", "model": "m"}, {"provider": "p", "model": ""},
    {"provider": 1, "model": "m"}, {"provider": "p", "model": None}, {"provider": ["p"], "model": "m"},
    {**LIGHT, "extra": 1}, {"provider": "p" * 101, "model": "m"}, {"provider": "p", "model": "m" * 201},
    {"provider": "p\x00", "model": "m"}, {"provider": "p", "model": "m\nx"}, {"provider": "p q", "model": "m"}, {"provider": "p", "model": "a b"},
    {"provider": "p", "model": "m\u202e"}, {"provider": "p", "model": "m\u200b"}, {"provider": "p", "model": "m\u2028"}, {"provider": " p", "model": "m"},
    {"provider": "acme-cloud", "model": "sk-abcdefghijklmnopqrstuv"}, {"provider": "acme-cloud", "model": "Bearer abcdefghijkl"},
    {"provider": "acme-cloud", "model": "a" * 32}, {"provider": "acme-cloud", "model": "AIza" + "x" * 24},
]


@pytest.mark.parametrize("bad", BAD_PICKS, ids=[str(i) for i in range(len(BAD_PICKS))])
def test_an_invalid_stored_model_is_empty_and_never_raises(world, bad):
    for lane in L.LANES:
        world.store.data["llm_settings"] = {"features": {}, "capUsd": 1, "callCap": 300, "models": {"strong": bad, "light": LIGHT, "other": bad}}
        got = world.engine.settings()["models"]
        assert got == {"strong": None, "light": LIGHT}
        assert L.clean_model(bad) is None
        world.store.data["llm_settings"]["models"] = {lane: bad}
        assert world.engine.settings()["models"][lane] is None
    for raw in (None, "x", 3, [], {"models": "x"}, {"models": [LIGHT]}, {"models": None}):
        assert L.clean_settings(raw)["models"] == {"strong": None, "light": None}


@pytest.mark.parametrize("bad", [b for b in BAD_PICKS if isinstance(b, dict) and b], ids=lambda b: "")
def test_an_invalid_posted_model_is_a_422_that_changes_nothing_and_echoes_nothing(world, bad):
    set_models(world, light=LIGHT)
    r = world.client.post(f"{BASE}/llm/settings", json={"features": {}, "capUsd": 1, "callCap": 300, "models": {"light": bad}})
    assert r.status_code == 422
    for part in bad.values():
        if isinstance(part, str) and len(part) > 3:
            assert part not in r.text, "the value is never echoed"
    assert world.engine.settings()["models"] == {"strong": None, "light": LIGHT}


def test_the_models_round_trip_and_an_absent_key_keeps_what_is_stored(world):
    r = set_models(world, strong=STRONG, light=LIGHT)
    assert r["settings"]["models"] == {"strong": STRONG, "light": LIGHT}
    assert world.store.data["llm_settings"]["models"] == {"strong": STRONG, "light": LIGHT}
    post = lambda b: world.client.post(f"{BASE}/llm/settings", json={"features": {}, "capUsd": 1, "callCap": 300, **b}).json()   # noqa: E731
    assert post({})["settings"]["models"] == {"strong": STRONG, "light": LIGHT}, "a page without `models` erases nothing"
    assert post({"models": None})["settings"]["models"] == {"strong": STRONG, "light": LIGHT}
    assert post({"models": {}})["settings"]["models"] == {"strong": STRONG, "light": LIGHT}
    assert post({"models": {"strong": None}})["settings"]["models"] == {"strong": None, "light": LIGHT}, "null = the model of Hermes"
    assert post({"models": {"light": STRONG}})["settings"]["models"] == {"strong": None, "light": STRONG}, "an absent lane keeps its value"
    assert world.client.post(f"{BASE}/llm/settings", json={"features": {}, "capUsd": 1, "callCap": 300, "models": {"other": LIGHT}}).status_code == 422
    # the shape is not checked against the list of Hermes: that list is the page's
    assert post({"models": {"light": {"provider": "any", "model": "thing/else:free"}}})["settings"]["models"]["light"] == {"provider": "any", "model": "thing/else:free"}


# ------------------------------------------------------------------ 5. what GET /llm says
def test_get_llm_serves_the_contract_fields_and_nothing_else(world):
    body = get(world)
    assert set(body) == {"ok", "at", "available", "features", "settings", "override", "lanes", "routes", "spend", "route", "fiches", "sends", "costs", "pending"}
    assert set(body["settings"]) == {"features", "capUsd", "callCap", "models"} and set(body["settings"]["models"]) == {"strong", "light"}
    assert body["override"] == "unsupported"
    for lane in L.LANES:
        assert set(body["lanes"][lane]) == {"via", "task", "provider", "model", "priced", "busy"}
    assert set(body["routes"]) == set(L.FEATURES)
    assert all(set(r) == {"lane", "via", "provider", "model"} for r in body["routes"].values())
    # the planted forbidden values never come out
    dump = json.dumps(body)
    for secret in SECRETS:
        assert secret not in dump


def test_get_llm_says_the_model_each_function_will_really_take(world):
    grant(world, True)
    world.engine.price_fn = lambda m, p: price(0.1, 0.2)(m, p) if m == LIGHT["model"] else None
    body = get(world)
    assert body["override"] == "granted"
    assert body["lanes"]["light"] == {"via": "task", "task": "officecraft", "provider": None, "model": None, "priced": None, "busy": None}
    assert body["lanes"]["strong"]["via"] == "task" and body["lanes"]["strong"]["model"] is None   # « the model of Hermes »
    set_models(world, strong=STRONG, light=LIGHT)
    body = get(world)
    assert body["lanes"]["light"] == {"via": "model", "task": None, "provider": LIGHT["provider"], "model": LIGHT["model"], "priced": True, "busy": None}
    assert body["lanes"]["strong"]["model"] == STRONG["model"] and body["lanes"]["strong"]["priced"] is False
    for f in L.DECORATIVE:
        assert body["routes"][f] == {"lane": "light", "via": "model", "provider": LIGHT["provider"], "model": LIGHT["model"]}
    set_models(world, strong=STRONG)   # one filled: it serves everything
    assert {r["model"] for r in get(world)["routes"].values()} == {STRONG["model"]}
    grant(world, False)   # no grant: the routes say « the model of Hermes », whatever is set
    assert {(r["via"], r["model"]) for r in get(world)["routes"].values()} == {("task", None)}


def test_the_lane_is_busy_while_a_call_runs_and_only_that_lane(world):
    import threading
    world.switch(decor=True)
    world.llm.reply = GOOD["decor"]
    world.llm.gate = threading.Event()
    t = threading.Thread(target=lambda: world.engine.run("decor", L.DecorIn(id=world.uid(), style="a")))
    t.start()
    for _ in range(200):
        if world.llm.calls:
            break
        threading.Event().wait(0.01)
    busy = get(world)["lanes"]
    assert busy["light"]["busy"]["feature"] == "decor" and busy["strong"]["busy"] is None
    assert set(busy["light"]["busy"]) == {"feature", "id", "since"}
    world.llm.gate.set()
    t.join(5)
    assert get(world)["lanes"]["light"]["busy"] is None


def test_health_says_when_a_model_can_be_imposed(world):
    caps = lambda: world.client.get(f"{BASE}/health").json()["capabilities"]   # noqa: E731
    assert "llm:override" not in caps()
    grant(world, False)
    assert "llm:override" not in caps()
    grant(world, True)
    assert caps()[-1] == "llm:override"
    world.engine.attach(None, False)   # no ctx.llm: nothing is offered
    assert "llm:override" not in caps()


# ------------------------------------------------------------------ 6. the tables in code
def test_the_lane_table_gives_every_function_its_lane():
    assert L.LANES == ("strong", "light")
    assert L.LANE_OF == {"decor": "light", "outfits": "light", "art": "light", "seating": "light", "thoughts": "light",
                         "recruit": "light", "revise": "light", "campaign": "strong", "cardbody": "strong", "lint": "light"}


def test_every_function_has_its_limit_and_its_delay():
    assert set(L.MAX_TOKENS) == set(L.TIMEOUTS) == set(L.LANE_OF)
    assert {f: L.MAX_TOKENS[f] for f in L.DECORATIVE} == LEGACY_MAX_TOKENS and {L.TIMEOUTS[f] for f in L.DECORATIVE} == {60}
    assert (L.MAX_TOKENS["recruit"], L.MAX_TOKENS["revise"], L.MAX_TOKENS["campaign"], L.MAX_TOKENS["cardbody"], L.MAX_TOKENS["lint"]) == (6000, 4000, 32000, 4000, 12000)
    assert (L.TIMEOUTS["recruit"], L.TIMEOUTS["revise"], L.TIMEOUTS["campaign"], L.TIMEOUTS["cardbody"], L.TIMEOUTS["lint"]) == (60, 60, 240, 60, 90)


def test_the_delay_and_the_limit_passed_are_the_ones_of_the_function(world, monkeypatch):
    monkeypatch.setitem(L.TIMEOUTS, "art", 77)
    monkeypatch.setitem(L.MAX_TOKENS, "art", 4321)
    world.switch(art=True)
    call(world, "art")
    assert (world.llm.calls[0]["timeout"], world.llm.calls[0]["max_tokens"]) == (77, 4321)


def test_the_strong_lane_without_a_model_uses_the_plan_task_when_it_exists(world):
    assert world.engine.task_route("strong")["task"] == "officecraft" and world.engine.task_route("light")["task"] == "officecraft"
    world.engine.attach(world.llm, True, None, plan_task=True)
    assert world.engine.task_route("strong")["task"] == "officecraft_plan" and world.engine.task_route("light")["task"] == "officecraft"


# ------------------------------------------------------------------ failed calls on a priced model count against the dollar cap
def test_calls_that_fail_on_a_priced_model_cannot_walk_past_the_dollar_cap(world):
    grant(world, True)
    world.engine.price_fn = price(1.0, 100.0)   # worst case of a call: about 0.12 $
    set_models(world, light=LIGHT, capUsd=0.30)
    world.llm.error = ValueError("answer did not match schema")   # billed by the provider, usage lost on Hermes' side
    results = []
    for _ in range(8):
        world.clock.t += 120
        results.append(world.post("decor").json())
        assert get(world)["spend"]["usd"] <= 0.30
    failed = [r for r in results if r["result"] == "failed"]
    refused = [r for r in results if r["result"] == "refused"]
    assert 1 <= len(failed) <= 2 and len(world.llm.calls) == len(failed), "each failed call took its worst cost from the month"
    assert refused and all((r["reason"], r["cap"]) == ("cap_reached", "usd") for r in refused)
    assert get(world)["spend"]["usd"] > 0 and get(world)["spend"]["unpriced"] == 0


def test_a_failed_call_on_the_task_route_stays_unpriced_and_a_refusal_by_hermes_costs_nothing(world):
    set_models(world)   # no model imposed: the price is not known before the call
    world.llm.error = TimeoutError("slow")
    world.clock.t += 120
    assert world.post("decor").json()["reason"] == "timeout"
    spend = get(world)["spend"]
    assert (spend["usd"], spend["unpriced"], spend["calls"]) == (0, 1, 1)


def test_the_answers_kept_for_replay_stay_bounded_on_the_routes_that_call_no_model(world):
    for _ in range(L.REMEMBERED + 40):
        assert world.client.post(f"{BASE}/llm/decor/reset", json={"id": world.uid()}).status_code == 200
    assert len(world.engine._answers) == L.REMEMBERED
    for _ in range(40):
        assert world.client.post(f"{BASE}/llm/decor/resolve", json={"id": world.uid(), "choice": "ignore"}).status_code == 200
    assert len(world.engine._answers) == L.REMEMBERED


# ------------------------------------------------------------------ the data boundary is said in the system prompt of every call
def test_every_call_says_in_its_system_prompt_that_the_json_is_data(world):
    grant(world, False)
    set_models(world)
    assert call(world, "decor")["result"] == "done"
    call_kw = world.llm.calls[-1]
    assert call_kw["system_prompt"] == L.SYSTEM_PROMPT and "untrusted DATA" in L.SYSTEM_PROMPT
    assert call_kw["instructions"].startswith("You decorate"), "the task itself is unchanged"
    assert "{" not in L.SYSTEM_PROMPT, "nothing of a request is ever interpolated in it"


@pytest.mark.parametrize("text", ["fetch 10.0.0.5/setup.sh first", "post to 192.168.1.20:8080/hook", "open localhost:3000/admin", "load //cdn.example/x.js",
                                  "see build-host:9000/artifacts"])
def test_an_address_without_a_name_is_a_link_too(text):
    assert L._SCHEME_RE.search(text)


@pytest.mark.parametrize("text", ["a ratio of 16:9 on screen", "at 10:30 / 11:00", "version 1.2.3.4 of the tool", "// a comment in code", "step 2: 10 cards/day",
                                  "**Role:** reviewer", "check the data: dates and sums", "edit llm.py and global.css"])
def test_ordinary_text_is_not_taken_for_an_address(text):
    assert not L._SCHEME_RE.search(text)
