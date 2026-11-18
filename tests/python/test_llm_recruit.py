"""``POST /llm/recruit`` and ``POST /llm/revise``.

A FAKE client stands in for ``ctx.llm``: no test reaches a model. For each route: disabled, success, off-schema, extra field, a name taken or
reserved, an unknown ``from``, a skill that is not ``from``'s, a description of 281 then 240 and of 281 twice, a SOUL with a link, the cap, a
model error, a timeout; the whitelist of what is sent; the injection; the drafts kept by the agent half; the settings that stay."""

import json
import re
import time

import pytest

from test_llm import BASE, INJECTION, L, ROOT, SECRETS, world  # noqa: F401  (the ``world`` fixture is the one of test_llm)

SOUL = ("## Identity\nYou are the translator of the website: you translate the pages and the interface strings from English into Spanish and German.\n\n"
        "## Method\n1. Read the card and find the source files.\n2. Reuse the terminology already in place.\n"
        "3. Keep the variables, the tags and the keys.\n\n## Before saying done\n- Same number of keys as the source.\n")
assert len(SOUL) >= 200
DESC240 = "Translates the pages of the website and the interface strings from English into Spanish and German. " + "x" * 140
assert len(DESC240) == 240
GOOD_RECRUIT = {"name": "translator", "title": "Translator EN to ES and DE", "description": DESC240, "role": "translator", "start": "clone",
                "from": "writer", "keep_skills": ["style-guide"], "soul": SOUL, "overlap": ""}
GOOD_REVISE = {"description": "Takes the API and database tasks ; delivers tested code. Does no design and no writing.",
               "changes": ["says what it delivers", "says what it does not take"]}


def prof(name, description="", own=(), main=False):
    return {"name": name, "description": description, "isDefault": main, "soul": SECRETS[0], "path": SECRETS[1], "model": "x",
            "lastSession": {"title": SECRETS[4]}, "env": SECRETS[5],
            "skills": {"names": [*own, "bundled-thing"], "own": [{"name": n, "description": SECRETS[0], "path": SECRETS[1], "category": "c"} for n in own],
                       "path": SECRETS[1]}}


ROSTER = [prof("default", "", main=True), prof("research", "Watches the changelogs of the competing apps", ["changelog-monitor", "source-citations"]),
          prof("writer", "Writes articles and interface strings", ["style-guide", "plain-language"]), prof("backend", "API and database", ["api-contract-tests"])]


@pytest.fixture
def lm(world):
    world.readers.profiles = lambda: ROSTER
    return world


def turn_on(w, **extra):
    r = w.client.post(f"{BASE}/llm/settings", json={"features": {f: bool(extra.get(f, True)) for f in L.DECORATIVE}, "capUsd": extra.get("capUsd", 1),
                                                     "callCap": extra.get("callCap", 300)})
    assert r.status_code == 200, r.text
    on = {f: True for f in ("recruit", "revise") if extra.get(f, True)}
    r = w.client.post(f"{BASE}/llm/settings", json={"features": {**{f: False for f in L.DECORATIVE}, **on}, "capUsd": extra.get("capUsd", 1),
                                                     "callCap": extra.get("callCap", 300)})
    assert r.status_code == 200, r.text


def rpost(w, route, **body):
    defaults = {"recruit": {"mission": "A translator EN to ES and DE for the pages of the website"}, "revise": {"profile": "backend"}}[route]
    return w.client.post(f"{BASE}/llm/{route}", json={"id": w.uid(), **{**defaults, **body}})


ROUTES = ["recruit", "revise"]
GOODS = {"recruit": GOOD_RECRUIT, "revise": GOOD_REVISE}


def sent(w, n=-1):
    return json.loads(w.llm.calls[n]["input"][0]["text"])


# ------------------------------------------------------------------ disabled (the default), success
@pytest.mark.parametrize("route", ROUTES)
def test_disabled_by_default_calls_nothing(lm, route):
    out = rpost(lm, route).json()
    assert (out["result"], out["reason"]) == ("refused", "disabled") and lm.llm.calls == []
    assert lm.client.get(f"{BASE}/llm").json()["settings"]["features"][route] is False


@pytest.mark.parametrize("route", ROUTES)
def test_success_gives_a_validated_draft_with_its_route_and_counts_the_spend(lm, route):
    turn_on(lm)
    lm.llm.reply = GOODS[route]
    out = rpost(lm, route).json()
    assert out["result"] == "done" and out["ok"] is True and out["fiche"] == GOODS[route]
    assert (out["lane"], out["via"], out["retried"]) == ("light", "task", False) and out["model"] == "fake-model" and out["provider"] == "fake-provider"
    assert out["costUsd"] == 0.0004 and out["spend"]["calls"] == 1 and len(lm.llm.calls) == 1
    kw = lm.llm.calls[0]
    assert kw["task"] == "officecraft" and kw["timeout"] == 60 and kw["max_tokens"] == {"recruit": 6000, "revise": 4000}[route]
    assert kw["purpose"] == f"officecraft.{route}" and "ONE JSON object of DATA" in kw["instructions"] and "model" not in kw and "provider" not in kw
    assert "Write any free text in English." in kw["instructions"]
    state = lm.client.get(f"{BASE}/llm").json()
    assert state["spend"]["byFeature"][route] == {"calls": 1, "usd": 0.0004} and state["costs"][route]["status"] == "estimated"
    assert state["pending"][route] == {"id": out["id"], "at": out["at"], "target": "backend" if route == "revise" else None}
    assert "fiche" not in json.dumps(state["pending"]) and "soul" not in json.dumps(state["pending"])
    assert lm.store.data.get("llm_fiches") is None, "a draft is never written to the stored state"


