"""Serving the in-browser TeX engine and its on-demand package shelf.

The engine (BusyTeX: pdfTeX, XeTeX, BibTeX... compiled to WebAssembly) is
far too big to ship on PyPI, so the package carries only engine/manifest.json.
The first time the browser asks for an asset it is downloaded from the pinned
upstream build, checked against the SHA-256 in the manifest and kept in
~/.gitlatex/engine, so every later compile, in any browser, is offline.

The package shelf (one small bundle per LaTeX package, fetched only when a
document needs it) is proxied and cached the same way under ~/.gitlatex/shelf.

    GET /engine/manifest.json
    GET /engine/<build>/<asset>
    GET /shelf/<path>
"""

import hashlib
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from flask import Blueprint, Response, abort, jsonify, send_file

bp = Blueprint("engine", __name__)

MANIFEST_PATH = Path(__file__).resolve().parent.parent / "engine" / "manifest.json"

# Interim default until gitlatex publishes its own shelf; override with
# GITLATEX_SHELF_URL (an empty value disables on-demand packages).
DEFAULT_SHELF_URL = "https://jukomol.github.io/TexBrowser-IDE/shelf/"
SHELF_INDEX_TTL = 24 * 3600

CHUNK = 1 << 16


def cache_root():
    return Path(os.environ.get("GITLATEX_CACHE") or (Path.home() / ".gitlatex"))


def shelf_url():
    url = os.environ.get("GITLATEX_SHELF_URL", DEFAULT_SHELF_URL).strip()
    return url and url.rstrip("/") + "/"


_manifest = None


def load_manifest():
    global _manifest
    if _manifest is None:
        with open(MANIFEST_PATH, encoding="utf-8") as f:
            _manifest = json.load(f)
    return _manifest


def _open_upstream(url):
    req = urllib.request.Request(url, headers={"User-Agent": "gitlatex"})
    return urllib.request.urlopen(req, timeout=60)


def _tmp_for(dest):
    return dest.with_name(dest.name + ".part-" + uuid.uuid4().hex[:8])


def _stream_to_cache(resp, dest, expected_sha=None):
    """Yield the upstream body to the browser while writing it to the cache.

    The file only lands in the cache once it is complete (and, for engine
    assets, matches its checksum), so an interrupted download is never reused.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = _tmp_for(dest)
    digest = hashlib.sha256()
    done = False
    try:
        with open(tmp, "wb") as f:
            while True:
                chunk = resp.read(CHUNK)
                if not chunk:
                    break
                digest.update(chunk)
                f.write(chunk)
                yield chunk
        if expected_sha and digest.hexdigest() != expected_sha:
            print("Checksum mismatch for", dest.name, "- not cached")
        else:
            os.replace(tmp, dest)
            done = True
    finally:
        resp.close()
        if not done and tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def _serve_cached(path, mimetype):
    resp = send_file(path, mimetype=mimetype, conditional=True)
    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp


def _mimetype(name):
    if name.endswith(".wasm"):
        return "application/wasm"
    if name.endswith(".js"):
        return "application/javascript"
    if name.endswith(".json"):
        return "application/json"
    return "application/octet-stream"


def _download_engine_asset(name):
    """Open the upstream response for one engine asset (name must be in the manifest)."""
    m = load_manifest()
    return _open_upstream(m["upstream"] + name)


@bp.route("/engine/manifest.json")
def engine_manifest():
    if not MANIFEST_PATH.is_file():
        return jsonify(error="This build of gitlatex has no engine manifest"), 404
    resp = send_file(str(MANIFEST_PATH), mimetype="application/json")
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@bp.route("/engine/<build>/<name>")
def engine_asset(build, name):
    m = load_manifest()
    expected = (m.get("sha256") or {}).get(name)
    if build + "/" != m.get("base") or not expected or not m.get("upstream"):
        abort(404)
    dest = cache_root() / "engine" / build / name
    if dest.is_file():
        return _serve_cached(str(dest), _mimetype(name))
    try:
        upstream = _download_engine_asset(name)
    except (urllib.error.URLError, OSError) as e:
        print("Engine download failed:", name, e)
        return jsonify(error="Could not download the TeX engine (%s). Check your internet connection." % e), 502
    print("Downloading engine asset", name, "(first use, cached afterwards)")
    headers = {"Cache-Control": "no-store"}
    length = upstream.headers.get("Content-Length")
    if length:
        headers["Content-Length"] = length
    return Response(_stream_to_cache(upstream, dest, expected), mimetype=_mimetype(name), headers=headers)


@bp.route("/shelf/<path:path>")
def shelf_file(path):
    base = shelf_url()
    parts = [p for p in path.replace("\\", "/").split("/") if p]
    if not base or not parts or any(p in (".", "..") for p in parts):
        abort(404)
    dest = cache_root().joinpath("shelf", *parts)
    is_index = parts[-1].endswith(".json")
    fresh = dest.is_file() and (not is_index or time.time() - dest.stat().st_mtime < SHELF_INDEX_TTL)
    if fresh:
        return _serve_cached(str(dest), _mimetype(parts[-1]))
    try:
        upstream = _open_upstream(base + "/".join(parts))
    except urllib.error.HTTPError as e:
        if dest.is_file():
            return _serve_cached(str(dest), _mimetype(parts[-1]))
        return Response(status=e.code)
    except (urllib.error.URLError, OSError):
        # Offline: a stale index still beats no packages at all.
        if dest.is_file():
            return _serve_cached(str(dest), _mimetype(parts[-1]))
        return Response(status=502)
    headers = {"Cache-Control": "no-store"}
    length = upstream.headers.get("Content-Length")
    if length:
        headers["Content-Length"] = length
    return Response(_stream_to_cache(upstream, dest), mimetype=_mimetype(parts[-1]), headers=headers)


def fetch_engine(log=print):
    """Download every engine asset into the cache ahead of time (gitlatex --fetch-engine)."""
    m = load_manifest()
    build = m["base"].rstrip("/")
    for name, expected in m["sha256"].items():
        dest = cache_root() / "engine" / build / name
        if dest.is_file():
            log("  cached  " + name)
            continue
        log("  fetch   " + name)
        for _ in _stream_to_cache(_download_engine_asset(name), dest, expected):
            pass
        if not dest.is_file():
            raise RuntimeError("Checksum mismatch for " + name)
    log("Engine ready in " + str(cache_root() / "engine" / build))
