"""Serving the app pages.

`/` is the editor UI built from web/ into gitlatex/ui/. The classic UI in
public/ stays available at `/classic` (and is served at `/` by installs that
have no built UI). The two never collide: the new UI's files live under
/assets/, the classic UI's under /js/, /css/ and a few root files.
"""

import os

from flask import Blueprint, Response, request, send_file

from gitlatex.http import ASSET_EXTENSIONS, MIME_TYPES
from gitlatex.services.paths import _public_dir, _static_path, _ui_dir, has_ui

bp = Blueprint("pages", __name__)


def _html(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return Response(f.read(), mimetype="text/html", headers={"Cache-Control": "no-cache"})
    except OSError:
        return None


def _serve_classic():
    return _html(os.path.join(_public_dir(), "index.html")) or Response(
        "<!DOCTYPE html><html><body><h1>GitLaTeX</h1><p>Server OK. index.html not found.</p></body></html>",
        mimetype="text/html",
    )


def _serve_index():
    if has_ui():
        page = _html(os.path.join(_ui_dir(), "index.html"))
        if page is not None:
            return page
    return _serve_classic()


@bp.before_app_request
def serve_root():
    path = request.path.rstrip("/") or "/"
    if path == "/" and request.method == "GET":
        return _serve_index()


@bp.route("/ping")
def ping():
    return "pong"


@bp.route("/")
def index():
    return _serve_index()


@bp.route("/classic")
@bp.route("/classic/")
def classic():
    return _serve_classic()


def _send_static(full_path):
    ext = os.path.splitext(full_path)[1].lower()
    mime = MIME_TYPES.get(ext) or "application/octet-stream"
    resp = send_file(full_path, mimetype=mime, conditional=True)
    # Vite fingerprints everything under assets/, so it never changes.
    if "/assets/" in full_path.replace("\\", "/"):
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp


@bp.route("/<path:path>", methods=["GET", "HEAD"])
def static_file(path):
    """Serve a file from ui/ or public/, or the app page for SPA routes. GET/HEAD only."""
    path = path.lstrip("/").replace("\\", "/")
    if not path:
        return _serve_index()
    full_path = (has_ui() and _static_path(path, _ui_dir())) or _static_path(path)
    if full_path:
        return _send_static(full_path)
    last = path.split("/")[-1].lower()
    if any(last.endswith(ext) for ext in ASSET_EXTENSIONS):
        return "Not found", 404
    return _serve_index()
