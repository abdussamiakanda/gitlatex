"""Flask server for GitLaTeX IDE - mirrors the Node/Express API."""

import argparse
import base64
import datetime
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path


def _check_dependencies():
    """Exit with a clear message if required packages are not installed."""
    missing = []
    try:
        import flask  # noqa: F401
    except ImportError:
        missing.append("flask")
    try:
        import git  # noqa: F401
    except ImportError:
        missing.append("gitpython")
    if missing:
        print("Missing required packages:", ", ".join(missing))
        print("Install with:  pip install -e .")
        print("Or:           pip install flask gitpython")
        sys.exit(1)


_check_dependencies()

from flask import Flask, Response, jsonify, request, send_file

try:
    from git import Repo, NULL_TREE
    from git.exc import GitCommandError
    try:
        from git.util import rmtree as git_rmtree
    except (ImportError, AttributeError):
        git_rmtree = None
except ImportError:
    Repo = None
    git_rmtree = None
    GitCommandError = Exception
    NULL_TREE = None

try:
    from gitlatex import __version__ as GITLATEX_VERSION
except ImportError:
    GITLATEX_VERSION = "?"

ROOT_DIR = Path(__file__).resolve().parent


def _repos_base():
    return Path.cwd() / "repos"


def _public_dir():
    """Public assets dir next to server.py (used for index + static)."""
    return os.path.join(os.path.dirname(os.path.abspath(os.path.realpath(__file__))), "public")


def _static_path(relative_path):
    """Resolve path under public/; return None if outside or missing (security)."""
    public_dir = os.path.normpath(_public_dir())
    safe = relative_path.replace("\\", "/").lstrip("/")
    if ".." in safe:
        return None
    parts = [p for p in safe.split("/") if p]
    full = os.path.normpath(os.path.join(public_dir, *parts))
    try:
        common = os.path.commonpath([os.path.abspath(full), os.path.abspath(public_dir)])
        if os.path.normcase(common) != os.path.normcase(os.path.abspath(public_dir)):
            return None
    except (ValueError, OSError):
        return None
    return full if os.path.isfile(full) else None


def _json():
    """Request JSON body; default to empty dict."""
    return request.get_json(force=True, silent=True) or {}


app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50MB


# CORS: allow same-origin and cross-origin so compile/API work from any port or file://
@app.after_request
def add_cors(resp):
    origin = request.environ.get("HTTP_ORIGIN")
    if origin:
        resp.headers["Access-Control-Allow-Origin"] = origin
    else:
        resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return resp


@app.before_request
def log_request():
    if request.method == "OPTIONS":
        return "", 204
    p = request.path
    if p != "/" and not any(p.endswith(e) for e in STATIC_EXTENSIONS):
        print(f"  {request.method} {p}")


def _serve_index():
    index_path = os.path.join(_public_dir(), "index.html")
    if os.path.isfile(index_path):
        try:
            with open(index_path, "r", encoding="utf-8") as f:
                return Response(f.read(), mimetype="text/html")
        except OSError:
            pass
    return Response(
        "<!DOCTYPE html><html><body><h1>GitLaTeX</h1><p>Server OK. index.html not found.</p></body></html>",
        mimetype="text/html",
    )


@app.before_request
def serve_root():
    path = request.path.rstrip("/") or "/"
    if path == "/" and request.method == "GET":
        return _serve_index()


@app.route("/ping")
def ping():
    return "pong"


@app.route("/api/info")
def api_info():
    """Technical info for the Settings page."""
    return jsonify(
        version=GITLATEX_VERSION,
        repository="https://github.com/abdussamiakanda/gitlatex",
        pypi="https://pypi.org/project/gitlatex",
    )


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


@app.route("/api/update-check")
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


@app.route("/")
def index():
    return _serve_index()

BASE_DIR = None  # set at startup
current_repo_path = None
last_compile_error = None

MIME_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
}

REPO_FILE_MAX_SIZE = 5 * 1024 * 1024
STATIC_EXTENSIONS = frozenset({".css", ".js", ".html", ".ico", ".png", ".jpg", ".svg", ".woff", ".woff2"})
ASSET_EXTENSIONS = frozenset({".css", ".js", ".svg", ".ico", ".png", ".jpg", ".jpeg", ".json", ".woff", ".woff2"})


def count_files_in_dir(dir_path):
    count = 0
    try:
        for name in os.listdir(dir_path):
            if name == ".git":
                continue
            full = os.path.join(dir_path, name)
            if os.path.isdir(full):
                count += count_files_in_dir(full)
            else:
                count += 1
    except OSError:
        pass
    return count


def parse_owner_from_remote_url(url):
    if not url or not isinstance(url, str):
        return None
    u = url.strip()
    ssh_match = re.search(r"[:/](?:github\.com[/:])?([^/]+)/[^/]+(?:\.git)?$", u)
    if ssh_match:
        return ssh_match.group(1)
    https_match = re.search(r"github\.com[/]([^/]+)/[^/]+", u)
    if https_match:
        return https_match.group(1)
    generic = re.search(r"([^/]+)/[^/]+(?:\.git)?$", u)
    if generic:
        return generic.group(1)
    return None


def resolve_repo_path(relative_path):
    if not current_repo_path or relative_path is None:
        return None
    if not isinstance(relative_path, str):
        return None
    normalized = os.path.normpath(relative_path)
    normalized = re.sub(r"^(\.\.(/|\\|$))+", "", normalized).lstrip("/\\")
    if not normalized:
        return None
    full = os.path.abspath(os.path.join(current_repo_path, normalized))
    rel = os.path.relpath(full, current_repo_path)
    if rel.startswith("..") or os.path.isabs(rel):
        return None
    return full


