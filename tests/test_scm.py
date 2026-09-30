"""The Source control panel's API (/api/scm/*): staging, commits, and conflicts
left in place to resolve in the editor (unlike /pull and /push, which undo them).

Each test builds a bare "remote" and two clones, A and B, like test_sync.py.

    python -m unittest discover tests
"""

import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from gitlatex import state  # noqa: E402
from gitlatex.app import create_app  # noqa: E402
from gitlatex.services import comments  # noqa: E402


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


class ScmTest(unittest.TestCase):
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
        self.remote = os.path.join(self.dir, "remote.git")
        git(self.dir, "init", "-q", "--bare", "-b", "main", self.remote)
        self.a = self.clone("a", "Alice")
        write(os.path.join(self.a, "main.tex"), "one\ntwo\nthree\nfour\nfive\n")
        write(os.path.join(self.a, "notes.txt"), "notes\n")
        git(self.a, "add", "-A")
        git(self.a, "commit", "-qm", "init")
        git(self.a, "push", "-q", "-u", "origin", "main")
        self.b = self.clone("b", "Bob")

    def clone(self, name, user):
        path = os.path.join(self.dir, name)
        git(self.dir, "clone", "-q", self.remote, path)
        git(path, "config", "user.name", user)
        git(path, "config", "user.email", user.lower() + "@example.com")
        comments.install_merge_driver(path)
        return path

    # ---- helpers ----

    def api(self, repo, route, **body):
        state.current_repo_path = repo
        res = self.client.post("/api/scm/" + route, json=body)
        return res.status_code, res.get_json()

    def status(self, repo):
        state.current_repo_path = repo
        return self.client.get("/api/scm/status").get_json()

    def edit(self, repo, find, replace, name="main.tex"):
        p = os.path.join(repo, name)
        write(p, read(p).replace(find, replace))

    def bob_pushes(self, find, replace):
        git(self.b, "pull", "-q")
        self.edit(self.b, find, replace)
        git(self.b, "commit", "-qam", "bob")
        git(self.b, "push", "-q")

    def paths(self, files):
        return sorted(f["path"] for f in files)

    # ---- staging and commits ----

    def test_stage_unstage_discard_and_smart_commit(self):
        self.edit(self.a, "two", "TWO")
        write(os.path.join(self.a, "new.tex"), "new\n")
        os.remove(os.path.join(self.a, "notes.txt"))
        st = self.status(self.a)
        self.assertEqual({(f["path"], f["status"]) for f in st["changes"]}, {("main.tex", "M"), ("new.tex", "?"), ("notes.txt", "D")})
        _, r = self.api(self.a, "stage", paths=["main.tex", "new.tex"])
        self.assertEqual(self.paths(r["status"]["staged"]), ["main.tex", "new.tex"])
        _, r = self.api(self.a, "unstage", paths=["new.tex"])
        self.assertEqual(self.paths(r["status"]["staged"]), ["main.tex"])
        self.api(self.a, "discard", paths=["notes.txt", "new.tex"])
        self.assertTrue(os.path.exists(os.path.join(self.a, "notes.txt")))
        self.assertFalse(os.path.exists(os.path.join(self.a, "new.tex")))
        code, r = self.api(self.a, "commit", message="stage only")
        self.assertEqual(code, 200, r)
        self.assertEqual(git(self.a, "show", "--name-only", "--format=", "HEAD").split(), ["main.tex"])
        self.edit(self.a, "four", "FOUR")
        code, r = self.api(self.a, "commit", message="smart")
        self.assertEqual((code, r["status"]["ahead"]), (200, 2))
        code, r = self.api(self.a, "commit", message="again")
        self.assertEqual(code, 400)
        self.assertIn("nothing", r["error"].lower())

    # ---- conflicts left for the editor ----

    def test_pull_rebase_conflict_is_kept_then_continued(self):
        self.bob_pushes("three", "bob's three")
        self.edit(self.a, "three", "alice's three")
        git(self.a, "commit", "-qam", "alice")
        code, r = self.api(self.a, "pull")
        self.assertEqual(code, 200, r)
        self.assertEqual(r["conflicts"], ["main.tex"])
        st = r["status"]
        self.assertEqual(st["inProgress"], "rebase")
        self.assertEqual((st["branch"], st["detached"], st["upstream"]), ("main", False, "origin/main"))  # not "detached HEAD"
        self.assertEqual(st["sides"]["incoming"], "Your version")
        text = read(os.path.join(self.a, "main.tex"))
        self.assertIn("<<<<<<<", text)
        self.assertIn("bob's three", text)
        self.assertIn("alice's three", text)
        code, r = self.api(self.a, "commit", message="")
        self.assertEqual(code, 400)  # conflicts first
        # In a rebase, "incoming" is Alice's own commit.
        _, r = self.api(self.a, "resolve", path="main.tex", side="incoming")
        self.assertEqual(r["status"]["conflicts"], [])
        code, r = self.api(self.a, "commit", message="")
        self.assertEqual(code, 200, r)
        self.assertIsNone(r["status"]["inProgress"])
        self.assertEqual(git(self.a, "log", "--format=%s").split(), ["alice", "bob", "init"])  # linear, no merge commit
        self.assertIn("alice's three", read(os.path.join(self.a, "main.tex")))
        code, r = self.api(self.a, "push")
        self.assertEqual((code, r["status"]["ahead"]), (200, 0))

    def test_abort_rebase_restores_everything(self):
        self.bob_pushes("three", "bob's three")
        self.edit(self.a, "three", "alice's three")
        git(self.a, "commit", "-qam", "alice")
        self.api(self.a, "pull")
        _, r = self.api(self.a, "abort")
        self.assertIsNone(r["status"]["inProgress"])
        self.assertEqual(r["status"]["conflicts"], [])
        self.assertEqual(git(self.a, "log", "-1", "--format=%s"), "alice\n")
        self.assertIn("alice's three", read(os.path.join(self.a, "main.tex")))

    def test_uncommitted_edit_conflict_is_kept_then_resolved(self):
        self.bob_pushes("three", "bob's three")
        self.edit(self.a, "three", "alice's unsaved three")
        code, r = self.api(self.a, "pull")
        self.assertEqual((code, r["conflicts"]), (200, ["main.tex"]))
        self.assertEqual(r["status"]["inProgress"], "autostash")
        self.assertIn("<<<<<<<", read(os.path.join(self.a, "main.tex")))
        # She merges the two lines by hand and marks the file resolved.
        write(os.path.join(self.a, "main.tex"), "one\ntwo\nbob's and alice's three\nfour\nfive\n")
        _, r = self.api(self.a, "mark-resolved", path="main.tex")
        st = r["status"]
        self.assertIsNone(st["inProgress"])
        self.assertEqual((st["conflicts"], st["staged"]), ([], []))
        self.assertEqual(self.paths(st["changes"]), ["main.tex"])  # an uncommitted edit again
        self.assertEqual(git(self.a, "stash", "list"), "")  # the autostash is gone
        self.assertEqual(git(self.a, "log", "-1", "--format=%s"), "bob\n")

    def test_abort_uncommitted_edit_conflict_goes_back_to_before_the_pull(self):
        self.bob_pushes("three", "bob's three")
        self.edit(self.a, "three", "alice's unsaved three")
        self.api(self.a, "pull")
        _, r = self.api(self.a, "abort")
        self.assertIsNone(r["status"]["inProgress"])
        self.assertEqual(read(os.path.join(self.a, "main.tex")), "one\ntwo\nalice's unsaved three\nfour\nfive\n")
        self.assertEqual(git(self.a, "log", "-1", "--format=%s"), "init\n")
        self.assertEqual(git(self.a, "stash", "list"), "")

    def test_rejected_push_with_conflict_stops_for_the_editor(self):
        self.bob_pushes("three", "bob's three")
        self.edit(self.a, "three", "alice's three")
        git(self.a, "commit", "-qam", "alice")
        code, r = self.api(self.a, "push")
        self.assertEqual(code, 200, r)
        self.assertTrue(r["pulled"])
        self.assertEqual(r["conflicts"], ["main.tex"])
        self.assertEqual(r["status"]["inProgress"], "rebase")
        self.assertEqual(git(self.remote, "log", "-1", "--format=%s", "main"), "bob\n")  # nothing pushed

    def test_rejected_push_without_conflict_pulls_and_pushes(self):
        self.bob_pushes("five", "FIVE")
        self.edit(self.a, "one", "ONE")
        git(self.a, "commit", "-qam", "alice")
        code, r = self.api(self.a, "push")
        self.assertEqual((code, r["pulled"], r["conflicts"]), (200, True, []))
        self.assertEqual(git(self.remote, "log", "--format=%s", "main").split(), ["alice", "bob", "init"])

    def test_build_output_conflict_is_settled_and_only_real_files_listed(self):
        git(self.b, "pull", "-q")
        write(os.path.join(self.b, "main.pdf"), "bob's build")
        self.edit(self.b, "three", "bob's three")
        git(self.b, "add", "-A")
        git(self.b, "commit", "-qm", "bob")
        git(self.b, "push", "-q")
        write(os.path.join(self.a, "main.pdf"), "alice's build")
        self.edit(self.a, "three", "alice's three")
        git(self.a, "add", "-A")
        git(self.a, "commit", "-qm", "alice")
        _, r = self.api(self.a, "pull")
        self.assertEqual(r["conflicts"], ["main.tex"])
        self.assertEqual(read(os.path.join(self.a, "main.pdf")), "alice's build")

    # ---- branches and publishing ----

    def test_branch_create_publish_and_switch(self):
        _, r = self.api(self.a, "checkout", name="draft", create=True)
        self.assertEqual((r["status"]["branch"], r["status"]["upstream"]), ("draft", None))
        _, r = self.api(self.a, "push")
        self.assertEqual(r["status"]["upstream"], "origin/draft")
        _, r = self.api(self.a, "checkout", name="main")
        self.assertEqual(r["status"]["branch"], "main")
        state.current_repo_path = self.a
        branches = self.client.get("/api/scm/branches").get_json()
        self.assertIn("draft", branches["local"])
        self.assertIn("origin/draft", branches["remote"])

    def test_publish_local_repository_to_a_url(self):
        local = os.path.join(self.dir, "local")
        os.makedirs(local)
        git(local, "init", "-q", "-b", "main")
        git(local, "config", "user.name", "Alice")
        git(local, "config", "user.email", "alice@example.com")
        write(os.path.join(local, "main.tex"), "hello\n")
        st = self.status(local)
        self.assertEqual((st["hasCommits"], st["remotes"]), (False, []))
        code, r = self.api(local, "publish", url=os.path.join(self.dir, "x.git"))
        self.assertEqual(code, 400)
        self.assertIn("commit", r["error"].lower())
        self.api(local, "commit", message="first")
        target = os.path.join(self.dir, "published.git")
        git(self.dir, "init", "-q", "--bare", target)
        code, r = self.api(local, "publish", url=target)
        self.assertEqual(code, 200, r)
        self.assertEqual(r["status"]["upstream"], "origin/main")
        self.assertEqual(git(target, "log", "--format=%s", "main"), "first\n")


if __name__ == "__main__":
    unittest.main()
