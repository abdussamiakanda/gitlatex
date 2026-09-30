"""Source control for the editor's Source control panel, modelled on VS Code.

Everything runs the git command line through GitPython (`repo.git.<cmd>`), so
behaviour matches what the user would get in a terminal: their config, hooks
and credential helpers all apply. Functions take an open Repo and return plain
data; gitlatex/routes/scm.py turns them into HTTP.

Vocabulary as in VS Code: "staged" is in the index, "changes" are in the
working tree, "conflicts" are unmerged paths. "Current" and "incoming" are
git's ours and theirs, which mean different things in a merge and a rebase;
status() says which one is the user's (`sides`).

Pulls rebase and push retries after a rejected push, as in services/sync.py,
but a real conflict is left in the files (keep_conflicts) to resolve here.
"""

import os
import re
import shutil
import subprocess

from gitlatex.services import sync
from gitlatex.services.git_backend import GitCommandError

# Porcelain v2 status letters: M modified, T type change, A added, D deleted,
# R renamed, C copied, U updated but unmerged. "." means unchanged.
_CONFLICT_LABELS = {
    "DD": "both deleted",
    "AU": "added by us",
    "UD": "deleted by them",
    "UA": "added by them",
    "DU": "deleted by us",
    "AA": "both added",
    "UU": "both modified",
}


def _git_dir(repo):
    return repo.git.rev_parse("--absolute-git-dir")


def _in_progress(repo):
    """'merge', 'rebase', 'cherry-pick' or None."""
    gd = _git_dir(repo)
    if os.path.exists(os.path.join(gd, "MERGE_HEAD")):
        return "merge"
    if os.path.isdir(os.path.join(gd, "rebase-merge")) or os.path.isdir(os.path.join(gd, "rebase-apply")):
        return "rebase"
    if os.path.exists(os.path.join(gd, "CHERRY_PICK_HEAD")):
        return "cherry-pick"
    return None


def status(repo):
    """Branch, upstream, ahead/behind, remotes and the three file lists."""
    raw = repo.git.status("--porcelain=v2", "--branch", "-z", "--untracked-files=all")
    entries = raw.split("\0")
    info = {"branch": None, "detached": False, "hasCommits": True, "upstream": None, "ahead": 0, "behind": 0}
    staged, changes, conflicts = [], [], []
    i = 0
    while i < len(entries):
        e = entries[i]
        i += 1
        if not e:
            continue
        if e.startswith("# branch.oid "):
            info["hasCommits"] = e[len("# branch.oid "):] != "(initial)"
        elif e.startswith("# branch.head "):
            head = e[len("# branch.head "):]
            info["detached"] = head == "(detached)"
            info["branch"] = None if info["detached"] else head
        elif e.startswith("# branch.upstream "):
            info["upstream"] = e[len("# branch.upstream "):]
        elif e.startswith("# branch.ab "):
            m = re.match(r"# branch\.ab \+(\d+) -(\d+)", e)
            if m:
                info["ahead"], info["behind"] = int(m.group(1)), int(m.group(2))
        elif e[0] in "12":
            parts = e.split(" ", 8 if e[0] == "1" else 9)
            xy = parts[1]
            path = parts[-1]
            old = None
            if e[0] == "2":
                old = entries[i]  # with -z the original path follows as its own entry
                i += 1
            if xy[0] != ".":
                staged.append({"path": path, "oldPath": old, "status": xy[0]})
            if xy[1] != ".":
                changes.append({"path": path, "oldPath": None, "status": xy[1]})
        elif e[0] == "u":
            parts = e.split(" ", 10)
            xy = parts[1]
            conflicts.append({"path": parts[-1], "status": "U", "kind": xy, "label": _CONFLICT_LABELS.get(xy, "conflict")})
        elif e[0] == "?":
            # Untracked; the UI shows it as "U" like VS Code.
            changes.append({"path": e[2:], "oldPath": None, "status": "?"})
    remotes = [r.name for r in repo.remotes]
    op = _in_progress(repo)
    if op == "rebase" and info["detached"]:
        # Git detaches HEAD while it rebases; report the branch being rebased.
        branch = _rebasing_branch(repo)
        if branch:
            info.update(branch=branch, detached=False)
            try:
                info["upstream"] = repo.git.rev_parse("--abbrev-ref", branch + "@{u}")
            except GitCommandError:
                pass
    if not op and conflicts and _top_stash_is_autostash(repo):
        # A pull went through, but putting the user's uncommitted edits back
        # conflicted with what came in.
        op = "autostash"
    info.update(
        staged=staged,
        changes=changes,
        conflicts=conflicts,
        remotes=remotes,
        inProgress=op,
        sides=_SIDES.get(op, _SIDES[None]),
    )
    return info


