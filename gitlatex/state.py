"""Process-wide server state.

These three values are genuinely global to a running server: which repos
folder is being served, which project the user has selected, and the last
compile error. Route modules import this module and read `state.x` rather
than importing the names directly, so everyone sees the same value after a
rebind.
"""

# Absolute path of the repos folder, set once at startup by create_app().
BASE_DIR = None

# Absolute path of the project the user has selected, or None.
current_repo_path = None

# Message from the most recent failed compile, surfaced by /compile-error.
last_compile_error = None


def repo_selected():
    return current_repo_path is not None


def repo_name():
    """Folder name of the selected project, or None."""
    import os
    return os.path.basename(current_repo_path) if current_repo_path else None
