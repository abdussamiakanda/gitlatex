"""Review comments: threads anchored to a range of lines in a project file.

Each thread is one JSON file under <project>/.gitlatex/comments/, so comments
are committed and pushed with the rest of the project. One file per thread
(rather than one big file) means two people starting threads at the same time
never touch the same file, so their pushes merge cleanly.

A thread looks like:

    {
      "id": "3f2a...",
      "file": "chapters/intro.tex",
      "range": {"startLine": 12, "startColumn": 1, "endLine": 12, "endColumn": 40},
      "quote": "the text that was selected",
      "resolved": false,
      "createdAt": "2026-09-29T10:00:00",
      "messages": [
        {"id": "...", "author": "Ada", "email": "ada@example.com",
         "date": "2026-09-29T10:00:00", "text": "Is this right?"}
      ]
    }

Line and column numbers are 1-based, as Monaco uses them. `quote` is kept so
the browser can find the text again if the file changed since the range was
last saved (e.g. after a pull).
"""

import datetime
import json
import os
import re
import shlex
import subprocess
import sys
import threading
import uuid

COMMENTS_DIR = os.path.join(".gitlatex", "comments")

MERGE_DRIVER = "gitlatex-comments"
MERGE_ATTRIBUTE = ".gitlatex/comments/*.json merge=" + MERGE_DRIVER

# One server, one user, but the browser can fire an anchor sync and a reply at
# the same moment.
_lock = threading.Lock()


def _dir(repo_path):
    return os.path.join(repo_path, COMMENTS_DIR)


def _thread_path(repo_path, thread_id):
    # Ids are generated here as hex, but they come back from the browser.
    if not thread_id or not all(c in "0123456789abcdef" for c in thread_id):
        return None
    return os.path.join(_dir(repo_path), thread_id + ".json")


def _now():
    return datetime.datetime.now().replace(microsecond=0).isoformat()