def read_dir_recursive(dir_path):
    entries = os.listdir(dir_path)
    base = os.path.basename(dir_path)

    def has_tex_with_same_stem(base_name):
        lower = base_name.lower()
        for e in entries:
            full = os.path.join(dir_path, e)
            if not os.path.isfile(full):
                continue
            stem, ext = os.path.splitext(e)
            if stem.lower() == lower and ext.lower() == ".tex":
                return True
        return False

    result = []
    for file in entries:
        full = os.path.join(dir_path, file)
        if file == ".git":
            continue
        if os.path.isdir(full):
            result.append({"name": file, "type": "folder", "children": read_dir_recursive(full)})
        else:
            if file.lower().endswith(".pdf"):
                stem = os.path.splitext(file)[0]
                if has_tex_with_same_stem(stem):
                    continue
            result.append({"name": file, "type": "file"})
    return result


def flatten_file_tree(tree, prefix=""):
    out = []
    for node in tree:
        rel = os.path.join(prefix, node["name"]) if prefix else node["name"]
        if node.get("type") == "folder" and node.get("children") is not None:
            out.extend(flatten_file_tree(node["children"], rel))
        elif node.get("type") == "file":
            out.append(rel)
    return out


# ----- API routes -----

@app.route("/repos")
def list_repos():
    global BASE_DIR
    if not os.path.isdir(BASE_DIR):
        return jsonify(repos=[], current=None)
    entries = [
        name for name in os.listdir(BASE_DIR)
        if os.path.isdir(os.path.join(BASE_DIR, name))
    ]
    repos = []
    for name in entries:
        full = os.path.join(BASE_DIR, name)
        file_count = 0
        last_modified = None
        remote_url = None
        owner = None
        created_at = None
        created_by = None
        try:
            stat = os.stat(full)
            from datetime import datetime
            last_modified = datetime.fromtimestamp(stat.st_mtime).isoformat() + "Z"
            file_count = count_files_in_dir(full)
        except OSError:
            pass
        has_git = False
        git_dir = os.path.join(full, ".git")
        if os.path.isdir(git_dir) and Repo is not None:
            has_git = True
            try:
                repo = Repo(full)
                try:
                    origin = repo.remotes.origin
                    remote_url = next(origin.urls, None)
                    owner = parse_owner_from_remote_url(remote_url) if remote_url else None
                except (AttributeError, StopIteration):
                    pass
                try:
                    commits = list(repo.iter_commits(repo.head, reverse=True, max_count=1))
                    if commits:
                        c = commits[0]
                        created_at = c.committed_datetime.isoformat() + "Z" if c.committed_datetime else None
                        created_by = c.author.name if c.author else None
                except Exception:
                    pass
                finally:
                    if getattr(repo, "close", None):
                        try:
                            repo.close()
                        except Exception:
                            pass
            except Exception:
                pass
        repos.append({
            "name": name, "hasGit": has_git, "fileCount": file_count,
            "lastModified": last_modified, "remoteUrl": remote_url, "owner": owner,
            "createdAt": created_at, "createdBy": created_by,
        })
    current_name = os.path.basename(current_repo_path) if current_repo_path else None
    return jsonify(repos=repos, current=current_name)


@app.route("/delete-repo", methods=["POST"])
def delete_repo():
    global current_repo_path
    if not BASE_DIR or not os.path.isdir(BASE_DIR):
        return jsonify(error="Repos directory not available"), 500
    data = _json()
    name = (data.get("name") or "").strip().lstrip("/\\")
    if not name:
        return jsonify(error="Missing repo name"), 400
    if ".." in name or os.path.isabs(name):
        return jsonify(error="Invalid repo name"), 400
    full_path = os.path.join(BASE_DIR, name)
    try:
        if not os.path.exists(full_path):
            return jsonify(error="Repository not found"), 404
        if not os.path.isdir(full_path):
            return jsonify(error="Not a directory"), 400
        real_base = os.path.realpath(BASE_DIR)
        real_full = os.path.realpath(full_path)
        if real_full != real_base and not real_full.startswith(real_base + os.sep):
            return jsonify(error="Invalid repo name"), 400
        if current_repo_path and os.path.realpath(current_repo_path) == real_full:
            current_repo_path = None

        # GitPython's rmtree handles .git read-only files on Windows; use it when available.
        if git_rmtree is not None:
            try:
                git_rmtree(full_path)
                if not os.path.exists(full_path):
                    print("Deleted repo:", name)
                    return jsonify(success=True)
            except Exception as e:
                print("Delete repo (git_rmtree) failed:", name, e)

        # On Windows, try subprocess first (no handle inheritance). If folder is locked by another
        # process (Explorer, terminal, antivirus, etc.), subprocess will also fail.
        if sys.platform == "win32":
            result = subprocess.run(
                ["cmd", "/c", "rmdir", "/s", "/q", full_path],
                capture_output=True,
                timeout=60,
            )
            if result.returncode == 0 and not os.path.exists(full_path):
                print("Deleted repo:", name)
                return jsonify(success=True)
            err_text = (result.stderr or result.stdout or b"").decode("utf-8", errors="replace").strip()
            if result.returncode != 0:
                print("Delete repo (rmdir) failed:", name, err_text or result.returncode)
                if "being used by another process" in err_text:
                    return jsonify(
                        error="Folder is in use by another program. Close any Explorer window, terminal, or app that has this folder open, then try again."
                    ), 500

        def _rmtree_onerror(func, path, exc_info):
            try:
                if os.path.isdir(path):
                    os.chmod(path, stat.S_IRWXU)
                else:
                    os.chmod(path, stat.S_IWUSR | stat.S_IREAD)
            except OSError:
                pass
            func(path)

        shutil.rmtree(full_path, onerror=_rmtree_onerror)
        if os.path.exists(full_path):
            try:
                os.chmod(full_path, stat.S_IRWXU)
                os.rmdir(full_path)
            except OSError as e:
                print("Delete repo failed (root folder):", name, e)
                return jsonify(error=str(e)), 500
        print("Deleted repo:", name)
        return jsonify(success=True)
    except OSError as e:
        print("Delete repo failed:", name, e)
        if getattr(e, "winerror", None) == 32 or "being used by another process" in str(e):
            return jsonify(
                error="Folder is in use by another program. Close any Explorer window, terminal, or app that has this folder open, then try again."
            ), 500
        return jsonify(error=str(e)), 500
    except Exception as e:
        print("Delete repo error:", name, e)
        return jsonify(error=str(e)), 500


