"""Shared GitPython plumbing for the git routes.

_open_repo returns either an open repo or a ready-made error response, which
keeps the "no project / no GitPython / no commits" checks out of every route.
"""

from flask import jsonify

from gitlatex import state
from gitlatex.services.git_backend import GitCommandError, Repo


def _open_repo():
    """Returns (repo, error_response). Caller must close the repo."""
    if not state.current_repo_path:
        return None, (jsonify(error="No repository selected"), 400)
    if Repo is None:
        return None, (jsonify(error="GitPython not installed"), 500)
    try:
        repo = Repo(state.current_repo_path)
    except Exception as e:
        return None, (jsonify(error=str(e)), 500)
    if not repo.head.is_valid():
        return None, (jsonify(error="This project has no commits yet."), 400)
    return repo, None


def _close_repo(repo):
    if repo is not None and getattr(repo, "close", None):
        try:
            repo.close()
        except Exception:
            pass


def _blob_text(commit, path):
    """Text of `path` at `commit`, or None if absent. ('', True) marks binary."""
    try:
        blob = commit.tree / path
    except KeyError:
        return None, False
    data = blob.data_stream.read()
    if b"\0" in data[:8000]:
        return "", True
    return data.decode("utf-8", errors="replace"), False


def _numstat(repo, rev_a, rev_b):
    """{path: (insertions, deletions)} between two revisions."""
    out = {}
    try:
        raw = repo.git.diff("--numstat", "-M", rev_a, rev_b)
    except GitCommandError:
        return out
    for line in raw.splitlines():
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        add, rem, path = parts
        # "-" marks a binary file in numstat output.
        out[path] = (0 if add == "-" else int(add), 0 if rem == "-" else int(rem))
    return out
