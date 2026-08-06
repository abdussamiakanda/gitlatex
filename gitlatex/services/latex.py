"""LaTeX compilation: running the engine and reading its log.

run_latex_build drives the whole cycle (engine -> bibliography -> reruns);
parse_latex_log turns the resulting log into the structured problem list the
editor shows in its Problems tab.
"""

import os
import re
import subprocess

LATEX_ENGINES = ("pdflatex", "xelatex", "lualatex")

# "Rerun to get cross-references right", "Please rerun LaTeX", "Rerun LaTeX" etc.
_RERUN_RE = re.compile(r"rerun (?:to|LaTeX)|Please rerun|Label\(s\) may have changed", re.I)
# -file-line-error output: "./chapters/nre.tex:42: Undefined control sequence"
_FILE_LINE_RE = re.compile(r"^(?:\./)?([^:\r\n]+?):(\d+):\s*(.+)$")
# "LaTeX Warning: Reference `fig:1' on page 1 undefined on input line 42."
_WARN_LINE_RE = re.compile(
    r"^(?:LaTeX|Package(?:\s+\w+)?)\s+Warning:\s*(.+?)(?:\s+on input line\s+(\d+))?\.?$"
)


def _run_tool(cmd, cwd, timeout=180):
    """Runs a build tool; returns (returncode, combined_output)."""
    proc = subprocess.run(
        cmd, cwd=cwd, capture_output=True, text=True,
        timeout=timeout, errors="replace",
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def parse_latex_log(log_text, main_file):
    """Turns a LaTeX log into structured problems for the editor's error list."""
    problems = []
    seen = set()
    lines = (log_text or "").splitlines()
    for i, line in enumerate(lines):
        line = line.rstrip()
        entry = None

        m = _FILE_LINE_RE.match(line)
        if m and not line.startswith("!"):
            path, lineno, msg = m.group(1), int(m.group(2)), m.group(3).strip()
            # Only trust it if it looks like a source file, not a stray colon.
            if path.lower().endswith((".tex", ".sty", ".cls", ".bib")):
                low = msg.lower()
                kind = "warning" if low.startswith("warning") or "warning:" in low else "error"
                entry = (path, lineno, msg, kind)

        if entry is None and line.startswith("! "):
            msg = line[2:].strip()
            lineno = None
            # The offending line usually follows as "l.42 \badcommand"
            for look in lines[i + 1:i + 6]:
                lm = re.match(r"^l\.(\d+)", look.strip())
                if lm:
                    lineno = int(lm.group(1))
                    break
            entry = (main_file, lineno, msg, "error")

        if entry is None:
            wm = _WARN_LINE_RE.match(line.strip())
            if wm:
                lineno = int(wm.group(2)) if wm.group(2) else None
                entry = (main_file, lineno, wm.group(1).strip(), "warning")

        if entry is None:
            continue
        key = entry[:3]
        if key in seen:
            continue
        seen.add(key)
        problems.append({
            "file": entry[0].replace("\\", "/"),
            "line": entry[1],
            "message": entry[2],
            "severity": entry[3],
        })
    return problems


def run_latex_build(repo_path, main_file, engine="pdflatex"):
    """
    Full LaTeX build: engine -> bibliography (biber/bibtex) -> engine reruns
    until cross-references settle. Returns log, structured problems and steps.
    """
    base = os.path.splitext(main_file)[0]
    workdir = repo_path
    steps = []
    log_parts = []

    def engine_pass(label):
        cmd = [engine, "-interaction=nonstopmode", "-file-line-error",
               "-synctex=1", main_file]
        try:
            code, out = _run_tool(cmd, workdir)
        except FileNotFoundError:
            raise FileNotFoundError(
                engine + " not found. Install a LaTeX distribution (e.g. TeX Live, MiKTeX)."
            )
        steps.append({"tool": engine, "label": label, "exitCode": code})
        log_parts.append("$ " + " ".join(cmd) + "\n" + out)
        return code

    def read_aux_log():
        # The .log file is far richer than stdout; prefer it when present.
        log_file = os.path.join(workdir, base + ".log")
        if os.path.isfile(log_file):
            try:
                with open(log_file, "r", encoding="utf-8", errors="replace") as f:
                    return f.read()
            except OSError:
                return ""
        return ""

    engine_pass("pass 1")

    # Bibliography: biblatex leaves a .bcf (biber), classic bibtex leaves
    # \bibdata in the .aux. Skip entirely when neither is present.
    bcf = os.path.join(workdir, base + ".bcf")
    aux = os.path.join(workdir, base + ".aux")
    aux_text = ""
    if os.path.isfile(aux):
        try:
            with open(aux, "r", encoding="utf-8", errors="replace") as f:
                aux_text = f.read()
        except OSError:
            aux_text = ""

    bib_tool = None
    if os.path.isfile(bcf):
        bib_tool = ["biber", base]
    elif "\\bibdata" in aux_text:
        bib_tool = ["bibtex", base]

    if bib_tool:
        try:
            code, out = _run_tool(bib_tool, workdir)
            steps.append({"tool": bib_tool[0], "label": "bibliography", "exitCode": code})
            log_parts.append("$ " + " ".join(bib_tool) + "\n" + out)
        except FileNotFoundError:
            log_parts.append(
                bib_tool[0] + " not found - citations may be unresolved. "
                "Install it with your LaTeX distribution."
            )
            steps.append({"tool": bib_tool[0], "label": "bibliography", "exitCode": -1,
                          "missing": True})

    # Rerun until references settle (bounded), always at least one extra pass
    # when a bibliography ran.
    max_reruns = 3 if bib_tool else 2
    for n in range(max_reruns):
        engine_pass("rerun %d" % (n + 1))
        text = read_aux_log()
        if not _RERUN_RE.search(text or "") and not (bib_tool and n == 0):
            break

    full_log = read_aux_log() or "\n".join(log_parts)
    problems = parse_latex_log(full_log, main_file)

    pdf_file = os.path.join(workdir, base + ".pdf")
    error = None
    if not os.path.isfile(pdf_file):
        first_error = next((p for p in problems if p["severity"] == "error"), None)
        error = first_error["message"] if first_error else "Compilation failed - no PDF produced."
    elif steps and steps[-1]["exitCode"] not in (0, None):
        first_error = next((p for p in problems if p["severity"] == "error"), None)
        if first_error:
            error = first_error["message"]

    return {
        "log": "\n".join(log_parts) if not full_log else full_log,
        "problems": problems,
        "steps": steps,
        "error": error,
    }