@app.route("/create-workspace", methods=["POST"])
def create_workspace():
    data = _json()
    raw = (data.get("name") or "").strip()
    if not raw:
        return jsonify(error="Missing name"), 400
    name = re.sub(r'[/\\:*?"<>|]', "-", raw)
    name = re.sub(r"\s+", "-", name) or "new-folder"
    full_path = os.path.join(BASE_DIR, name)
    try:
        if os.path.exists(full_path):
            return jsonify(error="A folder with that name already exists"), 400
        os.makedirs(full_path, exist_ok=True)
        print("Created workspace:", name)
        return jsonify(success=True, name=name)
    except Exception as e:
        return jsonify(error=str(e)), 500


@app.route("/select-repo", methods=["POST"])
def select_repo():
    global current_repo_path
    data = _json()
    name = data.get("name")
    if not name:
        return jsonify(error="Missing repo name"), 400
    repo_path = os.path.join(BASE_DIR, name)
    if not os.path.isdir(repo_path):
        return jsonify(error="Repository not found"), 404
    current_repo_path = repo_path
    git_dir = os.path.join(repo_path, ".git")
    has_git = os.path.isdir(git_dir)
    print("Selected repo:", name)
    return jsonify(success=True, hasGit=has_git)


@app.route("/clone", methods=["POST"])
def clone_repo():
    global current_repo_path
    data = _json()
    repo_url = data.get("repoUrl")
    if not repo_url:
        return jsonify(error="Missing repoUrl"), 400
    repo_name = repo_url.rstrip("/").split("/")[-1].replace(".git", "")
    repo_path = os.path.join(BASE_DIR, repo_name)
    print("Cloning", repo_url, "->", repo_name)
    if Repo is None:
        return jsonify(error="GitPython not installed"), 500
    try:
        Repo.clone_from(repo_url, repo_path)
        print("Cloned", repo_name)
        current_repo_path = repo_path
        return jsonify(success=True)
    except Exception as e:
        return jsonify(error=str(e)), 500


@app.route("/files")
def get_files():
    if not current_repo_path:
        return jsonify([])
    return jsonify(read_dir_recursive(current_repo_path))


@app.route("/repo-files-content")
def repo_files_content():
    if not current_repo_path:
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

    tree = read_dir(current_repo_path)
    paths = flatten_file_tree(tree)
    files = []
    for rel in paths:
        full_path = os.path.join(current_repo_path, rel)
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


@app.route("/file")
def get_file():
    if not current_repo_path:
        return jsonify(error="No repository selected"), 400
    file_path = os.path.join(current_repo_path, request.args.get("path", ""))
    ext = os.path.splitext(file_path)[1].lower()
    if ext in MIME_TYPES:
        return jsonify(error="Use file-raw for binary/viewable files"), 415
    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()
    return jsonify(content=content)


@app.route("/save", methods=["POST"])
def save_file():
    if not current_repo_path:
        return jsonify(error="No repository selected"), 400
    data = _json()
    file_path = os.path.join(current_repo_path, data.get("path", ""))
    content = data.get("content", "")
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)
    print("Saved", data.get("path"))
    return jsonify(success=True)


@app.route("/file-raw")
def file_raw():
    if not current_repo_path:
        return "No repository selected", 400
    raw_path = (request.args.get("path") or "").strip().lstrip("/\\")
    if not raw_path:
        return "Missing path", 400
    full_path = os.path.normpath(os.path.join(current_repo_path, raw_path))
    repo_root = os.path.realpath(current_repo_path)
    if os.path.realpath(full_path) != repo_root and not os.path.realpath(full_path).startswith(repo_root + os.sep):
        return "File not found", 404
    if not os.path.isfile(full_path):
        return "File not found", 404
    ext = os.path.splitext(full_path)[1].lower()
    mime = MIME_TYPES.get(ext)
    return send_file(full_path, mimetype=mime or "application/octet-stream")


@app.route("/create-file", methods=["POST"])
def create_file():
    if not current_repo_path:
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


@app.route("/create-folder", methods=["POST"])
def create_folder():
    if not current_repo_path:
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


@app.route("/move", methods=["POST"])
def move_path():
    if not current_repo_path:
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
        new_rel = os.path.relpath(to_full, current_repo_path).replace("\\", "/")
        return jsonify(success=True, path=new_rel)
    except Exception as e:
        return jsonify(error=str(e)), 500


@app.route("/delete", methods=["POST"])
def delete_path():
    if not current_repo_path:
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


@app.route("/upload", methods=["POST"])
def upload_files():
    if not current_repo_path:
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


LATEX_ENGINES = ("pdflatex", "xelatex", "lualatex")