# Whose version is "current" (ours) and "incoming" (theirs) in each situation.
_SIDES = {
    None: {"current": "Your version", "incoming": "Their version"},
    "merge": {"current": "Your version", "incoming": "Their version"},
    # A rebase replays your commits onto the remote's, so "ours" is theirs.
    "rebase": {"current": "The remote's version", "incoming": "Your version"},
    "autostash": {"current": "The remote's version", "incoming": "Your unsaved edits"},
    "cherry-pick": {"current": "Your version", "incoming": "The picked commit"},
}


def _rebasing_branch(repo):
    """The branch a rebase in progress will update (refs/heads/main → main), or None."""
    gd = _git_dir(repo)
    for d in ("rebase-merge", "rebase-apply"):
        try:
            with open(os.path.join(gd, d, "head-name"), encoding="utf-8") as f:
                ref = f.read().strip()
        except OSError:
            continue
        if ref.startswith("refs/heads/"):
            return ref[len("refs/heads/"):]
    return None


def _top_stash_is_autostash(repo):
    try:
        return repo.git.stash("list", "-1", "--format=%gs") == "autostash"
    except GitCommandError:
        return False


# ---- staging --------------------------------------------------------------------------------

def stage(repo, paths=None):
    if paths:
        repo.git.add("--", *paths)
    else:
        repo.git.add("-A")


def unstage(repo, paths=None, has_commits=True):
    if has_commits:
        repo.git.restore("--staged", "--", *(paths or ["."]))
    else:
        # No HEAD to restore from: take the files out of the index instead.
        repo.git.rm("--cached", "-r", "-q", "--", *(paths or ["."]))


def discard(repo, paths):
    """Throw away working-tree changes: tracked files go back to the index, untracked files are deleted."""
    root = repo.working_tree_dir
    untracked = set(repo.untracked_files)
    tracked = [p for p in paths if p not in untracked]
    if tracked:
        repo.git.restore("--worktree", "--", *tracked)
    for p in paths:
        if p in untracked:
            full = os.path.join(root, p)
            if os.path.isdir(full):
                shutil.rmtree(full)
            elif os.path.exists(full):
                os.remove(full)


# ---- conflicts ------------------------------------------------------------------------------

def _after_resolving(repo, path):
    """After a file is resolved: outside a merge or rebase (an autostash conflict)
    it goes back to being an uncommitted edit, and once nothing is left
    unmerged the autostash that held those edits is dropped."""
    if _in_progress(repo):
        return
    try:
        repo.git.restore("--staged", "--", path)
    except GitCommandError:
        pass
    if not sync.unmerged(repo) and _top_stash_is_autostash(repo):
        repo.git.stash("drop")


def take_side(repo, path, side):
    """Resolve a conflicted file with one whole side ('current' = ours, 'incoming' = theirs), then mark it resolved."""
    flag = "--ours" if side == "current" else "--theirs"
    try:
        repo.git.checkout(flag, "--", path)
        repo.git.add("--", path)
    except GitCommandError:
        # That side deleted the file.
        repo.git.rm("-q", "--", path)
    _after_resolving(repo, path)


def mark_resolved(repo, path):
    repo.git.add("--", path)
    _after_resolving(repo, path)


def abort(repo):
    """Undo the merge, rebase or cherry-pick in progress. For a conflict between
    the user's uncommitted edits and a pull, go back to before the pull with the
    edits restored as they were."""
    op = status(repo)["inProgress"]
    if op == "rebase":
        repo.git.rebase("--abort")  # also puts the autostashed edits back
    elif op == "cherry-pick":
        repo.git.cherry_pick("--abort")
    elif op == "merge":
        repo.git.merge("--abort")
    elif op == "autostash":
        repo.git.reset("--hard", "ORIG_HEAD")
        repo.git.stash("pop")
    else:
        raise ValueError("There is nothing to abort.")


# ---- commit, pull, push -------------------------------------------------------------------

def commit(repo, message, smart=True):
    """Commit the index. With nothing staged, stage everything first (VS Code's smart commit).

    Uses `git commit` rather than GitPython's index.commit so a merge commit
    gets both parents and hooks run as usual. An empty message during a merge
    uses git's prepared merge message. During a rebase this continues it, and
    the next commit may stop at a new conflict. Returns {commit, conflicts}.
    """
    st = status(repo)
    if st["conflicts"]:
        n = len(st["conflicts"])
        raise ValueError("Resolve the conflicts first (%d file%s)." % (n, "" if n == 1 else "s"))
    op = st["inProgress"]
    if op == "rebase":
        stage(repo)
        try:
            repo.git.rebase("--continue", env={"GIT_EDITOR": "true"})
        except GitCommandError:
            pass  # stopped at the next commit; advance_rebase looks at why
        try:
            sync.advance_rebase(repo, keep_conflicts=True)
        except sync.Conflict as c:
            return {"commit": None, "conflicts": c.files}
        return {"commit": repo.git.rev_parse("--short", "HEAD"), "conflicts": []}
    if not st["staged"]:
        if smart and st["changes"]:
            stage(repo)
        elif op != "merge":
            raise ValueError("There is nothing to commit.")
    if message:
        repo.git.commit("-m", message)
    elif op == "merge":
        repo.git.commit("--no-edit")
    else:
        raise ValueError("Enter a commit message.")
    return {"commit": repo.git.rev_parse("--short", "HEAD"), "conflicts": []}