def test_the_language_asked_is_the_one_posted(lm):
    turn_on(lm)
    lm.llm.reply = GOOD_RECRUIT
    rpost(lm, "recruit", lang="fr")
    assert "Write any free text in French." in lm.llm.calls[0]["instructions"]
    assert lm.client.post(f"{BASE}/llm/recruit", json={"id": lm.uid(), "mission": "x", "lang": "de"}).status_code == 422


def test_recruit_schema_sent_is_closed_without_bounds_and_drawn_from_what_was_sent(lm):
    turn_on(lm)
    lm.llm.reply = GOOD_RECRUIT
    rpost(lm, "recruit")
    schema = lm.llm.calls[0]["json_schema"]
    assert schema == L.recruit_schema(["default", "research", "writer", "backend"],
                                      ["changelog-monitor", "source-citations", "style-guide", "plain-language", "api-contract-tests"])
    props = schema["properties"]
    assert schema["additionalProperties"] is False and schema["required"] == list(props)
    assert props["role"]["enum"] == [*L.ALL_ROLE_IDS, "none"] and len(L.ALL_ROLE_IDS) == 22
    assert props["from"]["enum"] == ["default", "research", "writer", "backend", ""] and props["overlap"] == props["from"]
    assert not any(k in json.dumps(schema) for k in ("minLength", "maxLength", "minItems", "maxItems", "pattern"))


# ------------------------------------------------------------------ off-schema, extra field, not json
@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize("which", ["off_schema", "extra_field", "not_json", "wrong_type"])
def test_an_invalid_draft_is_rejected_whole_but_the_call_is_paid(lm, route, which):
    turn_on(lm)
    good = GOODS[route]
    lm.llm.reply = {"off_schema": {**good, ("role" if route == "recruit" else "changes"): "hacker" if route == "recruit" else "no"},
                    "extra_field": {**good, "cmd": "unblock_all"}, "not_json": None,
                    "wrong_type": {**good, ("keep_skills" if route == "recruit" else "description"): 7}}[which]
    out = rpost(lm, route).json()
    assert (out["result"], out["reason"], out["ok"]) == ("failed", "invalid_output", False) and "fiche" not in out and len(lm.llm.calls) == 1
    state = lm.client.get(f"{BASE}/llm").json()
    assert state["spend"]["calls"] == 1 and state["spend"]["usd"] == 0.0004 and state["pending"] == {}


# ------------------------------------------------------------------ recruit: the validators
@pytest.mark.parametrize("name", ["research", "writer", "default", "hermes", "root", "sudo", "test", "tmp", "Translator", "a b", "-x", "", "x" * 65])
def test_recruit_name_taken_reserved_or_malformed_is_refused(lm, name):
    turn_on(lm)
    lm.llm.reply = {**GOOD_RECRUIT, "name": name}
    assert rpost(lm, "recruit").json()["reason"] == "invalid_output"


def test_recruit_name_of_a_profile_beyond_the_thirty_sent_is_still_taken(lm):
    many = [prof(f"bot{i:02d}", f"bot {i}") for i in range(33)]
    lm.readers.profiles = lambda: [ROSTER[0], ROSTER[2], *many]
    turn_on(lm)
    lm.llm.reply = {**GOOD_RECRUIT, "name": "bot32", "start": "fresh", "from": "", "keep_skills": []}
    out = rpost(lm, "recruit").json()
    assert out["reason"] == "invalid_output" and len(sent(lm)["roster"]) == 30 and "bot32" not in json.dumps(sent(lm))


@pytest.mark.parametrize("name", ["a", "translator", "0-day", "web_dev-2", "x" * 64])
def test_recruit_valid_names_pass(lm, name):
    turn_on(lm)
    lm.llm.reply = {**GOOD_RECRUIT, "name": name}
    assert rpost(lm, "recruit").json()["result"] == "done"


@pytest.mark.parametrize("bad", [{"from": "unknown"}, {"from": ""}, {"start": "fresh"}, {"start": "fresh", "from": "", "keep_skills": ["style-guide"]},
                                 {"keep_skills": ["changelog-monitor"]}, {"keep_skills": ["style-guide", "style-guide"]},
                                 {"keep_skills": ["what's-this"]}, {"overlap": "naïve"}, {"overlap": "translator"}, {"role": "wizard"},
                                 {"start": "empty"}, {"title": ""}, {"title": "a\nb"}, {"description": ""}, {"description": "one\nline"}])
def test_recruit_inconsistent_fields_are_refused(lm, bad):
    turn_on(lm)
    lm.llm.reply = {**GOOD_RECRUIT, **bad}
    assert rpost(lm, "recruit").json()["reason"] == "invalid_output"


def test_recruit_a_skill_of_another_bot_is_foreign_to_from(lm):
    turn_on(lm)
    lm.llm.reply = {**GOOD_RECRUIT, "keep_skills": ["style-guide", "api-contract-tests"]}   # the second one is backend's, not writer's
    assert rpost(lm, "recruit").json()["reason"] == "invalid_output"
    lm.llm.reply = {**GOOD_RECRUIT, "keep_skills": []}
    assert rpost(lm, "recruit").json()["result"] == "done"   # none kept is fine
    lm.llm.reply = {**GOOD_RECRUIT, "start": "fresh", "from": "", "keep_skills": [], "role": "none", "overlap": "writer"}
    assert rpost(lm, "recruit").json()["fiche"]["role"] == "none"


