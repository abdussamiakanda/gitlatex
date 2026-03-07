"""Flask server for GitLaTeX IDE - mirrors the Node/Express API."""

import argparse
import base64
import os
import re
import shutil
import stat
import subprocess
import sys
import threading
import time
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
    from git import Repo
    try:
        from git.util import rmtree as git_rmtree
    except (ImportError, AttributeError):
        git_rmtree = None
except ImportError:
    Repo = None
    git_rmtree = None

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
        repository="https://github.com/abdussamiakanda/gitlatex/tree/feat/python-server",
        pypi="https://pypi.org/project/gitlatex",
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
    try:
        result = subprocess.run(
            ["pdflatex", "-interaction=nonstopmode", main_file],
            cwd=current_repo_path,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            last_compile_error = result.stderr or result.stdout or f"Exit code {result.returncode}"
            print("Compile failed:", main_file)
            return jsonify(error=last_compile_error), 500
        last_compile_error = None
        print("Compiled", main_file)
        pdf_path = "/pdf/" + main_file.replace(".tex", ".pdf")
        return jsonify(success=True, pdf=pdf_path)
    except subprocess.TimeoutExpired:
        last_compile_error = "Compilation timed out"
        return jsonify(error=last_compile_error), 500
    except FileNotFoundError:
        last_compile_error = "pdflatex not found. Install a LaTeX distribution (e.g. TeX Live, MiKTeX)."
        return jsonify(error=last_compile_error), 500
    except Exception as e:
        last_compile_error = str(e)
        return jsonify(error=last_compile_error), 500


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


@app.route("/commit", methods=["POST"])
def commit():
    if not current_repo_path:
        return jsonify(error="No repository selected"), 400
    if Repo is None:
        return jsonify(error="GitPython not installed"), 500
    data = _json()
    message = data.get("message") or ""
    try:
        repo = Repo(current_repo_path)
        try:
            repo.index.add("*")
            repo.index.commit(message)
            print("Commit:", (message or "")[:60])
            return jsonify(success=True)
        finally:
            if getattr(repo, "close", None):
                try:
                    repo.close()
                except Exception:
                    pass
    except Exception as e:
        return jsonify(error=str(e)), 500


@app.route("/push", methods=["POST"])
def push():
    if not current_repo_path:
        return jsonify(error="No repository selected"), 400
    if Repo is None:
        return jsonify(error="GitPython not installed"), 500
    try:
        repo = Repo(current_repo_path)
        try:
            repo.remotes.origin.push()
            print("Pushed to origin")
            return jsonify(success=True)
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
            status_dict = {
                "current": repo.head.ref.name if not repo.head.is_detached else None,
                "modified": [item.a_path for item in repo.index.diff(None)],
                "staged": [item.a_path for item in repo.index.diff("HEAD")],
                "untracked": repo.untracked_files,
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
