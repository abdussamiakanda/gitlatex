"""Flask application factory.

Everything the app needs at import time lives here: the Flask object, CORS,
request logging, and blueprint registration. The routes themselves are in
gitlatex/routes/, one module per area of the UI.
"""

import os
from pathlib import Path

from flask import Flask, request

from gitlatex import state
from gitlatex.services import paths
from gitlatex.http import STATIC_EXTENSIONS
from gitlatex.routes import register_blueprints


def _repos_base():
    return Path.cwd() / "repos"


def create_app(repos_dir=None):
    """Builds the app and points it at a repos folder, creating it if needed."""
    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50MB

    state.BASE_DIR = str(Path(repos_dir) if repos_dir else _repos_base())
    os.makedirs(state.BASE_DIR, exist_ok=True)

    public = paths._public_dir()
    if not os.path.isdir(public):
        raise FileNotFoundError(f"Public folder not found: {public}. Run from project root.")
    print("Serving static files from:", public)

    register_blueprints(app)

    # CORS: allow same-origin and cross-origin so compile/API work from any
    # port or file://
    @app.after_request
    def add_cors(resp):
        origin = request.environ.get("HTTP_ORIGIN")
        if origin:
            resp.headers["Access-Control-Allow-Origin"] = origin
        else:
            resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        return resp

    @app.before_request
    def log_request():
        if request.method == "OPTIONS":
            return "", 204
        p = request.path
        if p != "/" and not any(p.endswith(e) for e in STATIC_EXTENSIONS):
            print(f"  {request.method} {p}")

    return app