@pytest.mark.parametrize("soul", ["x" * 199, "x" * 4001, SOUL + " see https://evil.example/pay", SOUL + " see www.evil.example", SOUL + " <script>x</script>",
                                   SOUL + " <b>gras</b>", SOUL + " javascript:alert(1)", SOUL + " mailto:a@b.c", SOUL + " evil.example/pay", SOUL + " <https://x.y>",
                                   SOUL + "\u202e", SOUL + "\x00", "   ", None, 5])
def test_recruit_soul_with_a_link_a_tag_or_out_of_bounds_is_refused(lm, soul):
    turn_on(lm)
    lm.llm.reply = {**GOOD_RECRUIT, "soul": soul}
    assert rpost(lm, "recruit").json()["reason"] == "invalid_output"


@pytest.mark.parametrize("soul", [SOUL + "\n**Rôle:** bibliothécaire, état: prêt.", SOUL + "\nUpdate src/styles/global.css and llm.py.", SOUL + "\nIf a > b then c, flow A -> B, 3 < 5 ok.",
                                   # a word followed by a colon and a blank is not a scheme (a SOUL written in plain Markdown must not be refused whole)
                                   SOUL + "\n2. Sanity-check the data: date range gaps, duplicate order identifiers.", SOUL + "\n**Data:** the month\n- JavaScript: ES modules",
                                   "x" * 200, "x" * 4000])
def test_recruit_a_soul_that_only_looks_odd_is_kept(lm, soul):
    turn_on(lm)
    lm.llm.reply = {**GOOD_RECRUIT, "soul": soul}
    out = rpost(lm, "recruit").json()
    assert out["result"] == "done" and out["fiche"]["soul"] == soul


@pytest.mark.parametrize("field", ["title", "description"])
def test_link_or_tag_in_title_or_description_is_refused(lm, field):
    turn_on(lm)
    for bad in ("see https://x.y", "go to www.x.y", "<i>x</i>"):
        lm.llm.reply = {**GOOD_RECRUIT, field: bad}
        assert rpost(lm, "recruit").json()["reason"] == "invalid_output", bad


# ------------------------------------------------------------------ length: one relaunch that says so, never a cut
def two_answers(first, second):
    box = {"n": 0}

    def reply(kw):
        box["n"] += 1
        return first if box["n"] == 1 else second
    return reply


@pytest.mark.parametrize("route", ROUTES)
def test_a_description_of_281_then_240_is_relaunched_once_and_the_second_answer_is_kept(lm, route):
    turn_on(lm)
    long_ = "d" * 281
    good = GOODS[route]
    lm.llm.reply = two_answers({**good, "description": long_}, good)
    out = rpost(lm, route).json()
    assert out["result"] == "done" and out["retried"] is True and out["fiche"] == good and len(lm.llm.calls) == 2
    first, second = lm.llm.calls
    assert second["instructions"] == first["instructions"] + " Your previous answer had a description of 281 characters: at most 240."
    assert second["input"] == first["input"] and second["json_schema"] == first["json_schema"], "same input, same schema: only one sentence added"
    assert long_ not in json.dumps(second), "nothing of the first answer is quoted back"
    state = lm.client.get(f"{BASE}/llm").json()
    assert state["spend"]["calls"] == 2 and state["spend"]["usd"] == 0.0008 and out["costUsd"] == 0.0008, "both calls are counted"
    assert state["pending"][route]["id"] == out["id"]


@pytest.mark.parametrize("route", ROUTES)
def test_a_description_of_281_twice_is_refused_after_two_calls_never_cut(lm, route):
    turn_on(lm)
    lm.llm.reply = {**GOODS[route], "description": "d" * 281}
    out = rpost(lm, route).json()
    assert (out["result"], out["reason"], out["retried"]) == ("failed", "invalid_output", True) and "fiche" not in out and len(lm.llm.calls) == 2
    state = lm.client.get(f"{BASE}/llm").json()
    assert state["spend"]["calls"] == 2 and state["pending"] == {}


@pytest.mark.parametrize("route", ROUTES)
def test_a_description_of_exactly_280_needs_no_relaunch(lm, route):
    turn_on(lm)
    lm.llm.reply = {**GOODS[route], "description": "d" * 280}
    out = rpost(lm, route).json()
    assert out["result"] == "done" and out["retried"] is False and len(out["fiche"]["description"]) == 280 and len(lm.llm.calls) == 1


def test_recruit_a_title_of_61_is_relaunched_and_both_sizes_are_said(lm):
    turn_on(lm)
    lm.llm.reply = two_answers({**GOOD_RECRUIT, "title": "t" * 61, "description": "d" * 300}, GOOD_RECRUIT)
    out = rpost(lm, "recruit").json()
    assert out["retried"] is True and out["result"] == "done"
    assert lm.llm.calls[1]["instructions"].endswith("Your previous answer had a description of 300 characters: at most 240 and a title of 61 characters: at most 60.")


def test_a_length_is_the_only_fault_that_earns_a_relaunch(lm):
    turn_on(lm)
    lm.llm.reply = {**GOOD_RECRUIT, "description": "d" * 300, "role": "hacker"}   # too long AND wrong: the shape is wrong, no second call
    assert rpost(lm, "recruit").json()["reason"] == "invalid_output" and len(lm.llm.calls) == 1
    lm.llm.reply = {**GOOD_RECRUIT, "description": "d" * 2001}   # not « a bit long »: wrong
    assert rpost(lm, "recruit").json()["reason"] == "invalid_output" and len(lm.llm.calls) == 2
    lm.llm.reply = {**GOOD_RECRUIT, "description": "d" * 300, "name": "root"}
    assert rpost(lm, "recruit").json()["reason"] == "invalid_output" and len(lm.llm.calls) == 3


