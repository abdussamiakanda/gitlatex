"""Review comments on lines of project files (the review panel)."""

from flask import Blueprint, jsonify, request

from gitlatex import state
from gitlatex.http import _json
from gitlatex.services import comments

bp = Blueprint("review", __name__)


def _no_repo():
    return jsonify(error="No repository selected"), 400


def _run(fn):
    """Call a comments service function and shape errors as JSON."""
    try:
        return fn()
    except KeyError:
        return jsonify(error="Comment thread not found"), 404
    except ValueError as e:
        return jsonify(error=str(e)), 400
    except Exception as e:
        return jsonify(error=str(e)), 500


@bp.route("/review/me")
def review_me():
    if not state.current_repo_path:
        return _no_repo()
    return jsonify(user=comments.current_user(state.current_repo_path))


@bp.route("/review/threads")
def review_threads():
    if not state.current_repo_path:
        return _no_repo()
    file = request.args.get("file")
    return _run(lambda: jsonify(
        threads=comments.list_threads(state.current_repo_path, file),
    ))


@bp.route("/review/threads", methods=["POST"])
def review_create():
    if not state.current_repo_path:
        return _no_repo()
    data = _json()
    return _run(lambda: jsonify(thread=comments.create_thread(
        state.current_repo_path, data.get("file"), data.get("range"),
        data.get("quote"), data.get("text"),
    )))


@bp.route("/review/threads/<thread_id>/reply", methods=["POST"])
def review_reply(thread_id):
    if not state.current_repo_path:
        return _no_repo()
    data = _json()
    return _run(lambda: jsonify(thread=comments.reply(
        state.current_repo_path, thread_id, data.get("text"),
    )))


@bp.route("/review/threads/<thread_id>/resolve", methods=["POST"])
def review_resolve(thread_id):
    if not state.current_repo_path:
        return _no_repo()
    data = _json()
    return _run(lambda: jsonify(thread=comments.set_resolved(
        state.current_repo_path, thread_id, data.get("resolved", True),
    )))


@bp.route("/review/threads/<thread_id>/delete", methods=["POST"])
def review_delete(thread_id):
    if not state.current_repo_path:
        return _no_repo()

    def run():
        comments.delete_thread(state.current_repo_path, thread_id)
        return jsonify(success=True)
    return _run(run)


@bp.route("/review/threads/<thread_id>/messages/<message_id>/delete", methods=["POST"])
def review_delete_message(thread_id, message_id):
    if not state.current_repo_path:
        return _no_repo()
    return _run(lambda: jsonify(thread=comments.delete_message(
        state.current_repo_path, thread_id, message_id,
    )))


@bp.route("/review/anchors", methods=["POST"])
def review_anchors():
    if not state.current_repo_path:
        return _no_repo()
    data = _json()
    return _run(lambda: jsonify(changed=comments.update_anchors(
        state.current_repo_path, data.get("anchors"),
    )))
