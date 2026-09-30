"""Filesystem helpers: path safety and project tree walking.

Every path that arrives from the browser goes through resolve_repo_path (for
files inside a project) or _static_path (for assets under public/). Both
refuse anything that escapes their root.
"""

import os
import re
from pathlib import Path

from gitlatex import state


def _public_dir():
    """The public/ assets folder (index.html, js/, css/).

    Resolved from the gitlatex package root, not from this file, so moving this
    module between subpackages cannot break it.
    """
    package_root = Path(os.path.realpath(__file__)).resolve().parent.parent
    return str(package_root / "public")


def _ui_dir():
    """The built editor UI (web/ compiled by Vite), if this install has one."""
    package_root = Path(os.path.realpath(__file__)).resolve().parent.parent
    return str(package_root / "ui")


def has_ui():
    return os.path.isfile(os.path.join(_ui_dir(), "index.html"))


def _static_path(relative_path, root=None):
    """Resolve path under public/ (or root); return None if outside or missing (security)."""
    public_dir = os.path.normpath(root or _public_dir())
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
    if not state.current_repo_path or relative_path is None:
        return None
    if not isinstance(relative_path, str):
        return None
    normalized = os.path.normpath(relative_path)
    normalized = re.sub(r"^(\.\.(/|\\|$))+", "", normalized).lstrip("/\\")
    if not normalized:
        return None
    full = os.path.abspath(os.path.join(state.current_repo_path, normalized))
    rel = os.path.relpath(full, state.current_repo_path)
    if rel.startswith("..") or os.path.isabs(rel):
        return None
    return full


def read_dir_recursive(dir_path):
    entries = os.listdir(dir_path)
    result = []
    for file in entries:
        full = os.path.join(dir_path, file)
        # .gitlatex holds review comments - managed by the review panel, not
        # something to open in the editor.
        if file in (".git", ".gitlatex"):
            continue
        if os.path.isdir(full):
            result.append({"name": file, "type": "folder", "children": read_dir_recursive(full)})
        else:
            # SyncTeX data is for PDF <-> source jumps, not something to open.
            if file.lower().endswith((".synctex.gz", ".synctex")):
                continue
            # Compiled PDFs are listed too; clicking one opens it in the PDF viewer.
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