# "Rerun to get cross-references right", "Please rerun LaTeX", "Rerun LaTeX" etc.
_RERUN_RE = re.compile(r"rerun (?:to|LaTeX)|Please rerun|Label\(s\) may have changed", re.I)
# -file-line-error output: "./chapters/nre.tex:42: Undefined control sequence"
_FILE_LINE_RE = re.compile(r"^(?:\./)?([^:\r\n]+?):(\d+):\s*(.+)$")
# "LaTeX Warning: Reference `fig:1' on page 1 undefined on input line 42."
_WARN_LINE_RE = re.compile(
    r"^(?:LaTeX|Package(?:\s+\w+)?)\s+Warning:\s*(.+?)(?:\s+on input line\s+(\d+))?\.?$"
)


def _run_tool(cmd, cwd, timeout=180):
    """Runs a build tool; returns (returncode, combined_output)."""
    proc = subprocess.run(
        cmd, cwd=cwd, capture_output=True, text=True,
        timeout=timeout, errors="replace",
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def parse_latex_log(log_text, main_file):
    """Turns a LaTeX log into structured problems for the editor's error list."""
    problems = []
    seen = set()
    lines = (log_text or "").splitlines()
    for i, line in enumerate(lines):
        line = line.rstrip()
        entry = None

        m = _FILE_LINE_RE.match(line)
        if m and not line.startswith("!"):
            path, lineno, msg = m.group(1), int(m.group(2)), m.group(3).strip()
            # Only trust it if it looks like a source file, not a stray colon.
            if path.lower().endswith((".tex", ".sty", ".cls", ".bib")):
                low = msg.lower()
                kind = "warning" if low.startswith("warning") or "warning:" in low else "error"
                entry = (path, lineno, msg, kind)

        if entry is None and line.startswith("! "):
            msg = line[2:].strip()
            lineno = None
            # The offending line usually follows as "l.42 \badcommand"
            for look in lines[i + 1:i + 6]:
                lm = re.match(r"^l\.(\d+)", look.strip())
                if lm:
                    lineno = int(lm.group(1))
                    break
            entry = (main_file, lineno, msg, "error")

        if entry is None:
            wm = _WARN_LINE_RE.match(line.strip())
            if wm:
                lineno = int(wm.group(2)) if wm.group(2) else None
                entry = (main_file, lineno, wm.group(1).strip(), "warning")

        if entry is None:
            continue
        key = entry[:3]
        if key in seen:
            continue
        seen.add(key)
        problems.append({
            "file": entry[0].replace("\\", "/"),
            "line": entry[1],
            "message": entry[2],
            "severity": entry[3],
        })
    return problems


def run_latex_build(repo_path, main_file, engine="pdflatex"):
    """
    Full LaTeX build: engine -> bibliography (biber/bibtex) -> engine reruns
    until cross-references settle. Returns log, structured problems and steps.
    """
    base = os.path.splitext(main_file)[0]
    workdir = repo_path
    steps = []
    log_parts = []

    def engine_pass(label):
        cmd = [engine, "-interaction=nonstopmode", "-file-line-error",
               "-synctex=1", main_file]
        try:
            code, out = _run_tool(cmd, workdir)
        except FileNotFoundError:
            raise FileNotFoundError(
                engine + " not found. Install a LaTeX distribution (e.g. TeX Live, MiKTeX)."
            )
        steps.append({"tool": engine, "label": label, "exitCode": code})
        log_parts.append("$ " + " ".join(cmd) + "\n" + out)
        return code

    def read_aux_log():
        # The .log file is far richer than stdout; prefer it when present.
        log_file = os.path.join(workdir, base + ".log")
        if os.path.isfile(log_file):
            try:
                with open(log_file, "r", encoding="utf-8", errors="replace") as f:
                    return f.read()
            except OSError:
                return ""
        return ""

    engine_pass("pass 1")

    # Bibliography: biblatex leaves a .bcf (biber), classic bibtex leaves
    # \bibdata in the .aux. Skip entirely when neither is present.
    bcf = os.path.join(workdir, base + ".bcf")
    aux = os.path.join(workdir, base + ".aux")
    aux_text = ""
    if os.path.isfile(aux):
        try:
            with open(aux, "r", encoding="utf-8", errors="replace") as f:
                aux_text = f.read()
        except OSError:
            aux_text = ""

    bib_tool = None
    if os.path.isfile(bcf):
        bib_tool = ["biber", base]
    elif "\\bibdata" in aux_text:
        bib_tool = ["bibtex", base]

    if bib_tool:
        try:
            code, out = _run_tool(bib_tool, workdir)
            steps.append({"tool": bib_tool[0], "label": "bibliography", "exitCode": code})
            log_parts.append("$ " + " ".join(bib_tool) + "\n" + out)
        except FileNotFoundError:
            log_parts.append(
                bib_tool[0] + " not found - citations may be unresolved. "
                "Install it with your LaTeX distribution."
            )
            steps.append({"tool": bib_tool[0], "label": "bibliography", "exitCode": -1,
                          "missing": True})

    # Rerun until references settle (bounded), always at least one extra pass
    # when a bibliography ran.
    max_reruns = 3 if bib_tool else 2
    for n in range(max_reruns):
        engine_pass("rerun %d" % (n + 1))
        text = read_aux_log()
        if not _RERUN_RE.search(text or "") and not (bib_tool and n == 0):
            break

    full_log = read_aux_log() or "\n".join(log_parts)
    problems = parse_latex_log(full_log, main_file)

    pdf_file = os.path.join(workdir, base + ".pdf")
    error = None
    if not os.path.isfile(pdf_file):
        first_error = next((p for p in problems if p["severity"] == "error"), None)
        error = first_error["message"] if first_error else "Compilation failed - no PDF produced."
    elif steps and steps[-1]["exitCode"] not in (0, None):
        first_error = next((p for p in problems if p["severity"] == "error"), None)
        if first_error:
            error = first_error["message"]

    return {
        "log": "\n".join(log_parts) if not full_log else full_log,
        "problems": problems,
        "steps": steps,
        "error": error,
    }


@app.route("/compile", methods=["GET", "POST"])
def compile_latex():
    global last_compile_error
    if request.method == "GET":
        return jsonify(
            ok=True,
            message="Compile API. POST with JSON: { \"main\": \"main.tex\" }",
            has_repo=current_repo_path is not None,
        )
    try:
        if not current_repo_path:
            return jsonify(error="No repository selected"), 400
        data = _json()
        main_file = data.get("main") or "main.tex"
        print("Compiling", main_file, "...")
    except Exception as e:
        return jsonify(error=str(e)), 500
    engine = (data.get("engine") or "").strip().lower()
    if engine not in LATEX_ENGINES:
        engine = "pdflatex"
    try:
        result = run_latex_build(current_repo_path, main_file, engine)
        last_compile_error = result["error"]
        pdf_path = "/pdf/" + main_file.replace(".tex", ".pdf")
        payload = dict(
            log=result["log"],
            problems=result["problems"],
            steps=result["steps"],
            engine=engine,
        )
        if result["error"]:
            print("Compile failed:", main_file)
            return jsonify(error=result["error"], **payload), 500
        print("Compiled", main_file, "in", len(result["steps"]), "step(s)")
        return jsonify(success=True, pdf=pdf_path, **payload)
    except subprocess.TimeoutExpired:
        last_compile_error = "Compilation timed out"
        return jsonify(error=last_compile_error), 500
    except FileNotFoundError as e:
        last_compile_error = (
            str(e) or engine + " not found. Install a LaTeX distribution (e.g. TeX Live, MiKTeX)."
        )
        return jsonify(error=last_compile_error), 500
    except Exception as e:
        last_compile_error = str(e)
        return jsonify(error=last_compile_error), 500


_LABEL_RE = re.compile(r"\\label\s*\{([^}]+)\}")
_BIBKEY_RE = re.compile(r"^\s*@(\w+)\s*\{\s*([^,\s}]+)", re.M)
_BIBFIELD_RE = re.compile(r"^\s*(title|author|year)\s*=\s*[{\"]\s*(.+?)\s*[}\"],?\s*$", re.M | re.I)
_SECTION_RE = re.compile(
    r"\\(chapter|section|subsection|subsubsection)\*?\s*(?:\[[^\]]*\])?\s*\{"
)


def _match_braces(text, start):
    """Content of a {...} group starting at `start` (the opening brace)."""
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[start + 1:i]
    return ""


def _bib_entries(text):
    entries = []
    for m in _BIBKEY_RE.finditer(text):
        key = m.group(2)
        # Read only this entry's own {...} block, so fields can't leak in
        # from the next entry.
        brace = text.find("{", m.start())
        body = _match_braces(text, brace) if brace != -1 else ""
        fields = {}
        for k, v in _BIBFIELD_RE.findall(body):
            fields.setdefault(k.lower(), v)  # first occurrence wins
        entries.append({
            "key": key,
            "type": m.group(1).lower(),
            "title": (fields.get("title") or "").strip("{} ").rstrip(","),
            "author": (fields.get("author") or "").strip("{} ").rstrip(","),
            "year": (fields.get("year") or "").strip("{} ").rstrip(","),
        })
    return entries


@app.route("/project-index")
def project_index():
    """Labels and bibliography keys across the project, for autocomplete."""
    if not current_repo_path:
        return jsonify(error="No repository selected"), 400
    labels, citations = [], []
    seen_labels, seen_keys = set(), set()
    for root, dirs, files in os.walk(current_repo_path):
        dirs[:] = [d for d in dirs if d != ".git"]
        for name in files:
            lower = name.lower()
            if not lower.endswith((".tex", ".bib")):
                continue
            path = os.path.join(root, name)
            rel = os.path.relpath(path, current_repo_path).replace("\\", "/")
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as f:
                    text = f.read()
            except OSError:
                continue
            if lower.endswith(".tex"):
                for m in _LABEL_RE.finditer(text):
                    key = m.group(1).strip()
                    if key and key not in seen_labels:
                        seen_labels.add(key)
                        labels.append({
                            "label": key,
                            "file": rel,
                            "line": text.count("\n", 0, m.start()) + 1,
                        })
            else:
                for e in _bib_entries(text):
                    if e["key"] in seen_keys:
                        continue
                    seen_keys.add(e["key"])
                    e["file"] = rel
                    citations.append(e)
    labels.sort(key=lambda x: x["label"])
    citations.sort(key=lambda x: x["key"])
    return jsonify(labels=labels, citations=citations)


@app.route("/compile-error")
def get_compile_error():
    return jsonify(error=last_compile_error)


def handle_save_pdf():
    if not current_repo_path:
        return jsonify(error="No repository selected"), 400
    data = _json()
    relative_path = (data.get("path") or data.get("name") or "").strip().replace("\\", "/").lstrip("/")
    if not relative_path or not relative_path.lower().endswith(".pdf"):
        return jsonify(error="Missing or invalid path (must be .pdf)"), 400
    full_path = resolve_repo_path(relative_path)
    if not full_path:
        return jsonify(error="Invalid path"), 400
    base64_content = data.get("content")
    if not base64_content or not isinstance(base64_content, str):
        return jsonify(error="Missing content (base64)"), 400
    try:
        buf = base64.b64decode(base64_content)
        if len(buf) == 0:
            return jsonify(error="Invalid or empty base64 content"), 400
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "wb") as f:
            f.write(buf)
        print("Saved PDF", relative_path)
        return jsonify(success=True, path=relative_path)
    except Exception as e:
        return jsonify(error=str(e)), 500


