"""Source control API for the editor's Source control panel (services/scm.py).

    GET  /api/scm/status            branch, upstream, ahead/behind, staged/changes/conflicts
    POST /api/scm/stage             {paths?}   stage files (all when omitted)
    POST /api/scm/unstage           {paths?}
    POST /api/scm/discard           {paths}    drop working-tree changes
    POST /api/scm/resolve           {path, side: current|incoming}
    POST /api/scm/mark-resolved     {path}
    POST /api/scm/abort             abort the merge / rebase in progress
    POST /api/scm/commit            {message}
    POST /api/scm/pull | push | sync | fetch
    GET  /api/scm/branches          POST /api/scm/checkout {name, create?}
    GET  /api/scm/publish-options   POST /api/scm/publish {url? | name?, private?}
    GET  /api/scm/diff?path=&staged=1

Pull and push rebase like /pull and /push (services/sync.py), but a real
conflict is left in the files for the editor to resolve. Everything that
changes files holds state.project_lock, like the editor's writes.
"""

import functools

from flask import Blueprint, jsonify, request

from gitlatex import state
from gitlatex.http import _json, with_project_lock
from gitlatex.services import scm
from gitlatex.services.git_backend import GitCommandError, Repo
from gitlatex.services.gitrepo import _close_repo

bp = Blueprint("scm", __name__)


def _git_error(e):
    """The useful part of a failed git command: its stderr, without GitPython's framing."""
    text = (getattr(e, "stderr", "") or str(e)).strip()
    if text.startswith("stderr:"):
        text = text[len("stderr:"):]
    return text.strip().strip("'").strip() or str(e)


def with_repo(view):
    """Open the current project's repository, pass it in, and turn failures into JSON errors."""

    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        if not state.current_repo_path:
            return jsonify(error="No project open"), 400
        if Repo is None:
            return jsonify(error="GitPython not installed"), 500
        try:
            repo = Repo(state.current_repo_path)
        except Exception:
            return jsonify(error="This project is not a Git repository."), 400
        try:
            return view(repo, *args, **kwargs)
        except ValueError as e:
            return jsonify(error=str(e)), 400
        except GitCommandError as e:
            return jsonify(error=_git_error(e)), 500
        finally:
            _close_repo(repo)

    return wrapper


def _paths():
    paths = _json().get("paths")
    return [p for p in paths if isinstance(p, str) and p] if isinstance(paths, list) else None


def _ok(repo, **extra):
    """Every change returns the fresh status, so the panel redraws from one response."""
    return jsonify(success=True, status=scm.status(repo), **extra)


@bp.route("/api/scm/status")
@with_repo
def get_status(repo):
    return jsonify(scm.status(repo))


@bp.route("/api/scm/stage", methods=["POST"])
@with_project_lock
@with_repo
def stage(repo):
    scm.stage(repo, _paths())
    return _ok(repo)


@bp.route("/api/scm/unstage", methods=["POST"])
@with_project_lock
@with_repo
def unstage(repo):
    scm.unstage(repo, _paths(), has_commits=scm.status(repo)["hasCommits"])
    return _ok(repo)


@bp.route("/api/scm/discard", methods=["POST"])
@with_project_lock
@with_repo
def discard(repo):
    paths = _paths()
    if not paths:
        raise ValueError("No files given")
    scm.discard(repo, paths)
    return _ok(repo)


@bp.route("/api/scm/resolve", methods=["POST"])
@with_project_lock
@with_repo
def resolve(repo):
    data = _json()
    side = data.get("side")
    if side not in ("current", "incoming") or not data.get("path"):
        raise ValueError("Give a path and side: current or incoming")
    scm.take_side(repo, data["path"], side)
    return _ok(repo)


@bp.route("/api/scm/mark-resolved", methods=["POST"])
@with_project_lock
@with_repo
def mark_resolved(repo):
    path = _json().get("path")
    if not path:
        raise ValueError("No path given")
    scm.mark_resolved(repo, path)
    return _ok(repo)


@bp.route("/api/scm/abort", methods=["POST"])
@with_project_lock
@with_repo
def abort(repo):
    scm.abort(repo)
    return _ok(repo)


@bp.route("/api/scm/commit", methods=["POST"])
@with_project_lock
@with_repo
def commit(repo):
    return _ok(repo, **scm.commit(repo, (_json().get("message") or "").strip()))


@bp.route("/api/scm/pull", methods=["POST"])
@with_project_lock
@with_repo
def pull(repo):
    return _ok(repo, **scm.pull(repo))


@bp.route("/api/scm/push", methods=["POST"])
@with_project_lock
@with_repo
def push(repo):
    return _ok(repo, **scm.push(repo))


@bp.route("/api/scm/sync", methods=["POST"])
@with_project_lock
@with_repo
def sync(repo):
    """Pull, then push if the pull left nothing to resolve (VS Code's Sync Changes)."""
    result = scm.pull(repo)
    if not result["conflicts"] and scm.status(repo)["ahead"]:
        pushed = scm.push(repo)
        result = {**pushed, "cleared": result["cleared"] + pushed["cleared"]}
    return _ok(repo, **result)


@bp.route("/api/scm/fetch", methods=["POST"])
@with_repo
def fetch(repo):
    if repo.remotes:
        repo.git.fetch("--all", "--prune")
    return _ok(repo)


@bp.route("/api/scm/branches")
@with_repo
def branches(repo):
    return jsonify(scm.branches(repo))


@bp.route("/api/scm/checkout", methods=["POST"])
@with_project_lock
@with_repo
def checkout(repo):
    data = _json()
    name = (data.get("name") or "").strip()
    if not name:
        raise ValueError("No branch name given")
    scm.checkout(repo, name, create=bool(data.get("create")))
    return _ok(repo)


@bp.route("/api/scm/publish-options")
def publish_options():
    return jsonify(gh=scm.gh_ready())


@bp.route("/api/scm/publish", methods=["POST"])
@with_project_lock
@with_repo
def publish(repo):
    data = _json()
    url = (data.get("url") or "").strip() or None
    output = scm.publish(repo, url=url, name=data.get("name"), private=data.get("private", True) is not False)
    return _ok(repo, output=output)


@bp.route("/api/scm/diff")
@with_repo
def diff(repo):
    path = (request.args.get("path") or "").replace("\\", "/")
    if not path:
        raise ValueError("No path given")
    return jsonify(scm.diff(repo, path, staged=request.args.get("staged") in ("1", "true")))
