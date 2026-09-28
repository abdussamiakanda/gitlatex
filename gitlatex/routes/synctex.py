"""SyncTeX: jumping between an editor line and its spot in the compiled PDF."""

import os

from flask import Blueprint, jsonify

from gitlatex import state
from gitlatex.http import _json
from gitlatex.services.paths import resolve_repo_path
from gitlatex.services.synctex import forward_search, inverse_search

bp = Blueprint("synctex", __name__)


def _repo_relative(value, ext):
    """A repo-relative path with the given extension that stays inside the repo, or None."""
    rel = (value or "").strip().replace("\\", "/").lstrip("/")
    if not rel.lower().endswith(ext):
        return None
    full = resolve_repo_path(rel)
    if not full:
        return None
    return os.path.relpath(full, state.current_repo_path).replace("\\", "/")


def _lookup(fn, *args):
    try:
        return fn(state.current_repo_path, *args), None
    except (LookupError, FileNotFoundError) as e:
        return None, (jsonify(error=str(e)), 400)
    except Exception as e:
        return None, (jsonify(error=str(e)), 500)


@bp.route("/synctex/forward", methods=["POST"])
def synctex_forward():
    if not state.current_repo_path:
        return jsonify(error="No repository selected"), 400
    data = _json()
    pdf = _repo_relative(data.get("pdf"), ".pdf")
    source = _repo_relative(data.get("file"), ".tex")
    if not pdf or not source:
        return jsonify(error="Missing or invalid pdf/file path"), 400
    try:
        line = max(int(data.get("line") or 1), 1)
        column = max(int(data.get("column") or 0), 0)
    except (TypeError, ValueError):
        return jsonify(error="Invalid line/column"), 400
    boxes, err = _lookup(forward_search, pdf, source, line, column)
    if err:
        return err
    if not boxes:
        return jsonify(error="No PDF location for %s:%d. Recompile if you changed the file." % (source, line)), 404
    return jsonify(boxes=boxes)


@bp.route("/synctex/inverse", methods=["POST"])
def synctex_inverse():
    if not state.current_repo_path:
        return jsonify(error="No repository selected"), 400
    data = _json()
    pdf = _repo_relative(data.get("pdf"), ".pdf")
    if not pdf:
        return jsonify(error="Missing or invalid pdf path"), 400
    try:
        page = int(data.get("page"))
        x = float(data.get("x"))
        y = float(data.get("y"))
    except (TypeError, ValueError):
        return jsonify(error="Invalid page/x/y"), 400
    if page < 1:
        return jsonify(error="Invalid page"), 400
    result, err = _lookup(inverse_search, pdf, page, x, y)
    if err:
        return err
    if not result:
        return jsonify(error="No source line in this project for that spot."), 404
    return jsonify(**result)
