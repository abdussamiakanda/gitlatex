"""Checking PyPI for a newer gitlatex release.

The result is cached so opening Settings repeatedly does not hammer PyPI, and
any network failure is reported rather than raised.
"""

import json
import os
import re
import threading
import time
import urllib.request

try:
    from gitlatex import __version__ as GITLATEX_VERSION
except ImportError:
    GITLATEX_VERSION = "?"
PYPI_JSON_URL = "https://pypi.org/pypi/gitlatex/json"
PYPI_PROJECT_URL = "https://pypi.org/project/gitlatex/"
UPGRADE_COMMAND = "pip install --upgrade gitlatex"
UPDATE_CHECK_TTL = 6 * 60 * 60  # re-ask PyPI at most once every 6 hours
_update_state = {"checked_at": 0.0, "latest": None, "error": None}
_update_lock = threading.Lock()


def _version_tuple(value):
    """Loose PEP 440 ordering: 1.0.10 sorts above 1.0.9, suffixes ignored."""
    parts = []
    for chunk in re.split(r"[._-]+", (value or "").strip()):
        match = re.match(r"(\d+)", chunk)
        parts.append(int(match.group(1)) if match else 0)
    return tuple(parts) or (0,)


def _is_newer(latest, current):
    if not latest or not current or current == "?":
        return False
    a, b = _version_tuple(latest), _version_tuple(current)
    width = max(len(a), len(b))
    return a + (0,) * (width - len(a)) > b + (0,) * (width - len(b))


def _fetch_latest_version(timeout=4.0):
    req = urllib.request.Request(
        PYPI_JSON_URL,
        headers={"User-Agent": "gitlatex/" + str(GITLATEX_VERSION), "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return ((payload.get("info") or {}).get("version") or "").strip() or None
