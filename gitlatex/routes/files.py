"""Reading and writing files inside the selected project."""

import base64
import os
import re
import shutil

from flask import Blueprint, jsonify, request, send_file

from gitlatex import state
from gitlatex.http import MIME_TYPES, REPO_FILE_MAX_SIZE, _json
from gitlatex.services.paths import flatten_file_tree, read_dir_recursive, resolve_repo_path

bp = Blueprint("files", __name__)


@bp.route("/files")
def get_files():
    if not state.current_repo_path:
        return jsonify([])
    return jsonify(read_dir_recursive(state.current_repo_path))


@bp.route("/repo-files-content")
def repo_files_content():
    if not state.current_repo_path:
        return jsonify(error="No repository selected"), 400

    def read_dir(dir_path):
        out = []
        for file in os.listdir(dir_path):
            full = os.path.join(dir_path, file)
            if file == ".git":
                continue
            if os.path.isdir(full):
                out.append({"name": file, "type": "folder", "children": read_dir(full)})
            else:
                out.append({"name": file, "type": "file"})
        return out

    tree = read_dir(state.current_repo_path)
    paths = flatten_file_tree(tree)
    files = []
    for rel in paths:
        full_path = os.path.join(state.current_repo_path, rel)
        try:
            stat = os.stat(full_path)
            if not os.path.isfile(full_path) or stat.st_size > REPO_FILE_MAX_SIZE:
                continue
            ext = os.path.splitext(full_path)[1].lower()
            is_binary = ext in MIME_TYPES or re.search(r"\.(pdf|zip|exe|dll)$", rel, re.I)
            rel_slash = rel.replace("\\", "/")
            if is_binary:
                with open(full_path, "rb") as f:
                    content = base64.b64encode(f.read()).decode("ascii")
                files.append({"path": rel_slash, "base64": content})
            else:
                with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                files.append({"path": rel_slash, "content": content})
        except (OSError, UnicodeDecodeError):
            pass
    return jsonify(files=files)


@bp.route("/file")
def get_file():
    if not state.current_repo_path:
        return jsonify(error="No repository selected"), 400
    file_path = os.path.join(state.current_repo_path, request.args.get("path", ""))
    ext = os.path.splitext(file_path)[1].lower()
    if ext in MIME_TYPES:
        return jsonify(error="Use file-raw for binary/viewable files"), 415
    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()
    return jsonify(content=content)


@bp.route("/save", methods=["POST"])
def save_file():
    if not state.current_repo_path:
        return jsonify(error="No repository selected"), 400
    data = _json()
    file_path = os.path.join(state.current_repo_path, data.get("path", ""))
    content = data.get("content", "")
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)
    print("Saved", data.get("path"))
    return jsonify(success=True)


@bp.route("/file-raw")
def file_raw():
    if not state.current_repo_path:
        return "No repository selected", 400
    raw_path = (request.args.get("path") or "").strip().lstrip("/\\")
    if not raw_path:
        return "Missing path", 400
    full_path = os.path.normpath(os.path.join(state.current_repo_path, raw_path))
    repo_root = os.path.realpath(state.current_repo_path)
    if os.path.realpath(full_path) != repo_root and not os.path.realpath(full_path).startswith(repo_root + os.sep):
        return "File not found", 404
    if not os.path.isfile(full_path):
        return "File not found", 404
    ext = os.path.splitext(full_path)[1].lower()
    mime = MIME_TYPES.get(ext)
    return send_file(full_path, mimetype=mime or "application/octet-stream")


@bp.route("/create-file", methods=["POST"])
def create_file():
    if not state.current_repo_path:
        return jsonify(error="No repository selected"), 400
    data = _json()
    relative_path = (data.get("path") or data.get("name") or "").strip()
    if not relative_path:
        return jsonify(error="Missing path"), 400
    full_path = resolve_repo_path(relative_path)
    if not full_path:
        return jsonify(error="Invalid path"), 400
    try:
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        content = data.get("content") if data.get("content") is not None else ""
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)
        print("Created file", relative_path)
        return jsonify(success=True, path=relative_path)
    except Exception as e:
        return jsonify(error=str(e)), 500


