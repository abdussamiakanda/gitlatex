"""SyncTeX lookups: source line -> PDF position, and PDF position -> source line.

Both directions shell out to the `synctex` tool that ships with TeX Live and
MiKTeX. It reads the <name>.synctex.gz file that every local build writes
(run_latex_build passes -synctex=1), so a lookup is only as fresh as the last
compile. A remote Compiler API can send that file back alongside the PDF;
save_remote_synctex stores it with its paths pointed at the local repo.
"""

import gzip
import os
import subprocess

_TIMEOUT = 15


def _run(args, cwd):
    try:
        proc = subprocess.run(
            ["synctex"] + args, cwd=cwd, capture_output=True, text=True,
            timeout=_TIMEOUT, errors="replace",
        )
    except FileNotFoundError:
        raise FileNotFoundError(
            "synctex not found. It ships with TeX Live and MiKTeX - make sure it is on your PATH."
        )
    return proc.stdout or ""


def _records(output):
    """Splits synctex's "Key:value" result block into one dict per record.

    Every record starts with an Output: line, so that key opens a new dict.
    """
    records = []
    current = None
    inside = False
    for line in output.splitlines():
        line = line.strip()
        if line == "SyncTeX result begin":
            inside = True
            continue
        if line == "SyncTeX result end":
            break
        if not inside or ":" not in line:
            continue
        key, _, value = line.partition(":")
        if key == "Output":
            current = {}
            records.append(current)
        if current is not None:
            current[key] = value
    return records


def _require_synctex_data(pdf_path):
    stem = os.path.splitext(pdf_path)[0]
    if not (os.path.isfile(stem + ".synctex.gz") or os.path.isfile(stem + ".synctex")):
        raise LookupError(
            "No SyncTeX data for this PDF. Local builds write it; a Compiler API has to "
            "return it as \"synctex\" (see Settings > Compiler API)."
        )


def _normalize(path):
    path = path.replace("\\", "/")
    while "/./" in path:
        path = path.replace("/./", "/")
    while path.startswith("./"):
        path = path[2:]
    return path


def _is_absolute(path):
    return path.startswith("/") or (len(path) > 1 and path[1] == ":")


def _remap_inputs(text, repo_path, main_rel):
    """Points the Input: records of a remotely built synctex file at the repo.

    The API compiled in a temp folder of its own, so its records read like
    /tmp/abc/./chapters/intro.tex. The record for the main file tells us which
    remote folder matches which local one; every input under it is rewritten
    and everything else (texmf .sty/.cls files) is left alone.
    """
    main_rel = _normalize(main_rel)
    main_name = main_rel.rsplit("/", 1)[-1]
    lines = text.split("\n")
    inputs = []
    for i, line in enumerate(lines):
        if line.startswith("Input:"):
            tag, _, name = line[len("Input:"):].partition(":")
            inputs.append((i, tag, name))

    remote_root = local_root = None
    for _, _, name in inputs:
        norm = _normalize(name)
        if norm == main_rel or norm.endswith("/" + main_rel):
            remote_root, local_root = norm[:len(norm) - len(main_rel)], repo_path
            break
    if remote_root is None:
        for _, _, name in inputs:
            norm = _normalize(name)
            if norm == main_name or norm.endswith("/" + main_name):
                main_dir = os.path.dirname(main_rel)
                remote_root = norm[:len(norm) - len(main_name)]
                local_root = os.path.join(repo_path, *main_dir.split("/")) if main_dir else repo_path
                break
    if remote_root is None:
        return text

    for i, tag, name in inputs:
        norm = _normalize(name)
        if remote_root:
            if not norm.startswith(remote_root):
                continue
            rest = norm[len(remote_root):]
        elif _is_absolute(norm):
            continue
        else:
            rest = norm
        local = os.path.normpath(os.path.join(local_root, *rest.split("/")))
        lines[i] = "Input:%s:%s" % (tag, local)
    return "\n".join(lines)


def save_remote_synctex(repo_path, pdf_path, main_rel, blob):
    """Stores the synctex data a Compiler API returned next to pdf_path.

    blob is the raw .synctex.gz (or plain .synctex) bytes, or None when the
    API sent none. Either way the previous local file is dropped: it described
    a different PDF, so jumping with it would land on the wrong lines.
    """
    stem = os.path.splitext(pdf_path)[0]
    for old in (stem + ".synctex.gz", stem + ".synctex"):
        if os.path.isfile(old):
            os.remove(old)
    if not blob:
        return False
    if blob[:2] == b"\x1f\x8b":
        blob = gzip.decompress(blob)
    # latin-1 round-trips every byte, so non-ASCII paths survive unchanged.
    text = blob.decode("latin-1")
    repo = repo_path.encode("utf-8").decode("latin-1")
    main = main_rel.encode("utf-8").decode("latin-1")
    text = _remap_inputs(text, repo, main)
    with gzip.open(stem + ".synctex.gz", "wb") as f:
        f.write(text.encode("latin-1"))
    return True


def forward_search(repo_path, pdf_rel, source_rel, line, column=0):
    """Where source_rel:line ended up in the PDF.

    Returns a list of boxes {page, h, v, W, H} in PDF points measured from the
    page's top-left corner. v is the baseline, so a box spans v-H .. v.
    """
    pdf_path = os.path.join(repo_path, pdf_rel)
    _require_synctex_data(pdf_path)
    # synctex matches the name the engine recorded, which is relative to the
    # build directory; the absolute path is the fallback for odd setups.
    candidates = (source_rel, "./" + source_rel, os.path.join(repo_path, source_rel))
    for name in candidates:
        out = _run(["view", "-i", "%d:%d:%s" % (line, column, name), "-o", pdf_path], repo_path)
        boxes = []
        for rec in _records(out):
            try:
                boxes.append({
                    "page": int(rec["Page"]),
                    "h": float(rec["h"]),
                    "v": float(rec["v"]),
                    "W": float(rec["W"]),
                    "H": float(rec["H"]),
                })
            except (KeyError, ValueError):
                continue
        if boxes:
            return boxes
    return []


def inverse_search(repo_path, pdf_rel, page, x, y):
    """The source file and line behind a point on a PDF page.

    x and y are PDF points from the page's top-left corner. Returns
    {file, line, column} with file relative to the repo, or None when the
    point maps to nothing inside the project (e.g. text from a .sty file).
    """
    pdf_path = os.path.join(repo_path, pdf_rel)
    _require_synctex_data(pdf_path)
    out = _run(["edit", "-o", "%d:%.2f:%.2f:%s" % (page, x, y, pdf_path)], repo_path)
    root = os.path.realpath(repo_path)
    for rec in _records(out):
        source = rec.get("Input") or ""
        if not source:
            continue
        # os.path.join keeps an absolute Input as-is.
        full = os.path.realpath(os.path.join(repo_path, source))
        rel = os.path.relpath(full, root)
        if rel.startswith("..") or os.path.isabs(rel):
            continue
        try:
            line = int(rec.get("Line") or 0)
            column = int(rec.get("Column") or 0)
        except ValueError:
            continue
        if line < 1:
            continue
        return {"file": rel.replace("\\", "/"), "line": line, "column": max(column, 0)}
    return None
