"""LaTeX-aware spell checking backed by symspellpy.

The editor sends whole file contents here; we blank out everything that is not
prose (comments, math, command names, label/cite/url arguments) and look the
remaining words up in a SymSpell dictionary. Blanking replaces characters with
spaces so every offset in the masked text still matches the original - the
editor gets exact line/column positions back without any second pass.

symspellpy is optional: if it is not installed every endpoint reports
`available: false` and the editor simply never shows squiggles.
"""

import os
import re
import threading
from pathlib import Path

try:
    from symspellpy import SymSpell, Verbosity
except ImportError:  # pragma: no cover - optional dependency
    SymSpell = None
    Verbosity = None

MAX_EDIT_DISTANCE = 2
MAX_SUGGESTIONS = 6
MAX_TEXT_SIZE = 400_000  # bigger files are truncated rather than refused
MIN_WORD_LENGTH = 3

_sym = None
_sym_error = None
_load_lock = threading.Lock()
# Words injected into the loaded dictionary that the base frequency list did
# not already have. Only these may be deleted again, so removing a word from
# the personal dictionary can never unteach a genuinely common word.
_injected = set()

# Words the 82k frequency list does not know but that are perfectly normal in a
# LaTeX project. Kept short on purpose - anything else belongs in the user
# dictionary, which the editor can add to with one click.
BUILTIN_WORDS = """
latex tex bibtex biber pdflatex xelatex lualatex overleaf gitlatex github
arxiv doi url isbn eprint preprint
al et etc ie eg cf vs
subsection subsubsection eqn eqns fig figs eq eqs
math maths dataset datasets workflow workflows runtime codebase metadata
analytics benchmark benchmarks scalability pipeline pipelines
ansatz asymptotics discretization discretized parameterization parameterized
eigenvector eigenvectors colormap boxplot scatterplot subplot subplots
nanoscale nanometer nanostructure nanostructures heterostructure
qubit qubits phonons plasmonic spintronics skyrmion antiferromagnetic
""".split() + """
neighbor neighbors neighboring canceled canceling modeled modeling
labeling labeled traveling traveled signaled signaling counseling
totaling fueling marveling equaling analyze analyzed analyzes catalog
""".split()  # US spellings the mostly-British frequency list is missing


def _user_dict_path():
    return Path.home() / ".gitlatex" / "user-dictionary.txt"


def load_user_words():
    """Words the user added by hand, lowercased. Missing file means none."""
    path = _user_dict_path()
    try:
        with open(path, "r", encoding="utf-8") as f:
            return {w.strip().lower() for w in f if w.strip()}
    except OSError:
        return set()


def save_user_words(words):
    path = _user_dict_path()
    try:
        os.makedirs(path.parent, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(sorted(words)) + "\n")
        return True
    except OSError:
        return False


def add_user_word(word):
    """Adds one word to the user dictionary; returns the full word set."""
    words = load_user_words()
    cleaned = (word or "").strip().lower()
    if cleaned:
        words.add(cleaned)
        save_user_words(words)
        speller = _get_speller()
        if speller is not None:
            if cleaned not in speller.words:
                _injected.add(cleaned)
            # Frequency high enough to outrank corrections of the same word.
            speller.create_dictionary_entry(cleaned, 1_000_000)
    return words


def remove_user_word(word):
    words = load_user_words()
    cleaned = (word or "").strip().lower()
    if cleaned in words:
        words.discard(cleaned)
        save_user_words(words)
        speller = _get_speller()
        if speller is not None and cleaned in _injected and cleaned not in BUILTIN_WORDS:
            try:
                speller.delete_dictionary_entry(cleaned)
                _injected.discard(cleaned)
            except Exception:
                pass
    return words


def _get_speller():
    """Loads the SymSpell dictionary once, on first use (~1s, ~30MB)."""
    global _sym, _sym_error
    if _sym is not None or _sym_error is not None:
        return _sym
    with _load_lock:
        if _sym is not None or _sym_error is not None:
            return _sym
        if SymSpell is None:
            _sym_error = "symspellpy is not installed. Run: pip install symspellpy"
            return None
        try:
            sym = SymSpell(max_dictionary_edit_distance=MAX_EDIT_DISTANCE, prefix_length=7)
            dict_path = _bundled_dictionary()
            if not dict_path:
                _sym_error = "symspellpy frequency dictionary not found."
                return None
            if not sym.load_dictionary(str(dict_path), term_index=0, count_index=1,
                                       encoding="utf-8"):
                _sym_error = "Failed to load the frequency dictionary."
                return None
            for word in list(BUILTIN_WORDS) + sorted(load_user_words()):
                if word not in sym.words:
                    _injected.add(word)
                sym.create_dictionary_entry(word, 1_000_000)
            _sym = sym
            print("Spell checker ready (%d words)" % len(sym.words))
        except Exception as e:  # pragma: no cover - defensive
            _sym_error = str(e) or e.__class__.__name__
            print("Spell checker unavailable:", _sym_error)
        return _sym


