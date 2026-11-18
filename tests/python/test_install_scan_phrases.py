"""Hermes scans a plugin tree at install time and refuses a "dangerous" verdict even with
--force (hermes_cli/plugins_cmd.py:_scan_plugin_tree). A single critical injection phrase in any
shipped file is enough (tools/skills_guard.py, pattern prompt_injection_ignore). A doc
quoting a test injection would make the plugin uninstallable. Patterns copied from Hermes 2bd378ed1b."""
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CRITICAL = {
    "prompt_injection_ignore": r"ignore\s+(?:\w+\s+)*(previous|all|above|prior)\s+instructions",
    "sys_prompt_override": r"system\s+(?:\w+\s+)*prompt\s+(?:\w+\s+)*override",
}


def test_no_shipped_file_carries_a_critical_injection_phrase():
    files = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    hits = []
    for name in files:  # tests/ ships too (the installed copy holds the whole tree)
        try:
            text = (ROOT / name).read_text(encoding="utf-8")
        except (UnicodeDecodeError, IsADirectoryError, FileNotFoundError):
            continue
        for no, line in enumerate(text.splitlines(), 1):
            for pid, rx in CRITICAL.items():
                if re.search(rx, line, re.IGNORECASE):
                    hits.append(f"{name}:{no} {pid}")
    assert hits == []
