"""Managing projects: listing, selecting, creating, cloning and deleting."""

import os
import re
import shutil
import stat
import subprocess
import sys

from flask import Blueprint, jsonify

from gitlatex import state
from gitlatex.services import paths
from gitlatex.services.git_backend import Repo, git_rmtree
from gitlatex.http import _json
from gitlatex.services.paths import count_files_in_dir, parse_owner_from_remote_url

bp = Blueprint("repos", __name__)


@bp.route("/repos")
def list_repos():
    if not os.path.isdir(state.BASE_DIR):
        return jsonify(repos=[], current=None)
    entries = [
        name for name in os.listdir(state.BASE_DIR)
        if os.path.isdir(os.path.join(state.BASE_DIR, name))
    ]
    repos = []
    for name in entries:
        full = os.path.join(state.BASE_DIR, name)
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
    current_name = os.path.basename(state.current_repo_path) if state.current_repo_path else None
    return jsonify(repos=repos, current=current_name)


@bp.route("/delete-repo", methods=["POST"])
def delete_repo():
    if not state.BASE_DIR or not os.path.isdir(state.BASE_DIR):
        return jsonify(error="Repos directory not available"), 500
    data = _json()
    name = (data.get("name") or "").strip().lstrip("/\\")
    if not name:
        return jsonify(error="Missing repo name"), 400
    if ".." in name or os.path.isabs(name):
        return jsonify(error="Invalid repo name"), 400
    full_path = os.path.join(state.BASE_DIR, name)
    try:
        if not os.path.exists(full_path):
            return jsonify(error="Repository not found"), 404
        if not os.path.isdir(full_path):
            return jsonify(error="Not a directory"), 400
        real_base = os.path.realpath(state.BASE_DIR)
        real_full = os.path.realpath(full_path)
        if real_full != real_base and not real_full.startswith(real_base + os.sep):
            return jsonify(error="Invalid repo name"), 400
        if state.current_repo_path and os.path.realpath(state.current_repo_path) == real_full:
            state.current_repo_path = None

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


@bp.route("/create-workspace", methods=["POST"])
def create_workspace():
    data = _json()
    raw = (data.get("name") or "").strip()
    if not raw:
        return jsonify(error="Missing name"), 400
    name = re.sub(r'[/\\:*?"<>|]', "-", raw)
    name = re.sub(r"\s+", "-", name) or "new-folder"
    full_path = os.path.join(state.BASE_DIR, name)
    try:
        if os.path.exists(full_path):
            return jsonify(error="A folder with that name already exists"), 400
        os.makedirs(full_path, exist_ok=True)
        print("Created workspace:", name)
        return jsonify(success=True, name=name)
    except Exception as e:
        return jsonify(error=str(e)), 500


@bp.route("/select-repo", methods=["POST"])
def select_repo():
    data = _json()
    name = data.get("name")
    if not name:
        return jsonify(error="Missing repo name"), 400
    repo_path = os.path.join(state.BASE_DIR, name)
    if not os.path.isdir(repo_path):
        return jsonify(error="Repository not found"), 404
    state.current_repo_path = repo_path
    git_dir = os.path.join(repo_path, ".git")
    has_git = os.path.isdir(git_dir)
    print("Selected repo:", name)
    return jsonify(success=True, hasGit=has_git)


@bp.route("/clone", methods=["POST"])
def clone_repo():
    data = _json()
    repo_url = data.get("repoUrl")
    if not repo_url:
        return jsonify(error="Missing repoUrl"), 400
    repo_name = repo_url.rstrip("/").split("/")[-1].replace(".git", "")
    repo_path = os.path.join(state.BASE_DIR, repo_name)
    print("Cloning", repo_url, "->", repo_name)
    if Repo is None:
        return jsonify(error="GitPython not installed"), 500
    try:
        Repo.clone_from(repo_url, repo_path)
        print("Cloned", repo_name)
        state.current_repo_path = repo_path
        return jsonify(success=True)
    except Exception as e:
        return jsonify(error=str(e)), 500