def _bundled_dictionary():
    """Path to the en frequency list shipped inside symspellpy."""
    import symspellpy
    base = Path(symspellpy.__file__).parent
    for name in ("frequency_dictionary_en_82_765.txt",):
        candidate = base / name
        if candidate.is_file():
            return candidate
    return None


def status():
    speller = _get_speller()
    return {
        "available": speller is not None,
        "error": _sym_error,
        "userWords": sorted(load_user_words()),
    }


# ----- LaTeX masking -----

# Environments whose body is never prose.
_CODE_ENVS = (
    "verbatim|lstlisting|minted|Verbatim|alltt|tikzpicture|pgfpicture|"
    "equation|align|gather|multline|eqnarray|displaymath|math|flalign|"
    "array|matrix|pmatrix|bmatrix|vmatrix|Bmatrix|Vmatrix|split|cases|"
    "tabular|tabularx|longtable|filecontents|thebibliography"
)

# Commands whose braced argument is an identifier, path or code - not words.
_OPAQUE_CMDS = (
    "label|ref|eqref|pageref|autoref|cref|Cref|nameref|vref|"
    "cite|citep|citet|citeauthor|citeyear|citealp|citealt|nocite|parencite|textcite|"
    "usepackage|documentclass|RequirePackage|input|include|includeonly|includegraphics|"
    "bibliography|bibliographystyle|addbibresource|"
    "url|href|hyperref|path|texttt|verb|lstinline|mint|email|orcid|homepage|"
    "newcommand|renewcommand|providecommand|newenvironment|renewenvironment|def|"
    "DeclareMathOperator|setlength|addtolength|geometry|hypersetup|"
    "color|textcolor|definecolor|pagestyle|thispagestyle|bibitem|"
    "graphicspath|newtheorem|setcounter|addtocounter|pgfplotsset|tikzset"
)

_PASSES = [
    # Comments (an escaped \% is not a comment).
    re.compile(r"(?<!\\)%[^\n]*"),
    # Whole environments that never contain prose.
    re.compile(r"\\begin\s*\{(" + _CODE_ENVS + r")\*?\}.*?\\end\s*\{\1\*?\}", re.S),
    # Math delimiters.
    re.compile(r"\$\$.*?\$\$", re.S),
    re.compile(r"\\\[.*?\\\]", re.S),
    re.compile(r"\\\(.*?\\\)", re.S),
    re.compile(r"(?<!\\)\$.*?(?<!\\)\$", re.S),
    # \verb|...| style inline verbatim with an arbitrary delimiter.
    re.compile(r"\\(?:verb|lstinline)\*?(.)(?:(?!\1).)*\1"),
    # Commands whose arguments are identifiers rather than prose.
    re.compile(r"\\(?:" + _OPAQUE_CMDS + r")\*?\s*(?:\[[^\]]*\])?\s*(?:\{[^{}]*\})+"),
    # \begin{itemize}[...] etc: drop the environment name, keep the body.
    re.compile(r"\\(?:begin|end)\s*\{[^}]*\}(?:\[[^\]]*\])?"),
    # Anything left that starts with a backslash: the command name and any
    # optional argument. Braced arguments stay - \textbf{hello} is prose.
    re.compile(r"\\[a-zA-Z@]+\*?(?:\[[^\]]*\])?"),
    # Escaped single characters (\% \& \_ \# ...).
    re.compile(r"\\[^a-zA-Z]"),
]


def _blank(match):
    """Same-length replacement so offsets never shift, newlines preserved."""
    return re.sub(r"[^\n]", " ", match.group(0))


def mask_latex(text):
    """Blanks out every part of `text` that should not be spell checked."""
    masked = text
    for pattern in _PASSES:
        masked = pattern.sub(_blank, masked)
    return masked


# Words may carry internal apostrophes and hyphens; digits disqualify a token.
_WORD_RE = re.compile(r"[A-Za-z]+(?:['\u2019-][A-Za-z]+)*")


def _line_starts(text):
    starts = [0]
    for m in re.finditer(r"\n", text):
        starts.append(m.end())
    return starts


def _position(line_starts, offset):
    """1-based (line, column) for a character offset. Binary search."""
    lo, hi = 0, len(line_starts) - 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if line_starts[mid] <= offset:
            lo = mid
        else:
            hi = mid - 1
    return lo + 1, offset - line_starts[lo] + 1


