"""Spell-check endpoints backed by the symspellpy service."""

from flask import Blueprint, jsonify

from gitlatex.services import spell
from gitlatex.http import _json

bp = Blueprint("spell", __name__)


@bp.route("/spell/status")
def spell_status():
    """Whether the checker loaded, plus the user's personal dictionary."""
    return jsonify(**spell.status())


@bp.route("/spell/check", methods=["POST"])
def spell_check():
    """Misspelled words in a document, with line/column and suggestions."""
    data = _json()
    text = data.get("text")
    if not isinstance(text, str):
        return jsonify(error="Missing text"), 400
    try:
        return jsonify(**spell.check_text(text))
    except Exception as e:
        return jsonify(error=str(e), available=False, words=[]), 500


@bp.route("/spell/suggest", methods=["POST"])
def spell_suggest():
    """Corrections for one word, for the editor's quick-fix menu."""
    data = _json()
    word = (data.get("word") or "").strip()
    if not word:
        return jsonify(error="Missing word"), 400
    return jsonify(word=word, suggestions=spell.suggestions_for(word))


@bp.route("/spell/dictionary", methods=["POST"])
def spell_dictionary():
    """Add or remove a word from the personal dictionary."""
    data = _json()
    word = (data.get("word") or "").strip()
    action = (data.get("action") or "add").lower()
    if not word:
        return jsonify(error="Missing word"), 400
    if action == "remove":
        words = spell.remove_user_word(word)
    else:
        words = spell.add_user_word(word)
    print("Dictionary %s: %s" % (action, word))
    return jsonify(success=True, userWords=sorted(words))
