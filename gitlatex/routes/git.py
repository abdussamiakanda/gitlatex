"""Git operations: push, pull, status, history and diffs."""

import datetime
import re
import os

from flask import Blueprint, jsonify, request

from gitlatex import state
from gitlatex.http import with_project_lock
from gitlatex.services import comments
from gitlatex.services.git_backend import NULL_TREE, GitCommandError, Repo
from gitlatex.services.gitrepo import _blob_text, _close_repo, _numstat, _open_repo
from gitlatex.services.paths import resolve_repo_path

bp = Blueprint("git", __name__)


@bp.route("/push", methods=["POST"])
@with_project_lock
def push():
    if not state.current_repo_path:
        return jsonify(error="No repository selected"), 400
    if Repo is None:
        return jsonify(error="GitPython not installed"), 500
    payload = request.get_json(silent=True)
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        return jsonify(error="Expected a JSON object"), 400
    message = payload.get("message", "")
    if not isinstance(message, str):
        return jsonify(error="Commit message must be a string"), 400
    message = message.strip() or datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        repo = Repo(state.current_repo_path)
        try:
            # Stage and commit everything with the supplied message, then push.
            committed = False
            repo.git.add("-A")
            if repo.is_dirty(index=True, working_tree=True, untracked_files=True):
                repo.index.commit(message)
                committed = True
                print("Commit:", message)
            pulled = False
            if not _push(repo):
                # Someone pushed first. Put our commits on top of theirs and
                # try once more, so the common case needs no second click.
                print("Push rejected; pulling first")
                try:
                    _pull_rebase(repo)
                except _Conflict as c:
                    return _conflict_response(c, committed,
                                              "Could not push: someone else pushed changes to the same lines first.")
                pulled = True
                if not _push(repo):
                    return jsonify(
                        error="Could not push: the remote changed again while pushing. Try again.",
                        committed=committed, pulled=True,
                    ), 409
            print("Pushed to origin")
            return jsonify(success=True, committed=committed, pulled=pulled)
        finally:
            if getattr(repo, "close", None):
                try:
                    repo.close()
                except Exception:
                    pass
    except Exception as e:
        return jsonify(error=str(e)), 500


