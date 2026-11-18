"""Security: a notification is TEXT for every platform Hermes sends to.

Hermes' sender reads instructions in the message it is given (``tools/send_message_tool.py``): ``MEDIA:<path>`` attaches
that local file (``gateway/platforms/base.py`` ``MEDIA_TAG_CLEANUP_RE``, case-insensitive), one HTML tag switches the
whole Telegram message to HTML (``tools/send_message_senders.py`` ``_telegram_format``) and ``[text](url)`` is a
MarkdownV2 link. A card title is written by any agent: it must reach the chat inert. The data folder
is 0700 even when ``PluginState`` created it first with the umask.
"""

import json
import os
import re
import stat

from test_notify import N, Store  # noqa: F401 - the notify module as the gateway loads it

# the patterns Hermes reads, copied from the files named above (CI has no Hermes)
MEDIA = re.compile(r"""[`"'*_]{0,3}MEDIA:\s*""", re.IGNORECASE)
HTML = re.compile(r"<[a-zA-Z/][^>]*>")
MD_LINK = re.compile(r"\[[^\]]*\]\([^)]*\)")


def _message(title, lang="fr"):
    fact = {"type": "decision", "state": "blocked", "board": "alpha", "task": "t_0123abcd", "title": title, "agent": "backend"}
    return N.format_message([fact], lang)


def _body(message):
    """The fact line without the plugin's own ``[board]`` marker."""
    return message.split("\n", 1)[1].replace("[alpha]", "")


def test_media_directive_in_a_title_attaches_nothing():
    for title in ("MEDIA:/home/x/notes.txt", "see media:/home/x/a.pdf now", "MEDIA: /etc/hosts.txt", "**MEDIA:~/x.png"):
        msg = _message(title)
        assert not MEDIA.search(msg), msg


def test_html_tag_in_a_title_never_switches_the_message_to_html():
    for title in ('<a href="https://evil.invalid">open</a>', "<b>x</b>", "</>", "<tg-spoiler>x</tg-spoiler>"):
        msg = _message(title)
        assert not HTML.search(msg), msg


def test_markdown_link_in_a_title_is_not_a_link():
    for title in ("[open](https://evil.invalid/x)", "a [b](tg://user?id=1) c", "[[as_document]]"):
        body = _body(_message(title))
        assert not MD_LINK.search(body) and "[[" not in body, body


def test_cron_name_and_plain_title_stay_readable():
    assert "Fix the bug 42" in _message("Fix the bug 42")
    cron = N.format_message([{"type": "cron", "state": "cron_failed", "title": "MEDIA:/x/y.txt nightly", "agent": "backend"}], "en")
    assert not MEDIA.search(cron) and "nightly" in cron


class DirStore(Store):
    def __init__(self, folder):
        super().__init__()
        self.data_dir = folder


def test_data_folder_made_private_when_created_wide(tmp_path):
    folder = tmp_path / "plugin-data"
    folder.mkdir(mode=0o775)
    os.chmod(folder, 0o775)
    N.save_settings({"types": {}}, DirStore(folder))
    assert stat.S_IMODE(folder.stat().st_mode) == 0o700
    os.chmod(folder, 0o775)
    N.audit.append({"id": "x", "verb": "comment"}, folder)
    assert stat.S_IMODE(folder.stat().st_mode) == 0o700
    assert json.loads((folder / "audit.jsonl").read_text())["verb"] == "comment"