def _read(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        # Missing, or left with merge conflict markers - skip rather than fail
        # the whole panel.
        return None
    return data if isinstance(data, dict) and data.get("id") else None


def _write(repo_path, thread):
    os.makedirs(_dir(repo_path), exist_ok=True)
    path = _thread_path(repo_path, thread["id"])
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(thread, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


def _git_config(repo_path, key):
    """`git config <key>` as seen from the project (repo config, then global)."""
    try:
        out = subprocess.run(
            ["git", "config", key], cwd=repo_path,
            capture_output=True, text=True, timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return out.stdout.strip() if out.returncode == 0 else ""


def install_merge_driver(repo_path):
    """Let git merge comment threads itself (see comments_merge.py).

    Registered in the project's own .git (config and info/attributes), not in
    a committed .gitattributes: a merge driver is a command on this machine,
    so every copy of the project sets up its own. Safe to call repeatedly;
    refreshes the command if the app has moved. Returns True if installed.
    """
    git_dir = os.path.join(repo_path, ".git")
    if not os.path.isdir(git_dir):
        return False
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "comments_merge.py")
    command = "%s %s %%O %%A %%B" % (shlex.quote(sys.executable), shlex.quote(script))
    try:
        for key, value in (
            ("merge.%s.name" % MERGE_DRIVER, "gitlatex review comment threads"),
            ("merge.%s.driver" % MERGE_DRIVER, command),
        ):
            if _git_config(repo_path, key) != value:
                subprocess.run(["git", "config", key, value], cwd=repo_path,
                               capture_output=True, timeout=5, check=True)
        info = os.path.join(git_dir, "info")
        attributes = os.path.join(info, "attributes")
        try:
            with open(attributes, "r", encoding="utf-8") as f:
                existing = f.read()
        except OSError:
            existing = ""
        if MERGE_ATTRIBUTE not in existing.splitlines():
            os.makedirs(info, exist_ok=True)
            with open(attributes, "a", encoding="utf-8") as f:
                if existing and not existing.endswith("\n"):
                    f.write("\n")
                f.write(MERGE_ATTRIBUTE + "\n")
    except (OSError, subprocess.SubprocessError) as e:
        print("Could not set up the comment merge driver:", e)
        return False
    return True


def current_user(repo_path):
    """The name comments are signed with: the same identity commits use."""
    name = _git_config(repo_path, "user.name")
    email = _git_config(repo_path, "user.email")
    return {"name": name or "Anonymous", "email": email, "configured": bool(name)}


def _clean_range(rng):
    if not isinstance(rng, dict):
        raise ValueError("Missing range")
    out = {}
    for key in ("startLine", "startColumn", "endLine", "endColumn"):
        try:
            out[key] = max(1, int(rng.get(key)))
        except (TypeError, ValueError):
            raise ValueError("Invalid range")
    return out


def _clean_text(text):
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Comment is empty")
    return text.strip()


def _message(repo_path, text):
    user = current_user(repo_path)
    return {
        "id": uuid.uuid4().hex,
        "author": user["name"],
        "email": user["email"],
        "date": _now(),
        "text": _clean_text(text),
    }


def _conflict_stub(repo_path, path):
    """A placeholder for a thread file left with merge conflict markers.

    Shown in the panel as "this thread has a merge conflict" instead of the
    thread silently disappearing. Only file and position are recovered, by
    pattern, from whichever side comes first.
    """
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return None
    if "<<<<<<<" not in text:
        return None
    file = re.search(r'"file"\s*:\s*"((?:[^"\\]|\\.)*)"', text)
    if not file:
        return None
    rng = {}
    for key in ("startLine", "startColumn", "endLine", "endColumn"):
        m = re.search(r'"%s"\s*:\s*(\d+)' % key, text)
        rng[key] = int(m.group(1)) if m else 1
    return {
        "id": os.path.basename(path)[:-len(".json")],
        "file": json.loads('"%s"' % file.group(1)),
        "range": rng,
        "quote": "",
        "resolved": False,
        "conflict": True,
        "path": os.path.relpath(path, repo_path).replace("\\", "/"),
        "messages": [],
    }


def list_threads(repo_path, file=None):
    folder = _dir(repo_path)
    if not os.path.isdir(folder):
        return []
    threads = []
    for name in os.listdir(folder):
        if not name.endswith(".json"):
            continue
        path = os.path.join(folder, name)
        thread = _read(path) or _conflict_stub(repo_path, path)
        if thread is None:
            continue
        if file is not None and thread.get("file") != file:
            continue
        threads.append(thread)
    threads.sort(key=lambda t: (t.get("range", {}).get("startLine", 0), t.get("createdAt", "")))
    return threads


def create_thread(repo_path, file, rng, quote, text):
    if not isinstance(file, str) or not file:
        raise ValueError("Missing file")
    thread = {
        "id": uuid.uuid4().hex,
        "file": file.replace("\\", "/"),
        "range": _clean_range(rng),
        "quote": quote if isinstance(quote, str) else "",
        "resolved": False,
        "createdAt": _now(),
        "messages": [_message(repo_path, text)],
    }
    with _lock:
        _write(repo_path, thread)
    return thread


def _update(repo_path, thread_id, change):
    path = _thread_path(repo_path, thread_id)
    if path is None:
        raise KeyError(thread_id)
    with _lock:
        thread = _read(path)
        if thread is None:
            raise KeyError(thread_id)
        change(thread)
        _write(repo_path, thread)
    return thread


def reply(repo_path, thread_id, text):
    msg = _message(repo_path, text)
    return _update(repo_path, thread_id, lambda t: t["messages"].append(msg))


def set_resolved(repo_path, thread_id, resolved):
    def change(t):
        t["resolved"] = bool(resolved)
        if resolved:
            user = current_user(repo_path)
            t["resolvedBy"] = user["name"]
            t["resolvedAt"] = _now()
        else:
            t.pop("resolvedBy", None)
            t.pop("resolvedAt", None)
    return _update(repo_path, thread_id, change)


def delete_thread(repo_path, thread_id):
    path = _thread_path(repo_path, thread_id)
    if path is None:
        raise KeyError(thread_id)
    with _lock:
        if not os.path.isfile(path):
            raise KeyError(thread_id)
        os.unlink(path)


def delete_message(repo_path, thread_id, message_id):
    """Remove one reply. Deleting the opening message deletes the thread."""
    path = _thread_path(repo_path, thread_id)
    if path is None:
        raise KeyError(thread_id)
    with _lock:
        thread = _read(path)
        if thread is None:
            raise KeyError(thread_id)
        messages = thread.get("messages") or []
        if messages and messages[0].get("id") == message_id:
            os.unlink(path)
            return None
        thread["messages"] = [m for m in messages if m.get("id") != message_id]
        _write(repo_path, thread)
        return thread


def update_anchors(repo_path, anchors):
    """Save new ranges after edits moved the text. Returns how many changed.

    Only threads whose range or quote actually differs are rewritten, so an
    edit near the bottom of a file doesn't dirty every comment above it.
    """
    changed = 0
    with _lock:
        for a in anchors if isinstance(anchors, list) else []:
            if not isinstance(a, dict):
                continue
            path = _thread_path(repo_path, a.get("id"))
            thread = _read(path) if path else None
            if thread is None:
                continue
            try:
                rng = _clean_range(a.get("range"))
            except ValueError:
                continue
            quote = a.get("quote")
            new_quote = quote if isinstance(quote, str) else thread.get("quote", "")
            if thread.get("range") == rng and thread.get("quote") == new_quote:
                continue
            thread["range"] = rng
            thread["quote"] = new_quote
            _write(repo_path, thread)
            changed += 1
    return changed


def move_file(repo_path, old, new):
    """Keep threads attached when a file or folder is renamed."""
    old = old.replace("\\", "/").rstrip("/")
    new = new.replace("\\", "/").rstrip("/")
    with _lock:
        for thread in list_threads(repo_path):
            if thread.get("conflict"):
                continue  # a placeholder; writing it would lose the real file
            f = thread.get("file", "")
            if f == old:
                thread["file"] = new
            elif f.startswith(old + "/"):
                thread["file"] = new + f[len(old):]
            else:
                continue
            _write(repo_path, thread)


def drop_file(repo_path, path):
    """Delete the threads of a file (or every file under a folder)."""
    path = path.replace("\\", "/").rstrip("/")
    with _lock:
        for thread in list_threads(repo_path):
            f = thread.get("file", "")
            if f == path or f.startswith(path + "/"):
                try:
                    os.unlink(_thread_path(repo_path, thread["id"]))
                except OSError:
                    pass
