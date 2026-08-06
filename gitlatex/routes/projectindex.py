"""Project-wide label and citation index that drives autocomplete."""

import os

from flask import Blueprint, jsonify

from gitlatex import state
from gitlatex.services.projectindex import _LABEL_RE, _bib_entries

bp = Blueprint("projectindex", __name__)


@bp.route("/project-index")
def project_index():
    """Labels and bibliography keys across the project, for autocomplete."""
    if not state.current_repo_path:
        return jsonify(error="No repository selected"), 400
    labels, citations = [], []
    seen_labels, seen_keys = set(), set()
    for root, dirs, files in os.walk(state.current_repo_path):
        dirs[:] = [d for d in dirs if d != ".git"]
        for name in files:
            lower = name.lower()
            if not lower.endswith((".tex", ".bib")):
                continue
            path = os.path.join(root, name)
            rel = os.path.relpath(path, state.current_repo_path).replace("\\", "/")
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as f:
                    text = f.read()
            except OSError:
                continue
            if lower.endswith(".tex"):
                for m in _LABEL_RE.finditer(text):
                    key = m.group(1).strip()
                    if key and key not in seen_labels:
                        seen_labels.add(key)
                        labels.append({
                            "label": key,
                            "file": rel,
                            "line": text.count("\n", 0, m.start()) + 1,
                        })
            else:
                for e in _bib_entries(text):
                    if e["key"] in seen_keys:
                        continue
                    seen_keys.add(e["key"])
                    e["file"] = rel
                    citations.append(e)
    labels.sort(key=lambda x: x["label"])
    citations.sort(key=lambda x: x["key"])
    return jsonify(labels=labels, citations=citations)
