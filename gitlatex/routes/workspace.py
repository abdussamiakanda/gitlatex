"""The file API behind the editor UI in web/.

The editor keeps the whole project in memory and writes changes back through
these endpoints, so the folder on disk (and therefore Git) stays the single
source of truth. Every path goes through resolve_repo_path, so nothing here
can reach outside the open project.

    POST /api/project/open    select a project and return every file in it
    POST /api/project/create  create a project folder from a set of files
    POST /api/project/rename  rename a project folder
    POST /api/fs/write        write one file (text or base64)
    POST /api/fs/mkdir        create a folder (existing is fine)
    POST /api/fs/delete       delete a file or folder (missing is fine)
    POST /api/fs/move         rename or move a file or folder
"""

import base64
import os
import re
import shutil

from flask import Blueprint, jsonify

from gitlatex import state
from gitlatex.http import _json
from gitlatex.services import comments
from gitlatex.services.git_backend import Repo
from gitlatex.services.paths import resolve_repo_path

bp = Blueprint("workspace", __name__)

# Never shipped to the editor: Git internals, review comments (the review API
# owns those) and SyncTeX data, which the editor reads from the compile result.
HIDDEN_NAMES = (".git", ".gitlatex")
HIDDEN_SUFFIXES = (".synctex.gz", ".synctex", ".synctex(busy)")

# Files above this size are listed but not loaded, so one stray video cannot
# stall opening a project.
MAX_LOAD_BYTES = 25 * 1024 * 1024


def _no_project():
    return jsonify(error="No project open"), 400


def _rel(full):
    return os.path.relpath(full, state.current_repo_path).replace("\\", "/")


def _encode(raw):
    """Text travels as a string, anything else as base64 (NUL or bad UTF-8)."""
    if b"\0" not in raw[:8192]:
        try:
            return {"text": raw.decode("utf-8")}
        except UnicodeDecodeError:
            pass
    return {"base64": base64.b64encode(raw).decode("ascii")}


def _decode(data):
    """Bytes from a {text} or {base64} payload, or None when neither is present."""
    if isinstance(data.get("text"), str):
        return data["text"].encode("utf-8")
    if isinstance(data.get("base64"), str):
        return base64.b64decode(data["base64"])
    return None


def _read_project(root):
    files, folders = [], []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in HIDDEN_NAMES)
        rel_dir = os.path.relpath(dirpath, root).replace("\\", "/")
        if rel_dir != ".":
            folders.append(rel_dir)
        for name in sorted(filenames):
            if name.lower().endswith(HIDDEN_SUFFIXES):
                continue
            full = os.path.join(dirpath, name)
            rel = name if rel_dir == "." else rel_dir + "/" + name
            try:
                size = os.path.getsize(full)
                if size > MAX_LOAD_BYTES:
                    files.append({"path": rel, "size": size, "omitted": True})
                    continue
                with open(full, "rb") as f:
                    entry = _encode(f.read())
            except OSError:
                continue
            entry["path"] = rel
            files.append(entry)
    return files, folders


def _safe_name(raw):
    name = re.sub(r"\s+", "-", re.sub(r'[/\\:*?"<>|]', "-", (raw or "").strip())).strip(".")
    return name or "untitled"


def _project_dir(name):
    """Absolute folder of a project by name, or None if the name is unsafe."""
    if not isinstance(name, str) or not name.strip():
        return None
    name = name.strip()
    if name in (".", "..") or re.search(r'[/\\:*?"<>|]', name):
        return None
    return os.path.join(state.BASE_DIR, name)


@bp.route("/api/project/open", methods=["POST"])
def open_project():
    full = _project_dir(_json().get("name"))
    if not full or not os.path.isdir(full):
        return jsonify(error="Project not found"), 404
    state.current_repo_path = full
    files, folders = _read_project(full)
    has_git = os.path.isdir(os.path.join(full, ".git"))
    print("Opened project:", os.path.basename(full))
    return jsonify(name=os.path.basename(full), hasGit=has_git, files=files, folders=folders)


