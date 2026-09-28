"""The user's own editor snippets."""

from flask import Blueprint, jsonify

from gitlatex.http import _json
from gitlatex.services import snippets

bp = Blueprint("snippets", __name__)


@bp.route("/snippets", methods=["GET"])
def list_snippets():
    return jsonify(snippets=snippets.load_snippets())


@bp.route("/snippets", methods=["PUT", "POST"])
def save_snippets():
    """Replaces the whole list, so the editor never has to merge."""
    saved, error = snippets.save_snippets(_json().get("snippets"))
    if error:
        return jsonify(error=error), 400
    return jsonify(success=True, snippets=saved)