@bp.route("/create-folder", methods=["POST"])
def create_folder():
    if not state.current_repo_path:
        return jsonify(error="No repository selected"), 400
    data = _json()
    relative_path = (data.get("path") or data.get("name") or "").strip()
    if not relative_path:
        return jsonify(error="Missing path"), 400
    full_path = resolve_repo_path(relative_path)
    if not full_path:
        return jsonify(error="Invalid path"), 400
    try:
        if os.path.exists(full_path):
            return jsonify(error="Path already exists"), 400
        os.makedirs(full_path, exist_ok=True)
        print("Created folder", relative_path)
        return jsonify(success=True, path=relative_path)
    except Exception as e:
        return jsonify(error=str(e)), 500


@bp.route("/move", methods=["POST"])
def move_path():
    if not state.current_repo_path:
        return jsonify(error="No repository selected"), 400
    data = _json()
    from_rel = (data.get("from") or "").strip().lstrip("/\\")
    to_rel = (data.get("to") or "").strip().lstrip("/\\")
    if not from_rel or not to_rel:
        return jsonify(error="Missing from or to"), 400
    from_full = resolve_repo_path(from_rel)
    to_full = resolve_repo_path(to_rel)
    if not from_full or not to_full:
        return jsonify(error="Invalid path"), 400
    try:
        if not os.path.exists(from_full):
            return jsonify(error="Source not found"), 404
        from_stat = os.stat(from_full)
        from_name = os.path.basename(from_rel)
        if os.path.exists(to_full) and os.path.isdir(to_full):
            to_full = os.path.join(to_full, from_name)
        else:
            os.makedirs(os.path.dirname(to_full), exist_ok=True)
        if from_full == to_full:
            return jsonify(success=True)
        to_norm = os.path.normpath(to_full)
        from_norm = os.path.normpath(from_full)
        if os.path.isdir(from_full) and (to_norm == from_norm or to_norm.startswith(from_norm + os.sep)):
            return jsonify(error="Cannot move folder into itself or a descendant"), 400
        if os.path.exists(to_full):
            return jsonify(error="Destination already exists"), 400
        shutil.move(from_full, to_full)
        new_rel = os.path.relpath(to_full, state.current_repo_path).replace("\\", "/")
        return jsonify(success=True, path=new_rel)
    except Exception as e:
        return jsonify(error=str(e)), 500


@bp.route("/delete", methods=["POST"])
def delete_path():
    if not state.current_repo_path:
        return jsonify(error="No repository selected"), 400
    data = _json()
    relative_path = (data.get("path") or data.get("name") or "").strip()
    if not relative_path:
        return jsonify(error="Missing path"), 400
    full_path = resolve_repo_path(relative_path)
    if not full_path:
        return jsonify(error="Invalid path"), 400
    try:
        if not os.path.exists(full_path):
            return jsonify(error="Path not found"), 404
        if os.path.isdir(full_path):
            shutil.rmtree(full_path)
        else:
            os.unlink(full_path)
        print("Deleted", relative_path)
        return jsonify(success=True)
    except Exception as e:
        return jsonify(error=str(e)), 500


@bp.route("/upload", methods=["POST"])
def upload_files():
    if not state.current_repo_path:
        return jsonify(error="No repository selected"), 400
    data = _json()
    files = data.get("files")
    if not isinstance(files, list) or len(files) == 0:
        return jsonify(error="No files provided"), 400
    created = []
    try:
        for item in files:
            name = (item.get("name") or "").strip()
            if not name:
                continue
            full_path = resolve_repo_path(name)
            if not full_path:
                continue
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            content = item.get("content") or ""
            raw = base64.b64decode(content)
            with open(full_path, "wb") as f:
                f.write(raw)
            created.append(name)
        return jsonify(success=True, created=created)
    except Exception as e:
        return jsonify(error=str(e)), 500
