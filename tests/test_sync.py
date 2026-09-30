"""Two people working on one project: push, pull and review comment merges.

Each test builds a bare "remote" and two clones, A and B, and drives the
app's /push and /pull routes as each person in turn.

    python -m unittest discover tests
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from gitlatex import state  # noqa: E402
from gitlatex.app import create_app  # noqa: E402
from gitlatex.services import comments, comments_merge  # noqa: E402


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


class MergeDriverTest(unittest.TestCase):
    def thread(self, *messages, **extra):
        t = {"id": "t1", "file": "main.tex", "range": {"startLine": 1}, "quote": "x", "resolved": False,
             "messages": [{"id": m, "date": "2026-09-29T10:0%d:00" % i, "text": m} for i, m in enumerate(messages)]}
        t.update(extra)
        return t

    def ids(self, t):
        return [m["id"] for m in t["messages"]]

    def test_both_reply(self):
        base = self.thread("a")
        ours = self.thread("a", "b")
        theirs = self.thread("a", "c")
        theirs["messages"][1]["date"] = "2026-09-29T10:00:30"  # c was written before b
        self.assertEqual(self.ids(comments_merge.merge(base, ours, theirs)), ["a", "c", "b"])

    def test_deleted_reply_stays_deleted(self):
        base = self.thread("a", "b")
        ours = self.thread("a")  # we deleted b
        theirs = self.thread("a", "b", "c")
        self.assertEqual(self.ids(comments_merge.merge(base, ours, theirs)), ["a", "c"])

    def test_later_resolution_wins(self):
        base = self.thread("a")
        ours = self.thread("a", resolved=True, resolvedBy="A", resolvedAt="2026-09-29T11:00:00")
        theirs = self.thread("a", resolved=True, resolvedBy="B", resolvedAt="2026-09-29T12:00:00")
        self.assertEqual(comments_merge.merge(base, ours, theirs)["resolvedBy"], "B")

    def test_one_side_reopens(self):
        base = self.thread("a", resolved=True, resolvedBy="A", resolvedAt="2026-09-29T11:00:00")
        ours = self.thread("a", "b")  # replied, did not touch resolution
        theirs = self.thread("a")  # reopened
        merged = comments_merge.merge(base, ours, theirs)
        self.assertFalse(merged["resolved"])
        self.assertNotIn("resolvedBy", merged)
        self.assertEqual(self.ids(merged), ["a", "b"])

    def test_moved_range_kept(self):
        base = self.thread("a")
        ours = self.thread("a", "b")
        theirs = self.thread("a", range={"startLine": 9}, quote="y")
        merged = comments_merge.merge(base, ours, theirs)
        self.assertEqual((merged["range"], merged["quote"]), ({"startLine": 9}, "y"))

    def test_bad_json_exits_nonzero(self):
        with tempfile.TemporaryDirectory() as d:
            paths = [os.path.join(d, n) for n in ("o", "a", "b")]
            write(paths[0], "{}")
            write(paths[1], "<<<<<<< ours\n")
            write(paths[2], json.dumps(self.thread("a")))
            self.assertEqual(comments_merge.main(["x"] + paths), 1)


class TwoPeopleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Keep the developer's own git config (pull.rebase, hooks…) out of it.
        cls._env = {k: os.environ.get(k) for k in ("GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM")}
        cls._tmp = tempfile.TemporaryDirectory()
        empty = os.path.join(cls._tmp.name, "gitconfig")
        write(empty, "")
        os.environ["GIT_CONFIG_GLOBAL"] = empty
        os.environ["GIT_CONFIG_NOSYSTEM"] = "1"
        cls.app = create_app(os.path.join(cls._tmp.name, "repos"))
        cls.client = cls.app.test_client()

    @classmethod
    def tearDownClass(cls):
        for k, v in cls._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        cls._tmp.cleanup()

    def setUp(self):
        self.dir = tempfile.mkdtemp(dir=self._tmp.name)
        remote = os.path.join(self.dir, "remote.git")
        git(self.dir, "init", "-q", "--bare", "-b", "main", remote)
        self.a = self.clone(remote, "a", "Alice")
        write(os.path.join(self.a, "main.tex"), "one\ntwo\nthree\nfour\nfive\n")
        git(self.a, "add", "-A")
        git(self.a, "commit", "-qm", "init")
        git(self.a, "push", "-q", "-u", "origin", "main")
        self.b = self.clone(remote, "b", "Bob")

    def clone(self, remote, name, user):
        path = os.path.join(self.dir, name)
        git(self.dir, "clone", "-q", remote, path)
        git(path, "config", "user.name", user)
        git(path, "config", "user.email", user.lower() + "@example.com")
        comments.install_merge_driver(path)
        return path

    def as_(self, path):
        state.current_repo_path = path

    def edit(self, repo, find, replace):
        p = os.path.join(repo, "main.tex")
        write(p, read(p).replace(find, replace))

    def push(self, repo, message="edit"):
        self.as_(repo)
        return self.client.post("/push", json={"message": message})

    def pull(self, repo):
        self.as_(repo)
        return self.client.post("/pull")

    def log(self, repo):
        return git(repo, "log", "--format=%s", "origin/main").split()

    def test_rejected_push_pulls_and_retries(self):
        self.edit(self.b, "five", "FIVE")
        self.assertEqual(self.push(self.b, "bob").status_code, 200)
        self.edit(self.a, "one", "ONE")  # different lines
        res = self.push(self.a, "alice")
        self.assertEqual(res.status_code, 200, res.get_json())
        self.assertTrue(res.get_json()["pulled"])
        self.assertEqual(self.log(self.a), ["alice", "bob", "init"])  # rebased, no merge commit
        self.assertEqual(read(os.path.join(self.a, "main.tex")), "ONE\ntwo\nthree\nfour\nFIVE\n")

    def test_conflicting_push_is_undone_and_reported(self):
        self.edit(self.b, "three", "bob's three")
        self.push(self.b, "bob")
        self.edit(self.a, "three", "alice's three")
        res = self.push(self.a, "alice")
        self.assertEqual(res.status_code, 409)
        body = res.get_json()
        self.assertEqual(body["conflicts"], ["main.tex"])
        self.assertTrue(body["committed"])
        self.assertFalse(os.path.isdir(os.path.join(self.a, ".git", "rebase-merge")))
        self.assertEqual(git(self.a, "log", "-1", "--format=%s"), "alice\n")  # commit kept locally
        self.assertIn("alice's three", read(os.path.join(self.a, "main.tex")))

    def test_pull_with_local_commit_and_uncommitted_edit(self):
        self.edit(self.b, "five", "FIVE")
        self.push(self.b, "bob")
        self.edit(self.a, "one", "ONE")
        git(self.a, "commit", "-qam", "alice")  # committed, not pushed
        self.edit(self.a, "three", "THREE")  # and not even committed
        res = self.pull(self.a)
        self.assertEqual(res.status_code, 200, res.get_json())
        self.assertEqual(read(os.path.join(self.a, "main.tex")), "ONE\ntwo\nTHREE\nfour\nFIVE\n")
        self.assertEqual(git(self.a, "log", "--format=%s").split(), ["alice", "bob", "init"])

    def test_uncommitted_edit_on_same_line_is_restored(self):
        self.edit(self.b, "three", "bob's three")
        self.push(self.b, "bob")
        self.edit(self.a, "three", "alice's unsaved three")
        res = self.pull(self.a)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.get_json()["conflicts"], ["main.tex"])
        # Back exactly as before the pull: her edit, no markers, nothing stashed.
        self.assertEqual(read(os.path.join(self.a, "main.tex")), "one\ntwo\nalice's unsaved three\nfour\nfive\n")
        self.assertEqual(git(self.a, "stash", "list"), "")
        self.assertEqual(git(self.a, "log", "-1", "--format=%s"), "init\n")

    def test_committed_pdf_conflict_keeps_local_copy(self):
        write(os.path.join(self.b, "main.pdf"), "bob's build")
        self.push(self.b, "bob")
        write(os.path.join(self.a, "main.pdf"), "alice's build")
        res = self.push(self.a, "alice")
        self.assertEqual(res.status_code, 200, res.get_json())
        self.assertEqual(read(os.path.join(self.a, "main.pdf")), "alice's build")

    def test_replies_on_both_sides_merge(self):
        # Alice comments and pushes; Bob pulls and replies; Alice replies
        # without pulling. Her push has to combine both replies.
        thread = comments.create_thread(self.a, "main.tex", {"startLine": 2, "startColumn": 1, "endLine": 2, "endColumn": 4},
                                        "two", "Is this right?")
        self.push(self.a, "comment")
        self.pull(self.b)
        comments.reply(self.b, thread["id"], "Yes")
        self.push(self.b, "bob reply")
        comments.reply(self.a, thread["id"], "Also check eq. 3")
        res = self.push(self.a, "alice reply")
        self.assertEqual(res.status_code, 200, res.get_json())
        merged = comments.list_threads(self.a, "main.tex")[0]
        self.assertEqual([m["text"] for m in merged["messages"]], ["Is this right?", "Yes", "Also check eq. 3"])
        self.assertNotIn("conflict", merged)

    def test_conflicted_thread_is_shown_not_hidden(self):
        folder = os.path.join(self.a, ".gitlatex", "comments")
        write(os.path.join(folder, "abc123.json"),
              '<<<<<<< HEAD\n{"id": "abc123", "file": "main.tex", "range": {"startLine": 3}}\n=======\n{}\n>>>>>>> x\n')
        [stub] = comments.list_threads(self.a, "main.tex")
        self.assertTrue(stub["conflict"])
        self.assertEqual((stub["id"], stub["range"]["startLine"]), ("abc123", 3))
        self.assertEqual(stub["path"], ".gitlatex/comments/abc123.json")
        # Renaming the file must not overwrite the conflicted thread with the placeholder.
        comments.move_file(self.a, "main.tex", "renamed.tex")
        self.assertIn("<<<<<<<", read(os.path.join(folder, "abc123.json")))


if __name__ == "__main__":
    unittest.main()