def pull(repo):
    """Pull with rebase (services/sync.py). A real conflict is left for the user, not undone."""
    cleared = sync.clear_stale_build_outputs(repo)
    try:
        output = sync.pull_rebase(repo, keep_conflicts=True)
        return {"output": output, "conflicts": [], "cleared": cleared}
    except sync.Conflict as c:
        return {"output": "Stopped at a conflict.", "conflicts": c.files, "cleared": cleared}


def push(repo, remote=None):
    """Push the current branch; without an upstream, publish it (`push -u`).

    When a coauthor pushed first, pull their commits in (rebase) and push again,
    as /push does. A conflict stops before pushing. Returns {pulled, conflicts, cleared}.
    """
    st = status(repo)
    if not st["hasCommits"]:
        raise ValueError("Make a first commit before pushing.")
    if not st["remotes"]:
        raise ValueError("This repository has no remote yet. Publish it first.")
    if st["inProgress"]:
        raise ValueError("Finish or abort the %s before pushing." % st["inProgress"])
    if not st["upstream"]:
        repo.git.push("-u", remote or ("origin" if "origin" in st["remotes"] else st["remotes"][0]), "HEAD")
        return {"pulled": False, "conflicts": [], "cleared": []}
    if sync.push_current(repo):
        return {"pulled": False, "conflicts": [], "cleared": []}
    pulled = pull(repo)
    if pulled["conflicts"]:
        return {"pulled": True, **pulled}
    if not sync.push_current(repo):
        raise ValueError("The remote changed again while pushing. Try again.")
    return {"pulled": True, "conflicts": [], "cleared": pulled["cleared"]}


# ---- branches -------------------------------------------------------------------------------

def branches(repo):
    local = [b for b in repo.git.branch("--format=%(refname:short)").splitlines() if b]
    remote = [b for b in repo.git.branch("-r", "--format=%(refname:short)").splitlines() if b and not b.endswith("/HEAD") and "/" in b]
    return {"local": local, "remote": remote}


def checkout(repo, name, create=False):
    if create:
        repo.git.switch("-c", name)
    elif name in branches(repo)["local"]:
        repo.git.switch(name)
    else:
        # A remote branch such as origin/feature: make a local tracking branch.
        repo.git.switch("--track", name)


# ---- publish --------------------------------------------------------------------------------

def gh_ready():
    """Whether the GitHub CLI is installed and logged in (enables one-click publish)."""
    gh = shutil.which("gh")
    if not gh:
        return False
    try:
        return subprocess.run([gh, "auth", "status"], capture_output=True, timeout=15).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def publish(repo, url=None, name=None, private=True):
    """Give a local repository a remote and push it.

    With `url`, add it as origin; otherwise create a GitHub repository named
    `name` with the GitHub CLI. Either way the current branch is pushed with -u.
    """
    st = status(repo)
    if not st["hasCommits"]:
        raise ValueError("Make a first commit before publishing.")
    root = repo.working_tree_dir
    if url:
        if "origin" in st["remotes"]:
            repo.git.remote("set-url", "origin", url)
        else:
            repo.git.remote("add", "origin", url)
        return repo.git.push("-u", "origin", "HEAD")
    if not gh_ready():
        raise ValueError("The GitHub CLI (gh) is not installed or not logged in. Paste a repository URL instead.")
    name = (name or os.path.basename(root)).strip()
    cmd = [shutil.which("gh"), "repo", "create", name, "--private" if private else "--public",
           "--source", root, "--remote", "origin", "--push"]
    done = subprocess.run(cmd, capture_output=True, text=True, timeout=300, cwd=root)
    if done.returncode != 0:
        raise ValueError((done.stderr or done.stdout or "gh repo create failed").strip())
    return (done.stdout or "").strip()


# ---- file versions for diffs -----------------------------------------------------------------

def _show(repo, spec):
    try:
        data = repo.git.show(spec, stdout_as_string=False)
    except GitCommandError:
        return None
    return data


def _text(data):
    if data is None:
        return "", False
    if b"\0" in data[:8000]:
        return "", True
    return data.decode("utf-8", errors="replace"), False


def diff(repo, path, staged):
    """Before/after text for a file: HEAD → index when staged, index → working tree otherwise."""
    root = repo.working_tree_dir
    if staged:
        before, b1 = _text(_show(repo, "HEAD:" + path))
        after, b2 = _text(_show(repo, ":" + path))
    else:
        index = _show(repo, ":" + path)
        before, b1 = _text(index if index is not None else _show(repo, "HEAD:" + path))
        full = os.path.join(root, path)
        disk = None
        if os.path.isfile(full):
            with open(full, "rb") as f:
                disk = f.read()
        after, b2 = _text(disk)
    return {"path": path, "before": before, "after": after, "binary": b1 or b2}