@app.route("/save-pdf", methods=["POST"])
def save_pdf():
    return handle_save_pdf()


@app.route("/api/save-pdf", methods=["POST"])
def api_save_pdf():
    return handle_save_pdf()


@app.route("/pdf")
def pdf_query():
    if not current_repo_path:
        return "No repository selected", 400
    relative_path = (request.args.get("path") or "").strip().lstrip("/\\")
    if not relative_path:
        return "Missing path", 400
    full_path = resolve_repo_path(relative_path)
    if not full_path or not os.path.isfile(full_path):
        return "Not found", 404
    return send_file(full_path, mimetype="application/pdf")


@app.route("/pdf/<path:filename>")
def pdf_file(filename):
    if not current_repo_path:
        return "No repository selected", 400
    full = os.path.join(current_repo_path, filename)
    if not os.path.isfile(full):
        return "Not found", 404
    return send_file(full, mimetype="application/pdf")


@app.route("/push", methods=["POST"])
def push():
    if not current_repo_path:
        return jsonify(error="No repository selected"), 400
    if Repo is None:
        return jsonify(error="GitPython not installed"), 500
    try:
        repo = Repo(current_repo_path)
        try:
            # Stage and commit everything with a timestamp message, then push.
            committed = False
            repo.git.add("-A")
            if repo.is_dirty(index=True, working_tree=True, untracked_files=True):
                message = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                repo.index.commit(message)
                committed = True
                print("Commit:", message)
            repo.remotes.origin.push()
            print("Pushed to origin")
            return jsonify(success=True, committed=committed)
        finally:
            if getattr(repo, "close", None):
                try:
                    repo.close()
                except Exception:
                    pass
    except Exception as e:
        return jsonify(error=str(e)), 500