@bp.route("/api/git/commit", methods=["POST"])
@with_project_lock
def commit_all():
    """Stage everything and commit, without pushing (for projects with no remote)."""
    if not state.current_repo_path:
        return jsonify(error="No repository selected"), 400
    if Repo is None:
        return jsonify(error="GitPython not installed"), 500
    # Not _open_repo(): a brand-new repository has no commits yet, and this is
    # how it gets its first one.
    try:
        repo = Repo(state.current_repo_path)
    except Exception as e:
        return jsonify(error=str(e)), 500
    try:
        message = (_json_message() or datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        repo.git.add("-A")
        if not repo.git.status("--porcelain").strip():
            return jsonify(success=True, committed=False)
        c = repo.index.commit(message)
        print("Commit:", message)
        return jsonify(success=True, committed=True, hash=c.hexsha)
    except Exception as e:
        return jsonify(error=str(e)), 500
    finally:
        _close_repo(repo)


@bp.route("/api/git/init", methods=["POST"])
@with_project_lock
def init_repo():
    if not state.current_repo_path:
        return jsonify(error="No repository selected"), 400
    if Repo is None:
        return jsonify(error="GitPython not installed"), 500
    try:
        _close_repo(Repo.init(state.current_repo_path))
        return jsonify(success=True)
    except Exception as e:
        return jsonify(error=str(e)), 500


def _json_message():
    payload = request.get_json(silent=True)
    message = payload.get("message") if isinstance(payload, dict) else None
    return message.strip() if isinstance(message, str) else ""


# What TeX writes next to a document. Committed copies are common (people
# commit main.pdf), and every compile rewrites them locally.
_BUILD_OUTPUT = re.compile(
    r"\.(synctex\.gz|synctex|aux|log|out|toc|lof|lot|fls|fdb_latexmk|bcf|run\.xml|blg|bbl|nav|snm|vrb|xdv)$",
    re.IGNORECASE,
)


def _is_build_output(root, path):
    if _BUILD_OUTPUT.search(path):
        return True
    # A PDF is build output only when it is a document's own PDF (main.pdf next
    # to main.tex); figure PDFs are the user's files.
    if path.lower().endswith(".pdf"):
        return os.path.isfile(os.path.join(root, path[:-4] + ".tex"))
    return False


def _clear_stale_build_outputs(repo):
    """Drop local build outputs that the incoming commits replace.

    Compiling rewrites main.pdf (PDFs embed a timestamp) and writes
    main.synctex.gz, so a project that commits them always looks modified, and
    `git pull` refuses to overwrite them. They are regenerated by the next
    compile anyway, so the remote's copies win. Only files the remote actually
    changes are touched; the user's own edits are left to --autostash.
    Returns the paths cleared.
    """
    try:
        if not repo.remotes or repo.head.is_detached or repo.active_branch.tracking_branch() is None:
            return []
        repo.git.fetch("--quiet")
        incoming = repo.git.diff("--name-only", "HEAD...@{u}").splitlines()
    except (GitCommandError, TypeError, ValueError):
        return []
    root = repo.working_tree_dir
    modified = set(repo.git.diff("--name-only").splitlines()) | set(repo.git.diff("--name-only", "--cached").splitlines())
    untracked = set(repo.untracked_files)
    cleared = []
    for path in incoming:
        if not _is_build_output(root, path):
            continue
        try:
            if path in modified:
                repo.git.checkout("HEAD", "--", path)
                cleared.append(path)
            elif path in untracked:
                os.remove(os.path.join(root, path))
                cleared.append(path)
        except (GitCommandError, OSError) as e:
            print("Could not clear", path, e)
    return cleared


class _Conflict(Exception):
    def __init__(self, files):
        super().__init__(", ".join(files))
        self.files = files


def _push(repo):
    """Push the current branch. False if the remote has commits we don't have yet.

    GitPython reports a rejected push in the result rather than raising.
    """
    result = repo.remotes.origin.push()
    if any(info.flags & info.REJECTED for info in result):
        return False
    failed = [info for info in result if info.flags & (info.REMOTE_REJECTED | info.ERROR)]
    if failed:
        raise RuntimeError("Push failed: " + (failed[0].summary or "").strip())
    if result.error is not None and not len(result):
        raise result.error
    return True


def _rebase_in_progress(repo):
    return any(os.path.isdir(os.path.join(repo.git_dir, d)) for d in ("rebase-merge", "rebase-apply"))


def _unmerged(repo):
    return [f for f in repo.git.diff("--name-only", "--diff-filter=U").splitlines() if f]


def _pull_rebase(repo):
    """`git pull --rebase --autostash`, never leaving the project half-merged.

    Rebase rather than merge: local commits go on top of the remote's, with no
    "Merge branch" commit every time two people work at once. Comment threads
    merge through their merge driver. Conflicts only in build output (main.pdf,
    main.synctex.gz…) keep the local copy, since the next compile rewrites it
    anyway. Any other conflict undoes the whole pull, restores the user's
    uncommitted edits, and raises _Conflict with the files involved.
    """
    root = repo.working_tree_dir
    comments.install_merge_driver(root)
    before = repo.head.commit.hexsha if repo.head.is_valid() else None
    try:
        output = repo.git.pull("--rebase", "--autostash")
    except GitCommandError:
        if not _rebase_in_progress(repo):
            raise
    else:
        # The pull itself worked, but putting back uncommitted edits that touch
        # the same lines leaves conflict markers in the user's files (and git
        # still exits 0). Go back to before the pull, edits and all.
        files = _unmerged(repo)
        if files and before and repo.git.stash("list", "-1", "--format=%gs") == "autostash":
            repo.git.reset("--hard", before)
            repo.git.stash("pop")
            raise _Conflict(files)
        return output
    while _rebase_in_progress(repo):
        files = _unmerged(repo)
        if not files or not all(_is_build_output(root, f) for f in files):
            repo.git.rebase("--abort")
            raise _Conflict(files)
        # During a rebase "theirs" is the local commit being replayed.
        repo.git.checkout("--theirs", "--", *files)
        repo.git.add("--", *files)
        try:
            repo.git.rebase("--continue", env={"GIT_EDITOR": "true"})
        except GitCommandError:
            pass  # the next commit stopped too; look again
    return "Pulled with rebase."


def _conflict_response(conflict, committed, headline):
    """409 for a pull that was undone because of conflicting edits."""
    files = conflict.files
    listed = ", ".join(files) if files else "some files"
    kept = "Your commit is saved here but not pushed yet." if committed else "Nothing was changed on your side."
    return jsonify(
        error="%s Changed on both sides: %s. %s Resolve it in a terminal with `git pull --rebase`, "
              "or agree with your coauthor which version to keep." % (headline, listed, kept),
        conflicts=files, committed=committed,
    ), 409


@bp.route("/pull", methods=["POST"])
@with_project_lock
def pull():
    if not state.current_repo_path:
        return jsonify(error="No repository selected"), 400
    if Repo is None:
        return jsonify(error="GitPython not installed"), 500
    try:
        repo = Repo(state.current_repo_path)
        try:
            before = repo.head.commit.hexsha if repo.head.is_valid() else None
            cleared = _clear_stale_build_outputs(repo)
            try:
                output = _pull_rebase(repo)
            except _Conflict as c:
                return _conflict_response(c, False, "Could not pull: you and the remote changed the same lines.")
            after = repo.head.commit.hexsha if repo.head.is_valid() else None
            print("Pulled from origin" + (" (replaced local build output: %s)" % ", ".join(cleared) if cleared else ""))
            return jsonify(success=True, output=output, changed=before != after, cleared=cleared)
        finally:
            if getattr(repo, "close", None):
                try:
                    repo.close()
                except Exception:
                    pass
    except Exception as e:
        return jsonify(error=str(e)), 500


@bp.route("/remote-status")
def remote_status():
    """Fetch from origin and report how far the branch is behind/ahead."""
    if not state.current_repo_path:
        return jsonify(error="No repository selected"), 400
    if Repo is None:
        return jsonify(error="GitPython not installed"), 500
    try:
        repo = Repo(state.current_repo_path)
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


@bp.route("/status")
def status():
    if not state.current_repo_path:
        return jsonify(error="No repository selected"), 400
    if Repo is None:
        return jsonify(error="GitPython not installed"), 500
    try:
        repo = Repo(state.current_repo_path)
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


@bp.route("/commits")
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


@bp.route("/commit-files")
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


@bp.route("/working-files")
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


@bp.route("/working-file")
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


@bp.route("/compare-files")
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


@bp.route("/compare-file")
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


@bp.route("/commit-file")
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


@bp.route("/diff")
def diff():
    if not state.current_repo_path:
        return jsonify(error="No repository selected"), 400
    if Repo is None:
        return jsonify(error="GitPython not installed"), 500
    try:
        repo = Repo(state.current_repo_path)
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
