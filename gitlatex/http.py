"""Small helpers and constants shared by every route module."""

from flask import request

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
}

REPO_FILE_MAX_SIZE = 5 * 1024 * 1024
STATIC_EXTENSIONS = frozenset({".css", ".js", ".html", ".ico", ".png", ".jpg", ".svg", ".woff", ".woff2"})
ASSET_EXTENSIONS = frozenset({".css", ".js", ".svg", ".ico", ".png", ".jpeg", ".jpg", ".json", ".woff", ".woff2"})


def _json():
    """Request JSON body; default to empty dict."""
    return request.get_json(force=True, silent=True) or {}