@app.route("/pull", methods=["POST"])
def pull():
    if not current_repo_path:
        return jsonify(error="No repository selected"), 400
    if Repo is None:
        return jsonify(error="GitPython not installed"), 500
    try:
        repo = Repo(current_repo_path)
        try:
            before = repo.head.commit.hexsha if repo.head.is_valid() else None
            # --autostash keeps working-tree noise (compile artifacts like main.pdf)
            # from blocking the pull; older gits don't support it for merges.
            try:
                output = repo.git.pull("--autostash")
            except GitCommandError:
                output = repo.git.pull()
            after = repo.head.commit.hexsha if repo.head.is_valid() else None
            print("Pulled from origin")
            return jsonify(success=True, output=output, changed=before != after)
        finally:
            if getattr(repo, "close", None):
                try:
                    repo.close()
                except Exception:
                    pass
    except Exception as e:
        return jsonify(error=str(e)), 500


@app.route("/remote-status")
def remote_status():
    """Fetch from origin and report how far the branch is behind/ahead."""
    if not current_repo_path:
        return jsonify(error="No repository selected"), 400
    if Repo is None:
        return jsonify(error="GitPython not installed"), 500
    try:
        repo = Repo(current_repo_path)
        try:
            dirty = repo.is_dirty(untracked_files=True)
            if not repo.remotes:
                return jsonify(hasRemote=False, behind=0, ahead=0, dirty=dirty)
            if repo.head.is_detached:
                return jsonify(hasRemote=True, tracking=None, behind=0, ahead=0, dirty=dirty)
            branch = repo.active_branch
            repo.git.fetch("--quiet")
            tracking = branch.tracking_branch()
            if tracking is None:
                return jsonify(hasRemote=True, tracking=None, behind=0, ahead=0, dirty=dirty)
            counts = repo.git.rev_list(
                "--left-right", "--count", "%s...%s" % (tracking.name, branch.name)
            ).split()
            behind, ahead = int(counts[0]), int(counts[1])
            return jsonify(
                hasRemote=True, tracking=tracking.name,
                branch=branch.name, behind=behind, ahead=ahead, dirty=dirty,
            )
        finally:
            if getattr(repo, "close", None):
                try:
                    repo.close()
                except Exception:
                    pass
    except Exception as e:
        return jsonify(error=str(e)), 500


@app.route("/status")
def status():
    if not current_repo_path:
        return jsonify(error="No repository selected"), 400
    if Repo is None:
        return jsonify(error="GitPython not installed"), 500
    try:
        repo = Repo(current_repo_path)
        try:
            has_commits = repo.head.is_valid()
            modified, deleted = [], []
            # diff(None) = working tree vs index. A deleted_file entry here means
            # the path is gone from disk, which is worth calling out separately.
            for item in repo.index.diff(None):
                (deleted if item.deleted_file else modified).append(item.a_path)
            staged = []
            if has_commits:
                staged = [item.a_path for item in repo.index.diff("HEAD")]

            ahead = behind = 0
            tracking_name = None
            branch_name = None
            if not repo.head.is_detached:
                try:
                    branch = repo.active_branch
                    branch_name = branch.name
                    tracking = branch.tracking_branch() if has_commits else None
                    if tracking is not None:
                        tracking_name = tracking.name
                        # Local knowledge only - no fetch, so /status stays fast.
                        counts = repo.git.rev_list(
                            "--left-right", "--count",
                            "%s...%s" % (tracking.name, branch.name),
                        ).split()
                        behind, ahead = int(counts[0]), int(counts[1])
                except (GitCommandError, TypeError, ValueError):
                    pass

            status_dict = {
                "current": branch_name,
                "detached": repo.head.is_detached,
                "hasCommits": has_commits,
                "tracking": tracking_name,
                "ahead": ahead,
                "behind": behind,
                "modified": sorted(modified),
                "deleted": sorted(deleted),
                "staged": sorted(staged),
                "untracked": sorted(repo.untracked_files),
            }
            return jsonify(status=status_dict)
        finally:
            if getattr(repo, "close", None):
                try:
                    repo.close()
                except Exception:
                    pass
    except Exception as e:
        return jsonify(error=str(e)), 500