def test_the_relaunch_checks_the_cap_again_first(lm):
    lm.engine.cost_fn = lambda result: (0.006, "estimated")
    turn_on(lm, capUsd=0.01)   # one call at 0.006 $ fits, the relaunch (0.006 spent + 0.006 for a call like it > 0.01) does not
    lm.llm.reply = {**GOOD_RECRUIT, "description": "d" * 281}
    out = rpost(lm, "recruit").json()
    assert (out["result"], out["reason"], out["cap"]) == ("refused", "cap_reached", "usd") and len(lm.llm.calls) == 1
    assert lm.client.get(f"{BASE}/llm").json()["spend"]["calls"] == 1


def test_the_relaunch_is_one_more_call_on_a_priced_model_and_the_dollar_cap_holds(lm):
    lm.engine.has_capability = lambda cap: True
    lm.engine.price_fn = lambda model, provider: {"input": 0.036, "output": 0.5, "request": 0.0}
    lm.client.post(f"{BASE}/llm/settings", json={"features": {"recruit": True}, "capUsd": 0.2, "callCap": 300,
                                                 "models": {"light": {"provider": "acme-cloud", "model": "example/x"}}})
    lm.llm.reply = two_answers({**GOOD_RECRUIT, "description": "d" * 281}, GOOD_RECRUIT)
    out = rpost(lm, "recruit").json()
    assert out["result"] == "done" and out["via"] == "model" and out["model"] == "example/x" and out["retried"] is True
    assert all(kw["model"] == "example/x" and kw["max_tokens"] == 6000 and "task" not in kw for kw in lm.llm.calls) and len(lm.llm.calls) == 2


# ------------------------------------------------------------------ revise: the validators
@pytest.mark.parametrize("bad", [{"changes": ["a", "b", "c", "d"]}, {"changes": ["x" * 121]}, {"changes": [""]}, {"changes": ["a\nb"]}, {"changes": ["see https://x.y"]},
                                 {"changes": "several"}, {"changes": [1]}, {"description": ""}, {"description": "a\nb"}, {"description": "see www.x.y"},
                                 {"description": "<b>x</b>"}, {"description": "x\u202e"}, {"description": 5}])
def test_revise_invalid_fields_are_refused(lm, bad):
    turn_on(lm)
    lm.llm.reply = {**GOOD_REVISE, **bad}
    assert rpost(lm, "revise").json()["reason"] == "invalid_output"


def test_revise_three_changes_or_none_are_fine(lm):
    turn_on(lm)
    for changes in ([], ["a", "b", "c"], ["x" * 120]):
        lm.llm.reply = {**GOOD_REVISE, "changes": changes}
        assert rpost(lm, "revise").json()["fiche"]["changes"] == changes


def test_revise_unknown_bot_or_main_bot_without_a_description_sends_nothing(lm):
    turn_on(lm)
    lm.llm.reply = GOOD_REVISE
    for profile in ("naïve", "Backend", "../../etc/passwd", "default"):   # « default » is the main bot and has no description
        out = rpost(lm, "revise", profile=profile).json()
        assert (out["result"], out["reason"]) == ("refused", "nothing_to_send"), profile
    assert lm.llm.calls == [] and lm.client.get(f"{BASE}/llm").json()["spend"]["calls"] == 0


def test_revise_the_main_bot_with_a_description_is_revised(lm):
    lm.readers.profiles = lambda: [prof("default", "Mon assistant principal", ["officecraft"], main=True), *ROSTER[1:]]
    turn_on(lm)
    lm.llm.reply = GOOD_REVISE
    out = rpost(lm, "revise", profile="default").json()
    assert out["result"] == "done"
    assert sent(lm)["bot"] == {"name": "default", "description": "Mon assistant principal", "own_skills": ["officecraft"]}
    assert [r["name"] for r in sent(lm)["roster"]] == ["research", "writer", "backend"]


def test_revise_a_bot_that_is_not_the_main_one_is_revised_even_without_a_description(lm):
    lm.readers.profiles = lambda: [ROSTER[0], prof("newcomer", "", ["style-guide"]), ROSTER[3]]
    turn_on(lm)
    lm.llm.reply = GOOD_REVISE
    assert rpost(lm, "revise", profile="newcomer").json()["result"] == "done"
    assert sent(lm)["bot"] == {"name": "newcomer", "description": "", "own_skills": ["style-guide"]}


# ------------------------------------------------------------------ cap, model error, timeout
@pytest.mark.parametrize("route", ROUTES)
def test_the_cap_reached_refuses_before_any_call(lm, route):
    turn_on(lm, capUsd=0)
    out = rpost(lm, route).json()
    assert (out["result"], out["reason"], out["cap"]) == ("refused", "cap_reached", "usd") and lm.llm.calls == []


@pytest.mark.parametrize("route", ROUTES)
def test_the_calls_cap_refuses_when_the_price_is_unknown(lm, route):
    lm.engine.cost_fn = lambda result: (None, "unknown")
    turn_on(lm, callCap=1)
    lm.llm.reply = GOODS[route]
    assert rpost(lm, route).json()["result"] == "done"
    out = rpost(lm, route).json()
    assert (out["reason"], out["cap"]) == ("cap_reached", "calls") and len(lm.llm.calls) == 1


