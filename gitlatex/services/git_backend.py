"""GitPython imports, isolated so the rest of the app need not care.

GitPython is a hard dependency in practice, but importing it in one place
means a broken or missing install degrades to clear API errors instead of an
import crash at startup.
"""

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

__all__ = ["Repo", "NULL_TREE", "GitCommandError", "git_rmtree"]