def _open_repo():
    """Returns (repo, error_response). Caller must close the repo."""
    if not current_repo_path:
        return None, (jsonify(error="No repository selected"), 400)
    if Repo is None:
        return None, (jsonify(error="GitPython not installed"), 500)
    try:
        repo = Repo(current_repo_path)
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


@app.route("/commits")
def commits():
    """Commit history for the versions panel, newest first."""
    repo, err = _open_repo()
    if err:
        return err
    try:
        try:
            limit = max(1, min(int(request.args.get("limit", 50)), 200))
            skip = max(0, int(request.args.get("skip", 0)))
        except ValueError:
            limit, skip = 50, 0
        head = repo.head.commit
        items = []
        for c in repo.iter_commits(max_count=limit + 1, skip=skip):
            items.append({
                "hash": c.hexsha,
                "short": c.hexsha[:7],
                "message": (c.message or "").strip().split("\n")[0],
                "author": c.author.name,
                "date": datetime.datetime.fromtimestamp(c.committed_date).isoformat(),
                "isHead": c.hexsha == head.hexsha,
            })
        has_more = len(items) > limit
        return jsonify(commits=items[:limit], hasMore=has_more)
    except Exception as e:
        return jsonify(error=str(e)), 500
    finally:
        _close_repo(repo)


@app.route("/commit-files")
def commit_files():
    """Files touched by a commit, with per-file change status."""
    repo, err = _open_repo()
    if err:
        return err
    try:
        sha = request.args.get("hash") or ""
        commit = repo.commit(sha)
        parent = commit.parents[0] if commit.parents else None
        # Against the empty tree for a root commit, so its files show as added.
        diffs = (parent.diff(commit) if parent is not None
                 else commit.diff(NULL_TREE))
        stats = commit.stats.files
        files = []
        for d in diffs:
            path = d.b_path or d.a_path
            st = stats.get(path) or {}
            files.append({
                "path": path,
                "oldPath": d.a_path if d.renamed_file else None,
                "status": ("A" if d.new_file else
                           "D" if d.deleted_file else
                           "R" if d.renamed_file else "M"),
                "insertions": st.get("insertions", 0),
                "deletions": st.get("deletions", 0),
            })
        files.sort(key=lambda f: f["path"])
        return jsonify(
            files=files,
            hash=commit.hexsha,
            short=commit.hexsha[:7],
            message=(commit.message or "").strip(),
            author=commit.author.name,
            date=datetime.datetime.fromtimestamp(commit.committed_date).isoformat(),
            isRoot=parent is None,
        )
    except Exception as e:
        return jsonify(error=str(e)), 500
    finally:
        _close_repo(repo)


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


@app.route("/working-files")
def working_files():
    """Uncommitted changes vs HEAD, shaped like the commit file lists."""
    repo, err = _open_repo()
    if err:
        return err
    try:
        stats = {}
        try:
            raw = repo.git.diff("--numstat", "HEAD")
            for line in raw.splitlines():
                parts = line.split("\t")
                if len(parts) == 3:
                    add, rem, path = parts
                    stats[path] = (0 if add == "-" else int(add),
                                   0 if rem == "-" else int(rem))
        except GitCommandError:
            pass

        files, seen = [], set()
        for d in repo.head.commit.diff(None):
            path = d.b_path or d.a_path
            if path in seen:
                continue
            seen.add(path)
            add, rem = stats.get(path, (0, 0))
            # diff(HEAD -> working tree) reports these inverted.
            files.append({
                "path": path,
                "oldPath": None,
                "status": "D" if d.new_file else "A" if d.deleted_file else "M",
                "insertions": add,
                "deletions": rem,
            })
        for path in repo.untracked_files:
            if path in seen:
                continue
            seen.add(path)
            files.append({"path": path, "oldPath": None, "status": "A",
                          "insertions": 0, "deletions": 0})
        files.sort(key=lambda f: f["path"])
        return jsonify(files=files)
    except Exception as e:
        return jsonify(error=str(e)), 500
    finally:
        _close_repo(repo)


@app.route("/working-file")
def working_file():
    """HEAD version vs what's on disk right now."""
    repo, err = _open_repo()
    if err:
        return err
    try:
        path = (request.args.get("path") or "").replace("\\", "/")
        if not path:
            return jsonify(error="No path given"), 400
        before, before_bin = _blob_text(repo.head.commit, path)
        full = resolve_repo_path(path)
        after, after_bin = "", False
        if full and os.path.isfile(full):
            with open(full, "rb") as f:
                raw = f.read()
            if b"\0" in raw[:8000]:
                after_bin = True
            else:
                after = raw.decode("utf-8", errors="replace")
        if before_bin or after_bin:
            return jsonify(binary=True, before="", after="", path=path)
        return jsonify(binary=False, before=before or "", after=after, path=path)
    except Exception as e:
        return jsonify(error=str(e)), 500
    finally:
        _close_repo(repo)


