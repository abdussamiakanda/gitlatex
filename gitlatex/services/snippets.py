"""User-defined editor snippets, shared by every project.

Kept next to the personal dictionary in ~/.gitlatex so they survive upgrades
and work in any browser pointed at this server. A snippet is:

    prefix       what the user types before pressing Tab / picking it
    body         Monaco snippet syntax: $1, ${1:default}, ${1|a,b|}, $0
    description  optional, shown beside the suggestion
    scope        "latex", "bib" or "all"
"""

import json
import os
from pathlib import Path

SCOPES = ("latex", "bib", "all")
MAX_SNIPPETS = 500
MAX_PREFIX_LENGTH = 64
MAX_BODY_LENGTH = 20_000


def _snippets_path():
    return Path.home() / ".gitlatex" / "snippets.json"


def clean_snippet(raw):
    """A validated copy of one snippet, or None if it is unusable."""
    if not isinstance(raw, dict):
        return None
    prefix = str(raw.get("prefix") or "").strip()
    body = raw.get("body")
    if isinstance(body, list):  # VS Code style: one string per line
        body = "\n".join(str(line) for line in body)
    body = str(body or "")
    if not prefix or any(c.isspace() for c in prefix) or len(prefix) > MAX_PREFIX_LENGTH:
        return None
    if not body.strip() or len(body) > MAX_BODY_LENGTH:
        return None
    scope = str(raw.get("scope") or "latex").lower()
    if scope not in SCOPES:
        scope = "latex"
    return {
        "prefix": prefix,
        "body": body,
        "description": str(raw.get("description") or "").strip()[:200],
        "scope": scope,
    }


def load_snippets():
    """Saved snippets; a missing or unreadable file means none."""
    try:
        with open(_snippets_path(), "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    items = data.get("snippets") if isinstance(data, dict) else data
    if not isinstance(items, list):
        return []
    return [s for s in (clean_snippet(item) for item in items) if s]


def save_snippets(items):
    """Replaces the whole list. Returns (snippets, error)."""
    if not isinstance(items, list):
        return None, "Expected a list of snippets"
    if len(items) > MAX_SNIPPETS:
        return None, "At most %d snippets are allowed" % MAX_SNIPPETS
    cleaned = []
    seen = set()
    for i, item in enumerate(items):
        snippet = clean_snippet(item)
        if snippet is None:
            return None, "Snippet %d needs a prefix without spaces and a body" % (i + 1)
        key = (snippet["prefix"], snippet["scope"])
        if key in seen:
            return None, "Duplicate prefix %r" % snippet["prefix"]
        seen.add(key)
        cleaned.append(snippet)
    path = _snippets_path()
    try:
        os.makedirs(path.parent, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"snippets": cleaned}, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, path)
    except OSError as e:
        return None, "Could not save snippets: %s" % e
    return cleaned, None
