"""Command line entry point for the GitLaTeX server.

The application itself is assembled in gitlatex/app.py; this module only deals
with starting it. `gitlatex` on the command line lands in main() below.
"""

import argparse
import sys
import threading
import time


def _check_dependencies():
    """Exit with a clear message if required packages are not installed."""
    missing = []
    try:
        import flask  # noqa: F401
    except ImportError:
        missing.append("flask")
    try:
        import git  # noqa: F401
    except ImportError:
        missing.append("gitpython")
    if missing:
        print("Missing required packages:", ", ".join(missing))
        print("Install with:  pip install -e .")
        print("Or:           pip install flask gitpython")
        sys.exit(1)


_check_dependencies()

from gitlatex.app import create_app  # noqa: E402  (after the dependency check)


def run_server(host="127.0.0.1", port=5000, open_browser=True, repos_dir=None):
    app = create_app(repos_dir=repos_dir)
    url = f"http://{host}:{port}"

    if open_browser:
        def open_later():
            time.sleep(1.2)
            import webbrowser
            webbrowser.open(url)
        threading.Thread(target=open_later, daemon=True).start()

    print(f"GitLaTeX IDE is running on {url}")
    app.run(host=host, port=port, threaded=True, use_reloader=False)


def main():
    parser = argparse.ArgumentParser(
        description="GitLaTeX IDE - A simple UI for LaTeX projects with Git support."
    )
    parser.add_argument("--port", "-p", type=int, default=5000, help="Port (default: 5000)")
    parser.add_argument("--host", default="127.0.0.1", help="Host (default: 127.0.0.1)")
    parser.add_argument("--no-browser", action="store_true", help="Do not open browser")
    parser.add_argument("--repos", default=None, help="Path to repos directory (default: ./repos)")
    args = parser.parse_args()
    run_server(
        host=args.host,
        port=args.port,
        open_browser=not args.no_browser,
        repos_dir=args.repos,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