@pytest.mark.parametrize("route", ROUTES)
def test_a_model_error_is_a_reason_code_never_the_text_and_keeps_no_draft(lm, route):
    turn_on(lm)
    lm.llm.error = RuntimeError("SECRET-TOKEN-in-the-message")
    out = rpost(lm, route).json()
    assert (out["result"], out["reason"], out["costStatus"], out["retried"]) == ("failed", "model_error", "error", False)
    assert "SECRET-TOKEN" not in json.dumps(out) and lm.client.get(f"{BASE}/llm").json()["pending"] == {}


@pytest.mark.parametrize("route", ROUTES)
def test_a_timeout_is_said_as_one(lm, route):
    turn_on(lm)

    class DeadlineTimeout(Exception):
        pass

    lm.llm.error = DeadlineTimeout("60 s")
    out = rpost(lm, route).json()
    assert (out["result"], out["reason"]) == ("failed", "timeout") and lm.llm.calls[0]["timeout"] == 60


def test_a_schema_mismatch_on_hermes_side_is_an_invalid_draft(lm):
    turn_on(lm)
    lm.llm.error = ValueError("structured output did not match schema")
    assert rpost(lm, "recruit").json()["reason"] == "invalid_output"


def test_a_second_call_that_fails_after_the_relaunch_says_so(lm):
    turn_on(lm)

    def reply(kw):
        if len(lm.llm.calls) == 1:
            return {**GOOD_RECRUIT, "description": "d" * 281}
        raise RuntimeError("down")
    lm.llm.reply = reply
    out = rpost(lm, "recruit").json()
    assert (out["reason"], out["retried"]) == ("model_error", True) and out["costUsd"] == 0.0004 and lm.client.get(f"{BASE}/llm").json()["spend"]["calls"] == 2


def test_one_call_at_a_time_on_the_light_lane(lm):
    import threading
    turn_on(lm)
    lm.llm.reply = GOOD_RECRUIT
    lm.llm.gate = threading.Event()
    results = []
    t = threading.Thread(target=lambda: results.append(rpost(lm, "recruit")))
    t.start()
    for _ in range(500):   # bounded: a call that never reaches the model must fail this test, not hang it
        if lm.llm.calls:
            break
        time.sleep(0.01)
    assert lm.llm.calls, "the first call never reached the fake client"
    out = rpost(lm, "revise")
    assert out.status_code == 409 and out.json()["reason"] == "busy"   # revise is on the same lane as recruit
    lm.llm.gate.set()
    t.join(5)
    assert results[0].json()["result"] == "done"


# ------------------------------------------------------------------ the whitelist: what is sent, and what the page cannot add
def test_recruit_sends_exactly_the_whitelist_and_no_secret(lm):
    turn_on(lm)
    lm.llm.reply = GOOD_RECRUIT
    rpost(lm, "recruit", mission="  A translator   EN\u200b to ES \n")
    payload = sent(lm)
    assert set(payload) == {"mission", "roster", "roles", "reserved"} == set(L.SENDS["recruit"]["top"])
    assert payload["mission"] == "A translator EN to ES"
    assert payload["roles"] == list(L.ALL_ROLE_IDS) and payload["reserved"] == list(L.RESERVED_NAMES)
    assert [set(r) for r in payload["roster"]] == [{"name", "description", "own_skills"}] * 4
    assert payload["roster"][1] == {"name": "research", "description": "Watches the changelogs of the competing apps", "own_skills": ["changelog-monitor", "source-citations"]}
    wire = json.dumps(lm.llm.calls[0], ensure_ascii=False)
    for secret in (*SECRETS, "bundled-thing", "isDefault", "lastSession"):
        assert secret not in wire, secret
    L.check_sent("recruit", payload)


def test_revise_sends_exactly_the_whitelist_and_no_secret(lm):
    turn_on(lm)
    lm.llm.reply = GOOD_REVISE
    rpost(lm, "revise")
    payload = sent(lm)
    assert set(payload) == {"bot", "roster"} and set(payload["bot"]) == {"name", "description", "own_skills"} == set(L.SENDS["revise"]["nested"]["bot"])
    assert payload["bot"] == {"name": "backend", "description": "API and database", "own_skills": ["api-contract-tests"]}
    assert [r["name"] for r in payload["roster"]] == ["default", "research", "writer"] and all(set(r) == {"name", "description"} for r in payload["roster"])
    wire = json.dumps(lm.llm.calls[0], ensure_ascii=False)
    for secret in (*SECRETS, "bundled-thing", "isDefault"):
        assert secret not in wire, secret
    L.check_sent("revise", payload)


@pytest.mark.parametrize("extra", [{"soul": "x"}, {"roster": [{"name": "faux", "description": "d", "own_skills": []}]}, {"skills": ["x"]}, {"path": "/etc"},
                                   {"roles": ["root"]}, {"reserved": []}, {"session": "content"}, {"bot": {"name": "x"}}, {"model": "gpt"}, {"provider": "x"}, {"task": "t"}])
@pytest.mark.parametrize("route", ROUTES)
def test_the_page_cannot_inject_a_bot_a_skill_or_anything_by_the_body(lm, route, extra):
    turn_on(lm)
    lm.llm.reply = GOODS[route]
    r = rpost(lm, route, **extra)
    assert r.status_code == 422 and lm.llm.calls == []


