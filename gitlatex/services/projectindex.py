r"""Parsing of \label{} definitions and BibTeX entries.

Feeds the editor's autocomplete: every label and citation key in the project,
collected by walking its .tex and .bib files.
"""

import re

_LABEL_RE = re.compile(r"\\label\s*\{([^}]+)\}")
_BIBKEY_RE = re.compile(r"^\s*@(\w+)\s*\{\s*([^,\s}]+)", re.M)
_BIBFIELD_RE = re.compile(r"^\s*(title|author|year)\s*=\s*[{\"]\s*(.+?)\s*[}\"],?\s*$", re.M | re.I)
_SECTION_RE = re.compile(
    r"\\(chapter|section|subsection|subsubsection)\*?\s*(?:\[[^\]]*\])?\s*\{"
)


def _match_braces(text, start):
    """Content of a {...} group starting at `start` (the opening brace)."""
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[start + 1:i]
    return ""


def _bib_entries(text):
    entries = []
    for m in _BIBKEY_RE.finditer(text):
        key = m.group(2)
        # Read only this entry's own {...} block, so fields can't leak in
        # from the next entry.
        brace = text.find("{", m.start())
        body = _match_braces(text, brace) if brace != -1 else ""
        fields = {}
        for k, v in _BIBFIELD_RE.findall(body):
            fields.setdefault(k.lower(), v)  # first occurrence wins
        entries.append({
            "key": key,
            "type": m.group(1).lower(),
            "title": (fields.get("title") or "").strip("{} ").rstrip(","),
            "author": (fields.get("author") or "").strip("{} ").rstrip(","),
            "year": (fields.get("year") or "").strip("{} ").rstrip(","),
        })
    return entries
