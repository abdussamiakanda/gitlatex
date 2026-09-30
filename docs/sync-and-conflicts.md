# Syncing with coauthors: push, pull and conflicts

gitlatex projects are shared through Git, so two people working at once
eventually change the same thing. This page covers what the app does
automatically when that happens, what it reports when it can't, and how to fix
the rest by hand.

- **Push** commits everything and uploads it. If a coauthor pushed first, the
  app pulls their commits in, puts yours on top, and pushes again.
- **Pull** downloads the remote's commits and rebases your unpushed commits on
  top of them. Uncommitted edits are set aside and put back afterwards.
- **Review comments** replied to on both sides are combined, never conflicted.
- **A real conflict** (both of you changed the same lines of a `.tex` file) is
  never left half-done: the app undoes the pull, puts the project back as it
  was, and lists the files involved.

The code lives in `gitlatex/routes/git.py` (push and pull),
`gitlatex/services/comments.py` and `gitlatex/services/comments_merge.py`
(review comment threads). Tests are in `tests/test_sync.py`.

## Two people, one remote

Alice commits but doesn't push. Meanwhile Bob pushes:

```
remote:  X ── B
Alice:   X ── A      (committed, not pushed)
```

Alice's push can't simply go through: it would throw away Bob's commit, so Git
rejects it (`[rejected] (fetch first)`). Nothing is lost; Alice has to take
Bob's commit first.

### What Push does

1. Stages and commits everything (`git add -A`, then commit with your message).
2. Pushes. If the remote rejects it because it has newer commits:
3. Pulls with rebase (see below), so the history becomes `X ── B ── A`.
4. Pushes again.

When the two of you changed different parts of the project, one click does
all of it. The toast says *"Your coauthors' newer changes were pulled in
first"*, and the editor reloads the files that changed.

If step 3 hits a real conflict, the push stops with **409** and a message like:

> Could not push: someone else pushed changes to the same lines first. Changed
> on both sides: main.tex. Your commit is saved here but not pushed yet.

Your commit stays in your local history, and the project is exactly as it was
before you pressed Push.

If someone pushes again between steps 3 and 4, the push stops with *"the
remote changed again while pushing. Try again."*

### What Pull does

Pull runs `git pull --rebase --autostash`:

- **`--rebase`**: your unpushed commits go on top of the remote's, with no
  "Merge branch …" commit every time two people work at once.
- **`--autostash`**: uncommitted edits are set aside before the pull and put
  back afterwards.

A pull is always either finished or fully undone, never left half-merged:

| Situation | Result |
| --- | --- |
| Different lines changed | Pulled. Your commits sit on top of the remote's. |
| Same lines changed in **commits** | Rebase aborted. 409 listing the files. |
| Same lines changed by **uncommitted** edits | Pull undone and your edits restored. 409 listing the files. |
| Only build output conflicts (`main.pdf`, `main.synctex.gz`, `.aux`, …) | Your copy is kept and the pull finishes. The next compile rewrites it anyway. |
| Review comment threads changed on both sides | Merged automatically (see below). |

## Review comments

Each review thread is one JSON file in `.gitlatex/comments/<id>.json`, and a
reply appends to that file's `messages` list. So if Alice and Bob both reply to
the same thread before syncing, both change the end of the same list, and a
plain Git merge always conflicts there.

### The merge driver