@pytest.mark.parametrize("route, key", [("recruit", "soul"), ("revise", "path")])
def test_a_forbidden_field_in_the_payload_is_a_bug_that_calls_nothing(lm, route, key):
    """The whitelist is checked again just before the call: a builder that leaks a field plants it in the payload; the call never leaves."""
    turn_on(lm)
    lm.llm.reply = GOODS[route]
    build = getattr(lm.engine, f"_build_{route}")

    def leaky(body, now):
        payload, ctx = build(body, now)
        for item in (payload["roster"][:1] if route == "recruit" else [payload["bot"]]):
            item[key] = "LEAK"
        return payload, ctx
    setattr(lm.engine, f"_build_{route}", leaky)
    body = (L.RecruitIn(id=lm.uid(), mission="m") if route == "recruit" else L.ReviseIn(id=lm.uid(), profile="backend"))
    with pytest.raises(ValueError):
        lm.engine.run(route, body)
    assert lm.llm.calls == []
    assert lm.client.get(f"{BASE}/llm").json()["spend"]["calls"] == 0


def test_check_sent_knows_the_nested_record_and_the_new_lists():
    ok_recruit = {"mission": "m", "roster": [{"name": "a", "description": "d", "own_skills": []}], "roles": [], "reserved": []}
    L.check_sent("recruit", ok_recruit)
    for bad in ({**ok_recruit, "soul": "x"}, {**ok_recruit, "roster": [{"name": "a", "description": "d", "own_skills": [], "soul": "x"}]},
                {"mission": "m", "roster": [], "roles": []}):
        with pytest.raises(ValueError):
            L.check_sent("recruit", bad)
    ok_revise = {"bot": {"name": "a", "description": "d", "own_skills": []}, "roster": []}
    L.check_sent("revise", ok_revise)
    for bad in ({**ok_revise, "bot": {"name": "a", "description": "d"}}, {**ok_revise, "bot": {"name": "a", "description": "d", "own_skills": [], "soul": "x"}}, {"bot": {}, "roster": []}):
        with pytest.raises(ValueError):
            L.check_sent("revise", bad)


def test_bodies_are_bounded(lm):
    turn_on(lm)
    lm.llm.reply = GOOD_RECRUIT
    post = lambda **b: lm.client.post(f"{BASE}/llm/recruit", json={"id": lm.uid(), **b}).status_code   # noqa: E731
    assert post(mission="") == 422 and post(mission="x" * 1001) == 422 and post(mission=5) == 422 and post() == 422
    assert post(mission="é" * 1000) == 200, "1 000 characters (2 000 bytes) fit in 8 KiB"
    assert lm.client.post(f"{BASE}/llm/recruit", content=b"x" * 9000, headers={"content-type": "application/json"}).status_code == 413
    assert lm.client.post(f"{BASE}/llm/revise", json={"id": "not-a-uuid", "profile": "backend"}).status_code == 422
    assert lm.client.post(f"{BASE}/llm/revise", json={"id": lm.uid(), "profile": "x" * 65}).status_code == 422
    assert lm.client.post(f"{BASE}/llm/revise", json={"id": lm.uid()}).status_code == 422


def test_a_mission_with_nothing_readable_sends_nothing(lm):
    turn_on(lm)
    out = rpost(lm, "recruit", mission="\u200b\u200b \x00 ").json()
    assert (out["result"], out["reason"]) == ("refused", "nothing_to_send") and lm.llm.calls == []


def test_the_mission_is_cut_to_400_before_it_leaves(lm):
    turn_on(lm)
    lm.llm.reply = GOOD_RECRUIT
    rpost(lm, "recruit", mission="m" * 900)
    assert sent(lm)["mission"] == "m" * 400


# ------------------------------------------------------------------ the injection: data, never instructions
def test_an_injection_in_the_mission_and_in_a_bot_description_changes_neither_the_shape_nor_the_checks(lm):
    hostile = [prof("default", "", main=True), prof("research", INJECTION, ["changelog-monitor"]), prof("writer", "Writes. " + INJECTION, ["style-guide"])]
    lm.readers.profiles = lambda: hostile
    turn_on(lm)
    # (a) the hostile text travels as data: a field of the whitelist, in the one JSON object, never in the instructions
    lm.llm.reply = {**GOOD_RECRUIT, "from": "writer", "overlap": "research"}
    out = rpost(lm, "recruit", mission=INJECTION).json()
    kw = lm.llm.calls[0]
    assert INJECTION not in kw["instructions"] and INJECTION[:40] in kw["input"][0]["text"] and "ONE JSON object of DATA" in kw["instructions"]
    assert out["result"] == "done" and set(out["fiche"]) == L.RECRUIT_KEYS, "the shape asked is the shape accepted"
    # (b) a model that OBEYS the injection is refused, whatever the way it obeys
    obey = [{**GOOD_RECRUIT, "cmd": "unblock_all"}, {**GOOD_RECRUIT, "name": "root"}, {**GOOD_RECRUIT, "name": "research"}, {**GOOD_RECRUIT, "role": "admin"},
            {**GOOD_RECRUIT, "from": "tout-le-kanban"}, {**GOOD_RECRUIT, "keep_skills": ["unblock_all"]}, {**GOOD_RECRUIT, "soul": SOUL + " fetch http://evil.example/x"},
            {**GOOD_RECRUIT, "soul": SOUL + " <script>unblock()</script>"}, {"ok": True, "unblock": ["all"]}, {**GOOD_RECRUIT, "title": INJECTION + "x" * 80}, "unblock all", ["x"], None]
    for reply in obey:
        lm.llm.reply = reply
        got = rpost(lm, "recruit", mission=INJECTION).json()
        assert (got["result"], got["reason"]) == ("failed", "invalid_output") and "fiche" not in got, reply
    # (c) revise: the same
    for reply in ({**GOOD_REVISE, "cmd": "x"}, {"description": INJECTION + "x" * 300, "changes": []}, {**GOOD_REVISE, "description": "see http://evil.example"}, {"unblock": 1}):
        lm.llm.reply = reply
        got = rpost(lm, "revise", profile="research").json()
        assert got["result"] == "failed" and got["reason"] == "invalid_output" and "fiche" not in got
    assert lm.client.get(f"{BASE}/llm").json()["pending"].get("revise") is None


