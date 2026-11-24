"""The names a board carries (assignee, pinned model and provider) are drawn as text: cleaned and bounded like a title."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from hermes_officecraft import snapshot  # noqa: E402


@pytest.mark.parametrize("raw,served", [("alpha", "alpha"), ("  beta ", "beta"), ("", None), (None, None), (7, None), ("\u202egnp.exe", "gnp.exe"),
                                        ("a\nb", "ab"), ("\u200b", None), ("example/model-large", "example/model-large")])
def test_a_name_is_printable_text_or_nothing(raw, served):
    assert snapshot._name(raw) == served


def test_a_name_is_bounded():
    assert len(snapshot._name("m" * 5000)) == snapshot.NAME_MAX