@bp.route("/api/project/create", methods=["POST"])
def create_project():
    data = _json()
    name = _safe_name(data.get("name"))
    full = os.path.join(state.BASE_DIR, name)
    if os.path.exists(full):
        return jsonify(error='A project named "%s" already exists' % name), 400
    files = data.get("files") if isinstance(data.get("files"), list) else []
    try:
        os.makedirs(full)
        state.current_repo_path = full
        for item in files:
            target = resolve_repo_path(item.get("path"))
            body = _decode(item)
            if not target or body is None:
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "wb") as f:
                f.write(body)
        if data.get("git") and Repo is not None:
            Repo.init(full)
        print("Created project:", name)
        return jsonify(success=True, name=name)
    except Exception as e:
        return jsonify(error=str(e)), 500


@bp.route("/api/project/rename", methods=["POST"])
def rename_project():
    data = _json()
    src = _project_dir(data.get("from"))
    if not src or not os.path.isdir(src):
        return jsonify(error="Project not found"), 404
    name = _safe_name(data.get("to"))
    dst = os.path.join(state.BASE_DIR, name)
    if os.path.exists(dst) and os.path.normcase(dst) != os.path.normcase(src):
        return jsonify(error='A project named "%s" already exists' % name), 400
    was_current = state.current_repo_path and os.path.normcase(state.current_repo_path) == os.path.normcase(src)
    try:
        os.rename(src, dst)
    except OSError as e:
        return jsonify(error=str(e)), 500
    if was_current:
        state.current_repo_path = dst
    return jsonify(success=True, name=name)


@bp.route("/api/fs/write", methods=["POST"])
def write_file():
    if not state.current_repo_path:
        return _no_project()
    data = _json()
    full = resolve_repo_path(data.get("path"))
    body = _decode(data)
    if not full or body is None:
        return jsonify(error="Invalid path or content"), 400
    try:
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "wb") as f:
            f.write(body)
        return jsonify(success=True, path=_rel(full))
    except OSError as e:
        return jsonify(error=str(e)), 500


@bp.route("/api/fs/mkdir", methods=["POST"])
def make_dir():
    if not state.current_repo_path:
        return _no_project()
    full = resolve_repo_path(_json().get("path"))
    if not full:
        return jsonify(error="Invalid path"), 400
    if os.path.isfile(full):
        return jsonify(error="A file with that name already exists"), 400
    try:
        os.makedirs(full, exist_ok=True)
        return jsonify(success=True, path=_rel(full))
    except OSError as e:
        return jsonify(error=str(e)), 500


@bp.route("/api/fs/delete", methods=["POST"])
def delete_path():
    if not state.current_repo_path:
        return _no_project()
    rel = _json().get("path")
    full = resolve_repo_path(rel)
    if not full:
        return jsonify(error="Invalid path"), 400
    try:
        if os.path.isdir(full):
            shutil.rmtree(full)
        elif os.path.exists(full):
            os.unlink(full)
        comments.drop_file(state.current_repo_path, _rel(full))
        return jsonify(success=True)
    except OSError as e:
        return jsonify(error=str(e)), 500


@bp.route("/api/fs/move", methods=["POST"])
def move_path():
    if not state.current_repo_path:
        return _no_project()
    data = _json()
    src = resolve_repo_path(data.get("from"))
    dst = resolve_repo_path(data.get("to"))
    if not src or not dst:
        return jsonify(error="Invalid path"), 400
    if not os.path.exists(src):
        return jsonify(error="Source not found"), 404
    if os.path.normcase(src) == os.path.normcase(dst):
        return jsonify(success=True)
    if os.path.isdir(src) and os.path.normcase(dst).startswith(os.path.normcase(src) + os.sep):
        return jsonify(error="Cannot move a folder into itself"), 400
    # A case-only rename on a case-insensitive disk "exists" but is the same file.
    if os.path.exists(dst) and os.path.normcase(os.path.realpath(src)) != os.path.normcase(os.path.realpath(dst)):
        return jsonify(error="Destination already exists"), 400
    try:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.move(src, dst)
        comments.move_file(state.current_repo_path, _rel(src), _rel(dst))
        return jsonify(success=True, path=_rel(dst))
    except OSError as e:
        return jsonify(error=str(e)), 500