@app.route("/compare-files")
def compare_files():
    """Files that differ between two commits, for the versions compare view."""
    repo, err = _open_repo()
    if err:
        return err
    try:
        a = repo.commit(request.args.get("from") or "")
        b = repo.commit(request.args.get("to") or "")
        stats = _numstat(repo, a.hexsha, b.hexsha)
        files = []
        for d in a.diff(b):
            path = d.b_path or d.a_path
            add, rem = stats.get(path, (0, 0))
            files.append({
                "path": path,
                "oldPath": d.a_path if d.renamed_file else None,
                "status": ("A" if d.new_file else
                           "D" if d.deleted_file else
                           "R" if d.renamed_file else "M"),
                "insertions": add,
                "deletions": rem,
            })
        files.sort(key=lambda f: f["path"])
        return jsonify(
            files=files,
            fromHash=a.hexsha, fromShort=a.hexsha[:7],
            fromMessage=(a.message or "").strip().split("\n")[0],
            toHash=b.hexsha, toShort=b.hexsha[:7],
            toMessage=(b.message or "").strip().split("\n")[0],
        )
    except Exception as e:
        return jsonify(error=str(e)), 500
    finally:
        _close_repo(repo)


@app.route("/compare-file")
def compare_file():
    """Text of one file at two commits, for the side-by-side diff."""
    repo, err = _open_repo()
    if err:
        return err
    try:
        path = (request.args.get("path") or "").replace("\\", "/")
        if not path:
            return jsonify(error="No path given"), 400
        a = repo.commit(request.args.get("from") or "")
        b = repo.commit(request.args.get("to") or "")
        before, before_bin = _blob_text(a, request.args.get("oldPath") or path)
        after, after_bin = _blob_text(b, path)
        if before_bin or after_bin:
            return jsonify(binary=True, before="", after="", path=path)
        return jsonify(binary=False, before=before or "", after=after or "", path=path)
    except Exception as e:
        return jsonify(error=str(e)), 500
    finally:
        _close_repo(repo)


@app.route("/commit-file")
def commit_file():
    """Before/after text of one file in a commit, for the diff view."""
    repo, err = _open_repo()
    if err:
        return err
    try:
        sha = request.args.get("hash") or ""
        path = (request.args.get("path") or "").replace("\\", "/")
        if not path:
            return jsonify(error="No path given"), 400
        commit = repo.commit(sha)
        parent = commit.parents[0] if commit.parents else None
        after, after_bin = _blob_text(commit, path)
        before, before_bin = (None, False)
        if parent is not None:
            old_path = request.args.get("oldPath") or path
            before, before_bin = _blob_text(parent, old_path)
        if after_bin or before_bin:
            return jsonify(binary=True, before="", after="", path=path)
        return jsonify(
            binary=False,
            before=before or "",
            after=after or "",
            path=path,
        )
    except Exception as e:
        return jsonify(error=str(e)), 500
    finally:
        _close_repo(repo)


@app.route("/diff")
def diff():
    if not current_repo_path:
        return jsonify(error="No repository selected"), 400
    if Repo is None:
        return jsonify(error="GitPython not installed"), 500
    try:
        repo = Repo(current_repo_path)
        try:
            diff_text = repo.git.diff()
            return jsonify(diff=diff_text)
        finally:
            if getattr(repo, "close", None):
                try:
                    repo.close()
                except Exception:
                    pass
    except Exception as e:
        return jsonify(error=str(e)), 500


@app.route("/<path:path>", methods=["GET", "HEAD"])
def static_file(path):
    """Serve file from public/ or index.html for SPA routes. GET/HEAD only."""
    path = path.lstrip("/").replace("\\", "/")
    if not path:
        return _serve_index()
    full_path = _static_path(path)
    if full_path:
        ext = os.path.splitext(full_path)[1].lower()
        mime = MIME_TYPES.get(ext) or "application/octet-stream"
        if ext in (".css", ".js"):
            try:
                with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                    body = f.read()
            except OSError:
                return "Not found", 404
            return Response(body, mimetype=mime)
        return send_file(full_path, mimetype=mime)
    last = path.split("/")[-1].lower()
    if any(last.endswith(ext) for ext in ASSET_EXTENSIONS):
        return "Not found", 404
    return _serve_index()


def create_app(repos_dir=None):
    global BASE_DIR
    BASE_DIR = str(Path(repos_dir) if repos_dir else _repos_base())
    os.makedirs(BASE_DIR, exist_ok=True)
    public = _public_dir()
    if not os.path.isdir(public):
        raise FileNotFoundError(f"Public folder not found: {public}. Run from project root.")
    print("Serving static files from:", public)
    return app


def run_server(host="127.0.0.1", port=5000, open_browser=True, repos_dir=None):
    create_app(repos_dir=repos_dir)
    url = f"http://{host}:{port}"

    if open_browser:
        def open_later():
            time.sleep(1.2)
            import webbrowser
            webbrowser.open(url)
        threading.Thread(target=open_later, daemon=True).start()

    print(f"GitLaTeX IDE is running on {url}")
    app.run(host=host, port=port, threaded=True, use_reloader=False)


def main():
    parser = argparse.ArgumentParser(
        description="GitLaTeX IDE - A simple UI for LaTeX projects with Git support."
    )
    parser.add_argument("--port", "-p", type=int, default=5000, help="Port (default: 5000)")
    parser.add_argument("--host", default="127.0.0.1", help="Host (default: 127.0.0.1)")
    parser.add_argument("--no-browser", action="store_true", help="Do not open browser")
    parser.add_argument("--repos", default=None, help="Path to repos directory (default: ./repos)")
    args = parser.parse_args()
    run_server(
        host=args.host,
        port=args.port,
        open_browser=not args.no_browser,
        repos_dir=args.repos,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
