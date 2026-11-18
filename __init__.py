"""Officecraft - agent half.

Two jobs. The REST namespace (``/api/plugins/hermes-officecraft/*``) is served through ``dashboard/plugin_api.py``;
the desktop half degrades to read-only when it is absent. And ``register`` hangs the notifier
(``hermes_officecraft/notify.py``) on three hooks of the gateway: ``on_kanban_dispatch_tick`` (the dispatcher's tick,
so no page needs to be open), ``pre_approval_request`` and ``post_approval_response`` (that an approval waits; never
its command). It registers no tool and no middleware, creates no scheduled task, and does nothing until the user
switches a notification type on in the settings.
"""

import importlib
import importlib.util
import sys
from pathlib import Path

_PACKAGE = Path(__file__).resolve().parent / "hermes_officecraft"
_NAME = "_officecraft_http"   # the same private name dashboard/plugin_api.py uses: one copy of the package per process


def _module(name: str):
    if _NAME not in sys.modules:
        spec = importlib.util.spec_from_file_location(_NAME, _PACKAGE / "__init__.py", submodule_search_locations=[str(_PACKAGE)])
        if spec is None or spec.loader is None:
            raise ImportError(f"cannot load {_PACKAGE}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[_NAME] = module
        spec.loader.exec_module(module)
    return importlib.import_module(_NAME + "." + name)


def _notifier():
    return _module("notify").notifier()


def register(ctx):
    try:
        notifier = _notifier()
        ctx.register_hook("on_kanban_dispatch_tick", notifier.on_tick)
        ctx.register_hook("pre_approval_request", notifier.on_approval)
        ctx.register_hook("post_approval_response", notifier.on_approval_done)
    except Exception:   # noqa: BLE001 - a plugin that cannot hook must still load (the routes and the desktop half work)
        pass
    # LLM functions: the auxiliary task `officecraft` (the user picks its model in Settings -> Models ->
    # Auxiliary; Hermes writes that choice, never this plugin) and `ctx.llm`, which exists on the agent side only and is
    # handed to the module the routes share. Nothing is called here: every function is OFF until the user switches it on.
    try:
        ctx.register_auxiliary_task("officecraft", display_name="Officecraft",
                                    description="Officecraft light model: recruit, revise a bot, review a campaign draft; decor, outfits, wall art, "
                                                "seating, thought bubbles (short JSON answers, drafts to review).")
        llm_llm = ctx.llm
    except Exception:   # noqa: BLE001 - an older Hermes without plugin LLM access: the functions are simply not offered
        return None
    # A 2nd auxiliary task for the strong lane (it follows « Officecraft » until the user picks another model), and
    # ``ctx.has_capability`` (Hermes >= v0.22.0) to know, without calling, whether the user granted `llm.model_override` and
    # `llm.provider_override`. Either missing is never a failure: the strong lane falls back on « officecraft », the override on `unsupported`.
    plan_task = False
    try:
        ctx.register_auxiliary_task("officecraft_plan", display_name="Officecraft - plans",
                                    description="Officecraft long drafts: campaign plans and card instructions (follows the Officecraft line by default).",
                                    inherit_from="officecraft")
        plan_task = True
    except Exception:   # noqa: BLE001
        pass
    try:
        _module("llm").attach(llm_llm, task_registered=True, has_capability=getattr(ctx, "has_capability", None), plan_task=plan_task)
    except Exception:   # noqa: BLE001
        pass
    return None