def _is_checkable(word):
    """Skips acronyms, CamelCase identifiers and very short words."""
    core = word.replace("'", "").replace("\u2019", "").replace("-", "")
    if len(core) < MIN_WORD_LENGTH:
        return False
    if core.isupper():
        return False
    # Any uppercase past the first character means an identifier like `arXiv`.
    if any(c.isupper() for c in core[1:]):
        return False
    return True


def _match_case(original, suggestion):
    if original[:1].isupper():
        return suggestion[:1].upper() + suggestion[1:]
    return suggestion


# Scientific writing coins compounds freely and an 82k word list has none of
# them. Splitting off a productive prefix rescues nanowire, ferromagnets,
# antisymmetric and hundreds like them without weakening the check much.
_PREFIXES = (
    "nano", "micro", "milli", "kilo", "mega", "giga", "tera", "pico", "femto",
    "ferro", "antiferro", "para", "dia", "piezo", "pyro", "thermo", "electro",
    "magneto", "opto", "photo", "spin", "quantum", "atto", "hyper", "hypo",
    "anti", "non", "sub", "super", "inter", "intra", "trans", "ultra", "multi",
    "semi", "pseudo", "quasi", "over", "under", "pre", "post", "re", "co",
    "counter", "meso", "macro", "poly", "mono", "bi", "tri", "iso", "hetero",
    "homo", "auto", "self", "cross", "bio", "geo", "astro", "cyto", "neuro",
)


def _base_known(speller, word, user_words):
    return word in user_words or word in speller.words


def _known(speller, word, user_words):
    """True when the word can be accounted for by the dictionary.

    Beyond a plain hit this accepts possessives, hyphenated compounds and
    prefixed coinages, each of which is normal in a paper and none of which a
    frequency list of common English contains.
    """
    if _base_known(speller, word, user_words):
        return True

    # Possessives: `student's` is fine when `student` is - and so is
    # `nanowire's`, which needs the prefix rule below too.
    base = re.sub(r"['\u2019]s$", "", word)
    if base != word and _known(speller, base, user_words):
        return True

    if "-" in word:
        parts = [p for p in word.split("-") if p]
        if parts and all(
            len(p) < MIN_WORD_LENGTH or _known(speller, p, user_words)
            for p in parts
        ):
            return True

    for prefix in _PREFIXES:
        if not word.startswith(prefix):
            continue
        rest = word[len(prefix):]
        if len(rest) < MIN_WORD_LENGTH:
            continue
        if _base_known(speller, rest, user_words):
            return True
        # nanowires -> nano + wire + s, ferromagnetic -> ferro + magnetic
        for suffix in ("s", "es", "ed", "ing", "ly"):
            if rest.endswith(suffix) and _base_known(
                speller, rest[:-len(suffix)], user_words
            ):
                return True
    return False


def suggestions_for(word):
    """Ranked corrections for a single word, already case-matched."""
    speller = _get_speller()
    if speller is None or not word:
        return []
    lookup = re.sub(r"['\u2019]s$", "", word.lower())
    try:
        found = speller.lookup(
            lookup, Verbosity.CLOSEST,
            max_edit_distance=MAX_EDIT_DISTANCE,
            include_unknown=False,
            transfer_casing=False,
        )
    except Exception:
        return []
    out = []
    for item in found:
        term = item.term
        if term == lookup:
            continue
        out.append(_match_case(word, term))
        if len(out) >= MAX_SUGGESTIONS:
            break
    return out


def check_text(text):
    """Every misspelling in `text`, with editor-ready positions.

    Returns {"available": bool, "words": [{word, line, column, endColumn,
    suggestions}], "truncated": bool}.
    """
    speller = _get_speller()
    if speller is None:
        return {"available": False, "error": _sym_error, "words": []}

    truncated = False
    if len(text) > MAX_TEXT_SIZE:
        text = text[:MAX_TEXT_SIZE]
        truncated = True

    masked = mask_latex(text)
    line_starts = _line_starts(masked)
    user_words = load_user_words()

    results = []
    # Same word twice in a file gets the same suggestions; look it up once.
    cache = {}
    for m in _WORD_RE.finditer(masked):
        word = m.group(0)
        if not _is_checkable(word):
            continue
        lower = word.lower()
        if _known(speller, lower, user_words):
            continue
        if lower not in cache:
            cache[lower] = suggestions_for(lower)
        line, column = _position(line_starts, m.start())
        results.append({
            "word": word,
            "line": line,
            "column": column,
            "endColumn": column + len(word),
            "suggestions": [_match_case(word, s) for s in cache[lower]],
        })

    return {"available": True, "words": results, "truncated": truncated}
