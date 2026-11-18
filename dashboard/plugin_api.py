"""Mount the bundled ``hermes_officecraft`` package's router.

Loaded by file path under a private module name so it never depends on the
name the agent loader gives this plugin.
"""

import importlib
import importlib.util
import sys
from pathlib import Path

_PACKAGE = Path(__file__).resolve().parents[1] / "hermes_officecraft"
_NAME = "_officecraft_http"

if _NAME not in sys.modules:
    _spec = importlib.util.spec_from_file_location(
        _NAME, _PACKAGE / "__init__.py", submodule_search_locations=[str(_PACKAGE)]
    )
    if _spec is None or _spec.loader is None:
        raise ImportError(f"cannot load {_PACKAGE}")
    _module = importlib.util.module_from_spec(_spec)
    sys.modules[_NAME] = _module
    _spec.loader.exec_module(_module)

router = importlib.import_module(_NAME + ".api").router
