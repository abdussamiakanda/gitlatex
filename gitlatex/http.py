"""Small helpers and constants shared by every route module."""

import functools

from flask import request

from gitlatex import state

MIME_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json",
    ".wasm": "application/wasm",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".html": "text/html; charset=utf-8",
}

STATIC_EXTENSIONS = frozenset({".css", ".js", ".mjs", ".html", ".ico", ".png", ".jpg", ".svg", ".woff", ".woff2",
                               ".ttf", ".wasm", ".data", ".tgz", ".json"})
ASSET_EXTENSIONS = frozenset({".css", ".js", ".mjs", ".svg", ".ico", ".png", ".jpeg", ".jpg", ".json", ".woff",
                              ".woff2", ".ttf", ".wasm"})


def with_project_lock(view):
    """Run a route while holding state.project_lock (see gitlatex/state.py)."""
    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        with state.project_lock:
            return view(*args, **kwargs)
    return wrapper


def _json():
    """Request JSON body; default to empty dict."""
    return request.get_json(force=True, silent=True) or {}
