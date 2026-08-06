"""Serving the single-page app itself: index.html and everything in public/."""

import os

from flask import Blueprint, Response, request, send_file

from gitlatex.http import ASSET_EXTENSIONS, MIME_TYPES
from gitlatex.services.paths import _public_dir, _static_path

bp = Blueprint("pages", __name__)


def _serve_index():
    index_path = os.path.join(_public_dir(), "index.html")
    if os.path.isfile(index_path):
        try:
            with open(index_path, "r", encoding="utf-8") as f:
                return Response(f.read(), mimetype="text/html")
        except OSError:
            pass
    return Response(
        "<!DOCTYPE html><html><body><h1>GitLaTeX</h1><p>Server OK. index.html not found.</p></body></html>",
        mimetype="text/html",
    )


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


@bp.route("/<path:path>", methods=["GET", "HEAD"])
def static_file(path):
    """Serve file from public/ or index.html for SPA routes. GET/HEAD only."""
    path = path.lstrip("/").replace("\\", "/")
    if not path:
        return _serve_index()
    full_path = _static_path(path)
    if full_path:
        ext = os.path.splitext(full_path)[1].lower()
        mime = MIME_TYPES.get(ext) or "application/octet-stream"
        if ext in (".css", ".js"):
            try:
                with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                    body = f.read()
            except OSError:
                return "Not found", 404
            return Response(body, mimetype=mime)
        return send_file(full_path, mimetype=mime)
    last = path.split("/")[-1].lower()
    if any(last.endswith(ext) for ext in ASSET_EXTENSIONS):
        return "Not found", 404
    return _serve_index()
