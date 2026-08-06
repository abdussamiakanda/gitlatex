"""Version, links and the PyPI update check shown on the Settings page."""

import os
import time

from flask import Blueprint, jsonify, request

from gitlatex.services.updates import (
    GITLATEX_VERSION,
    PYPI_PROJECT_URL,
    UPDATE_CHECK_TTL,
    UPGRADE_COMMAND,
    _fetch_latest_version,
    _is_newer,
    _update_lock,
    _update_state,
)

bp = Blueprint("system", __name__)


@bp.route("/api/info")
def api_info():
    """Technical info for the Settings page."""
    return jsonify(
        version=GITLATEX_VERSION,
        repository="https://github.com/abdussamiakanda/gitlatex",
        pypi="https://pypi.org/project/gitlatex",
    )


@bp.route("/api/update-check")
def api_update_check():
    """Compare the running version against the newest release on PyPI.

    Result is cached so opening Settings repeatedly does not hammer PyPI. Any
    network failure is reported as `error` and never breaks the page.
    """
    if os.environ.get("GITLATEX_NO_UPDATE_CHECK"):
        return jsonify(current=GITLATEX_VERSION, latest=None, updateAvailable=False, disabled=True)

    force = request.args.get("force") in ("1", "true", "yes")
    now = time.time()
    with _update_lock:
        if not force and (now - _update_state["checked_at"]) < UPDATE_CHECK_TTL:
            latest, error = _update_state["latest"], _update_state["error"]
        else:
            latest, error = None, None
            try:
                latest = _fetch_latest_version()
            except Exception as e:
                error = str(e) or e.__class__.__name__
                print("Update check failed:", error)
            _update_state.update(checked_at=now, latest=latest, error=error)

    return jsonify(
        current=GITLATEX_VERSION,
        latest=latest,
        updateAvailable=_is_newer(latest, GITLATEX_VERSION),
        pypi=PYPI_PROJECT_URL,
        command=UPGRADE_COMMAND,
        error=error,
    )
