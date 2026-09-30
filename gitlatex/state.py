"""Process-wide server state.

These values are genuinely global to a running server: which repos folder
is being served, which project the user has selected, the last compile error,
and the lock that serializes changes to project files. Route modules import
this module and read `state.x` rather than importing the names directly, so
everyone sees the same value after a rebind.
"""

import threading

# Absolute path of the repos folder, set once at startup by create_app().
BASE_DIR = None

# Absolute path of the project the user has selected, or None.
current_repo_path = None

# Message from the most recent failed compile, surfaced by /compile-error.
last_compile_error = None

# Held by everything that changes a project's files: Git (pull, push, commit),
# compiles, PDF saves and the editor's writes. A PDF saved in the middle of a
# pull would otherwise be caught by --autostash and conflict when it is put back.
project_lock = threading.RLock()


def repo_selected():
    return current_repo_path is not None


def repo_name():
    """Folder name of the selected project, or None."""
    import os
    return os.path.basename(current_repo_path) if current_repo_path else None