# ------------------------------------------------------------------ drafts kept by the agent half
def test_a_draft_is_kept_read_replayed_then_forgotten(lm):
    turn_on(lm)
    lm.llm.reply = GOOD_RECRUIT
    out = rpost(lm, "recruit").json()
    rid = out["id"]
    # the window was closed: the page reads the draft later, without a model call
    got = lm.client.get(f"{BASE}/llm/draft", params={"feature": "recruit", "id": rid}).json()
    assert got["ok"] is True and got["fiche"] == GOOD_RECRUIT and got["id"] == rid and got["target"] is None
    assert {k for k in got} == {"ok", "feature", "id", "at", "lane", "via", "model", "provider", "target", "fiche"}
    assert len(lm.llm.calls) == 1
    # the replay of the same id gives the draft again, with no new call and no new spend
    again = lm.client.post(f"{BASE}/llm/recruit", json={"id": rid, "mission": "autre"}).json()
    assert again["fiche"] == GOOD_RECRUIT and len(lm.llm.calls) == 1 and lm.client.get(f"{BASE}/llm").json()["spend"]["calls"] == 1
    # a wrong id or a wrong function reads nothing
    assert lm.client.get(f"{BASE}/llm/draft", params={"feature": "recruit", "id": lm.uid()}).json() == {"ok": False, "reason": "expired"}
    assert lm.client.get(f"{BASE}/llm/draft", params={"feature": "revise", "id": rid}).json() == {"ok": False, "reason": "expired"}
    assert lm.client.get(f"{BASE}/llm/draft", params={"feature": "decor", "id": rid}).status_code == 422
    assert lm.client.get(f"{BASE}/llm/draft", params={"feature": "recruit", "id": "x"}).status_code == 422
    # « apply » (the page) forgets it
    assert lm.client.post(f"{BASE}/llm/draft/forget", json={"id": lm.uid(), "feature": "recruit"}).json()["forgotten"] is False
    assert lm.client.post(f"{BASE}/llm/draft/forget", json={"id": rid, "feature": "recruit"}).json() == {"ok": True, "id": rid, "feature": "recruit", "forgotten": True}
    assert lm.client.get(f"{BASE}/llm/draft", params={"feature": "recruit", "id": rid}).json() == {"ok": False, "reason": "expired"}
    assert lm.client.get(f"{BASE}/llm").json()["pending"] == {}
    replay = lm.client.post(f"{BASE}/llm/recruit", json={"id": rid, "mission": "x"}).json()
    assert replay["result"] == "done" and replay["expired"] is True and "fiche" not in replay and len(lm.llm.calls) == 1


def test_a_draft_is_forgotten_after_30_minutes_and_the_last_one_replaces_the_previous(lm):
    turn_on(lm)
    lm.llm.reply = GOOD_RECRUIT
    first = rpost(lm, "recruit").json()["id"]
    lm.clock.t += 60
    lm.llm.reply = {**GOOD_RECRUIT, "name": "autre"}
    second = rpost(lm, "recruit").json()["id"]
    assert lm.client.get(f"{BASE}/llm/draft", params={"feature": "recruit", "id": first}).json()["reason"] == "expired"
    assert lm.client.get(f"{BASE}/llm/draft", params={"feature": "recruit", "id": second}).json()["fiche"]["name"] == "autre"
    lm.clock.t += 30 * 60 - 1
    assert lm.client.get(f"{BASE}/llm").json()["pending"]["recruit"]["id"] == second
    lm.clock.t += 2
    assert lm.client.get(f"{BASE}/llm").json()["pending"] == {}
    assert lm.client.get(f"{BASE}/llm/draft", params={"feature": "recruit", "id": second}).json() == {"ok": False, "reason": "expired"}
    assert lm.client.post(f"{BASE}/llm/recruit", json={"id": second, "mission": "x"}).json()["expired"] is True


def test_the_draft_lives_in_memory_only(lm):
    turn_on(lm)
    lm.llm.reply = GOOD_RECRUIT
    rpost(lm, "recruit")
    assert "soul" not in json.dumps(lm.store.data) and SOUL[:30] not in json.dumps(lm.store.data), "no SOUL in the stored state"
    fresh = L.Engine(store=lambda: lm.store, clock=lm.clock, readers=lm.readers)   # the gateway restarted
    assert fresh.pending() == {} and fresh.get_draft("recruit", "x") == {"ok": False, "reason": "expired"}


def test_reading_and_forgetting_a_draft_work_with_the_switch_off_and_call_no_model(lm):
    turn_on(lm)
    lm.llm.reply = GOOD_REVISE
    rid = rpost(lm, "revise").json()["id"]
    turn_on(lm, recruit=False, revise=False)
    assert lm.client.get(f"{BASE}/llm/draft", params={"feature": "revise", "id": rid}).json()["fiche"] == GOOD_REVISE
    assert lm.client.get(f"{BASE}/llm/draft", params={"feature": "revise", "id": rid}).json()["target"] == "backend"
    assert lm.client.post(f"{BASE}/llm/draft/forget", json={"id": rid, "feature": "revise"}).json()["forgotten"] is True
    assert len(lm.llm.calls) == 1