`gitlatex/services/comments_merge.py` is a
[Git merge driver](https://git-scm.com/docs/gitattributes#_defining_a_custom_merge_driver):
Git runs it instead of its usual line-by-line merge whenever both sides changed
the same thread file. It merges the fields like this:

| Field | Rule |
| --- | --- |
| `messages` | Union of both sides by `id`, sorted by `date`; the opening message stays first. A message in the common ancestor that one side no longer has was deleted there, so it stays deleted. |
| `resolved`, `resolvedBy`, `resolvedAt` | Treated as one change. The side that changed it wins; if both did, the later `resolvedAt` wins. |
| `range`, `quote`, `file` | The side that changed it wins, otherwise ours. The editor finds the text again from `quote` after a pull anyway. |
| Anything that isn't valid JSON | The driver exits with 1 and Git falls back to a normal conflict. |

### How it is registered

`comments.install_merge_driver()` runs whenever a project is opened, selected
or cloned, and before every pull. It writes two things, both inside the
project's own `.git` folder, so nothing new shows up in the project's files or
commits:

```ini
# .git/config
[merge "gitlatex-comments"]
    name = gitlatex review comment threads
    driver = '/path/to/python' '/path/to/gitlatex/services/comments_merge.py' %O %A %B
```

```
# .git/info/attributes
.gitlatex/comments/*.json merge=gitlatex-comments
```

A merge driver is a command on one machine, so it can't be shared through the
repository: each copy of the project sets up its own. Once registered, it also
works for `git pull` and `git merge` in a terminal. If the app is moved or
reinstalled, the next time a project is opened the command is updated.

### Threads with conflict markers

A thread file can still end up with `<<<<<<<` markers, for example from a merge
made on a machine without the app. Such a file isn't valid JSON. It used to be
skipped without a word, so the thread just disappeared from the panel. Now the
panel shows a yellow card in its place, *"This thread has a merge conflict"*,
with the path of the file. Renaming the commented file leaves the conflicted
thread file untouched.

## Fixing a conflict by hand

The app has no screen for resolving conflicts in `.tex` files yet. When it
reports one, open a terminal in the project folder:

```sh
git pull --rebase          # stops at the first conflict
git status                 # lists the files marked "both modified"
```

In each file, choose what to keep between the markers, then delete the marker
lines:

```latex
<<<<<<< HEAD
Bob's version of the paragraph.
=======
Alice's version of the paragraph.
>>>>>>> Alice's commit
```

During a rebase, the `HEAD` side is the remote (Bob), and the other side is
your commit being replayed. Then:

```sh
git add main.tex
git rebase --continue      # repeat for each stopped commit
git push
```

`git rebase --abort` goes back to where you started at any point.

**A conflicted comment thread** (only possible without the merge driver):
merge the two `messages` lists, keeping every message from both sides in date
order. Check the commas between entries and remove the marker lines. Take
`range` and `quote` from either side.

```json
"messages": [
  { "id": "a1…", "author": "Alice", "date": "2026-09-29T10:00:00", "text": "Is this right?" },
  { "id": "b2…", "author": "Bob",   "date": "2026-09-29T11:00:00", "text": "Yes" },
  { "id": "c3…", "author": "Alice", "date": "2026-09-29T11:05:00", "text": "Also check eq. 3" }
]
```

## What changed

Before these changes:

- **Push reported success when the push was rejected.** GitPython reports a
  rejected push in its result instead of raising, and the result wasn't
  checked. The commit never reached the remote, and nobody was told.
- **Pull failed when both sides had new commits**, with *"Need to specify how
  to reconcile divergent branches"* (Git 2.27 and later, when `pull.rebase`
  isn't set).
- **Uncommitted edits on the same lines** as incoming changes left conflict
  markers inside the `.tex` file, while the pull reported success.
- **Replies on both sides of a comment thread** always conflicted, and the
  thread then disappeared from the review panel.

| File | Change |
| --- | --- |
| `gitlatex/routes/git.py` | `_push()` detects rejected pushes. `_pull_rebase()` pulls with rebase, keeps local build output, and undoes anything that conflicts. Push retries after pulling. Conflicts return 409 with a `conflicts` list. |
| `gitlatex/services/comments_merge.py` | New: the merge driver for comment threads. |
| `gitlatex/services/comments.py` | `install_merge_driver()`. Conflicted thread files are listed as placeholders instead of being skipped. |
| `gitlatex/routes/repos.py`, `gitlatex/routes/workspace.py` | Register the merge driver when a project is opened, selected or cloned. |
| `web/src/storage/server.ts`, `web/src/state/actions.ts` | Push reports `pulled`. The editor reloads and says so. |
| `web/src/editor/review.ts`, `web/src/editor/review.css` | The merge-conflict card in the review panel. |
| `tests/test_sync.py` | New: unit tests for the merge driver, and two-clone tests of push and pull through the app. |

Run the tests with:

```sh
python3 -m unittest discover tests
```

The classic editor at `/classic` shows the new push and pull messages, but its
review panel doesn't have the merge-conflict card.
