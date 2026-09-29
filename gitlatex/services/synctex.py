"""SyncTeX lookups: source line -> PDF position, and PDF position -> source line.

Both directions read the <name>.synctex.gz file next to the PDF with
synctex_reader, a Python port of the `synctex` tool's lookups, so no TeX
install is needed. Local builds write that file (run_latex_build passes
-synctex=1), so a lookup is only as fresh as the last compile. A remote
Compiler API can send it back alongside the PDF; save_remote_synctex stores
it with its paths pointed at the local repo.
"""

import gzip
import os

from gitlatex.services import synctex_reader


def _synctex_data(pdf_path):
    stem = os.path.splitext(pdf_path)[0]
    for path in (stem + ".synctex.gz", stem + ".synctex"):
        if os.path.isfile(path):
            return synctex_reader.load(path)
    raise LookupError(
        "No SyncTeX data for this PDF. Local builds write it; a Compiler API has to "
        "return it as \"synctex\" (see Settings > Compiler API)."
    )


def _input_path(repo_path, name):
    """Absolute path of an input name as the engine recorded it.

    The reader keeps names as latin-1 so every byte survives; they are UTF-8.
    Relative names are relative to the build directory, the repo root for
    local builds; os.path.join keeps absolute ones as they are.
    """
    name = name.encode("latin-1").decode("utf-8", "replace")
    return os.path.normpath(os.path.join(repo_path, name))


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
    data = _synctex_data(os.path.join(repo_path, pdf_rel))
    wanted = os.path.normcase(os.path.normpath(os.path.join(repo_path, source_rel)))
    tags = data.tags_for(lambda name: os.path.normcase(_input_path(repo_path, name)) == wanted)
    return data.forward(tags, line)


def inverse_search(repo_path, pdf_rel, page, x, y):
    """The source file and line behind a point on a PDF page.

    x and y are PDF points from the page's top-left corner. Returns
    {file, line, column} with file relative to the repo, or None when the
    point maps to nothing inside the project (e.g. text from a .sty file).
    """
    data = _synctex_data(os.path.join(repo_path, pdf_rel))
    root = os.path.realpath(repo_path)
    for tag, line in data.inverse(page, x, y):
        name = data.inputs.get(tag)
        if not name or line < 1:
            continue
        full = os.path.realpath(_input_path(repo_path, name))
        try:
            rel = os.path.relpath(full, root)
        except ValueError:
            continue    # another drive on Windows: TeX's own files
        if rel.startswith("..") or os.path.isabs(rel):
            continue
        return {"file": rel.replace("\\", "/"), "line": line, "column": 0}
    return None
