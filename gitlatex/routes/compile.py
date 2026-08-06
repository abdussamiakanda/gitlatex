"""Compiling the document and serving the resulting PDF."""

import base64
import os
import subprocess

from flask import Blueprint, jsonify, request, send_file

from gitlatex import state
from gitlatex.http import _json
from gitlatex.services.latex import LATEX_ENGINES, run_latex_build
from gitlatex.services.paths import resolve_repo_path

bp = Blueprint("compile", __name__)


@bp.route("/compile", methods=["GET", "POST"])
def compile_latex():
    if request.method == "GET":
        return jsonify(
            ok=True,
            message="Compile API. POST with JSON: { \"main\": \"main.tex\" }",
            has_repo=state.current_repo_path is not None,
        )
    try:
        if not state.current_repo_path:
            return jsonify(error="No repository selected"), 400
        data = _json()
        main_file = data.get("main") or "main.tex"
        print("Compiling", main_file, "...")
    except Exception as e:
        return jsonify(error=str(e)), 500
    engine = (data.get("engine") or "").strip().lower()
    if engine not in LATEX_ENGINES:
        engine = "pdflatex"
    try:
        result = run_latex_build(state.current_repo_path, main_file, engine)
        state.last_compile_error = result["error"]
        pdf_path = "/pdf/" + main_file.replace(".tex", ".pdf")
        payload = dict(
            log=result["log"],
            problems=result["problems"],
            steps=result["steps"],
            engine=engine,
        )
        if result["error"]:
            print("Compile failed:", main_file)
            return jsonify(error=result["error"], **payload), 500
        print("Compiled", main_file, "in", len(result["steps"]), "step(s)")
        return jsonify(success=True, pdf=pdf_path, **payload)
    except subprocess.TimeoutExpired:
        state.last_compile_error = "Compilation timed out"
        return jsonify(error=state.last_compile_error), 500
    except FileNotFoundError as e:
        state.last_compile_error = (
            str(e) or engine + " not found. Install a LaTeX distribution (e.g. TeX Live, MiKTeX)."
        )
        return jsonify(error=state.last_compile_error), 500
    except Exception as e:
        state.last_compile_error = str(e)
        return jsonify(error=state.last_compile_error), 500


@bp.route("/compile-error")
def get_compile_error():
    return jsonify(error=state.last_compile_error)


def handle_save_pdf():
    if not state.current_repo_path:
        return jsonify(error="No repository selected"), 400
    data = _json()
    relative_path = (data.get("path") or data.get("name") or "").strip().replace("\\", "/").lstrip("/")
    if not relative_path or not relative_path.lower().endswith(".pdf"):
        return jsonify(error="Missing or invalid path (must be .pdf)"), 400
    full_path = resolve_repo_path(relative_path)
    if not full_path:
        return jsonify(error="Invalid path"), 400
    base64_content = data.get("content")
    if not base64_content or not isinstance(base64_content, str):
        return jsonify(error="Missing content (base64)"), 400
    try:
        buf = base64.b64decode(base64_content)
        if len(buf) == 0:
            return jsonify(error="Invalid or empty base64 content"), 400
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "wb") as f:
            f.write(buf)
        print("Saved PDF", relative_path)
        return jsonify(success=True, path=relative_path)
    except Exception as e:
        return jsonify(error=str(e)), 500


@bp.route("/save-pdf", methods=["POST"])
def save_pdf():
    return handle_save_pdf()


@bp.route("/api/save-pdf", methods=["POST"])
def api_save_pdf():
    return handle_save_pdf()


@bp.route("/pdf")
def pdf_query():
    if not state.current_repo_path:
        return "No repository selected", 400
    relative_path = (request.args.get("path") or "").strip().lstrip("/\\")
    if not relative_path:
        return "Missing path", 400
    full_path = resolve_repo_path(relative_path)
    if not full_path or not os.path.isfile(full_path):
        return "Not found", 404
    return send_file(full_path, mimetype="application/pdf")


@bp.route("/pdf/<path:filename>")
def pdf_file(filename):
    if not state.current_repo_path:
        return "No repository selected", 400
    full = os.path.join(state.current_repo_path, filename)
    if not os.path.isfile(full):
        return "Not found", 404
    return send_file(full, mimetype="application/pdf")