def test_a_refused_call_keeps_the_previous_draft(lm):
    turn_on(lm)
    lm.llm.reply = GOOD_RECRUIT
    kept = rpost(lm, "recruit").json()["id"]
    lm.llm.reply = {**GOOD_RECRUIT, "name": "root"}
    assert rpost(lm, "recruit").json()["reason"] == "invalid_output"
    assert lm.client.get(f"{BASE}/llm").json()["pending"]["recruit"]["id"] == kept


# ------------------------------------------------------------------ settings, health, parity
def test_an_older_page_that_does_not_send_the_new_switches_changes_none_of_them(lm):
    turn_on(lm)
    body = {"features": {f: False for f in L.DECORATIVE}, "capUsd": 1, "callCap": 300}   # what an older page posts
    state = lm.client.post(f"{BASE}/llm/settings", json=body).json()
    assert state["settings"]["features"]["recruit"] is True and state["settings"]["features"]["revise"] is True
    state = lm.client.post(f"{BASE}/llm/settings", json={**body, "features": {**body["features"], "recruit": False}}).json()
    assert state["settings"]["features"]["recruit"] is False and state["settings"]["features"]["revise"] is True
    state = lm.client.post(f"{BASE}/llm/settings", json={**body, "features": {**body["features"], "revise": None}}).json()   # null = not sent
    assert state["settings"]["features"]["revise"] is True
    assert lm.client.post(f"{BASE}/llm/settings", json={**body, "features": {"recruit": "yes"}}).status_code == 422


def test_the_new_switches_are_off_by_default_and_a_bad_stored_value_reads_off(lm):
    assert L.default_settings()["features"]["recruit"] is False and L.default_settings()["features"]["revise"] is False
    lm.store.data["llm_settings"] = {"features": {"recruit": "true", "revise": 1}, "capUsd": 1, "callCap": 300}
    assert lm.engine.settings()["features"]["recruit"] is False and lm.engine.settings()["features"]["revise"] is False


def test_health_announces_the_two_routes(lm):
    caps = lm.client.get(f"{BASE}/health").json()["capabilities"]
    assert "llm:recruit" in caps and "llm:revise" in caps


def test_the_routes_are_served_by_the_light_lane(lm):
    assert L.LANE_OF["recruit"] == "light" == L.LANE_OF["revise"]
    state = lm.client.get(f"{BASE}/llm").json()
    assert state["routes"]["recruit"]["lane"] == "light" and state["routes"]["revise"]["lane"] == "light"
    assert state["sends"]["recruit"] == ["mission", "roster.name", "roster.description", "roster.own_skills", "roles", "reserved"]
    assert state["sends"]["revise"] == ["bot.name", "bot.description", "bot.own_skills", "roster.name", "roster.description"]


def test_the_22_types_and_the_reserved_names_are_the_wardrobe_and_the_page(lm):
    wardrobe = (ROOT / "src" / "scene" / "wardrobe.js").read_text(encoding="utf-8")
    extra = (ROOT / "src" / "scene" / "wardrobeExtra.js").read_text(encoding="utf-8")
    block = extra[extra.index("export const EXTRA_ROLES"):]
    assert re.findall(r"^  (\w+): \{ label:", block, re.M) == list(L.EXTRA_ROLE_IDS)
    assert "Object.assign(ROLES, EXTRA_ROLES)" in wardrobe and len(L.ALL_ROLE_IDS) == 22 == len(set(L.ALL_ROLE_IDS))
    recruit_js = (ROOT / "src" / "core" / "recruit.js").read_text(encoding="utf-8")
    reserved = re.search(r"RESERVED = Object\.freeze\(\[([^\]]*)\]\)", recruit_js).group(1)
    assert re.findall(r"'([^']+)'", reserved) == list(L.RESERVED_NAMES)
    assert L._NEW_NAME_RE.pattern == re.search(r"NAME_RE = /(.+)/", recruit_js).group(1)
    assert (L.TITLE_LIMIT, L.DESCRIPTION_LIMIT) == (int(re.search(r"TITLE_MAX = (\d+)", recruit_js).group(1)), int(re.search(r"DESCRIPTION_MAX = (\d+)", recruit_js).group(1)))


def test_the_routes_create_nothing_and_import_nothing_that_writes():
    source = (ROOT / "hermes_officecraft" / "llm.py").read_text(encoding="utf-8")
    code = "\n".join(line for line in source.splitlines() if not line.lstrip().startswith("#"))
    for banned in ("import kanban_db", "profiles.create", "profiles.configure", "write_text", "subprocess", "run_order", "unblock_task", "complete_task", "from . import orders"):
        assert banned not in code, banned
    api = (ROOT / "hermes_officecraft" / "api.py").read_text(encoding="utf-8")
    for route in ("post_llm_recruit", "post_llm_revise"):
        body = api[api.index(f"async def {route}"):].split("\n\n\n")[0]
        assert "_llm_call" in body and "orders" not in body and "campaign" not in body


# ------------------------------------------------------------------ the page and the agent agree on what a model may write
def test_model_text_agrees_with_the_cases_the_page_runs():
    """tests/js/llm-recruit.test.mjs runs the same file through ``modelTextOk``: the two sides must not differ on any case."""
    cases = json.loads((ROOT / "tests" / "js" / "fixtures" / "llm-model-text-cases.json").read_text(encoding="utf-8"))["cases"]
    assert len(cases) > 30
    for c in cases:
        text = c["text"] * c.get("repeat", 1)
        assert L._model_text(text, c["hi"], multiline=c.get("multiline", False), lo=c.get("lo", 1)) is c["ok"], c
