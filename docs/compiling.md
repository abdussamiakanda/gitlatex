# Compiling

## Compilers

**Settings → Compiler** picks where documents are built:

| | |
| --- | --- |
| **Auto** (default) | Local TeX when `pdflatex`/`xelatex`/`lualatex` is on your `PATH`, otherwise the browser |
| **In the browser** | Real TeX Live 2022 (pdfTeX, XeTeX, BibTeX, makeindex) compiled to WebAssembly, from [BusyTeX](https://github.com/busytex/busytex). Missing packages (TikZ, biblatex, extra fonts…) are fetched on demand from a package shelf. No LuaLaTeX, no biber (use `backend=bibtex`), no shell escape |
| **Local TeX** | Your TeX installation, with bibtex/biber |
| **Compiler API** | A remote web service that compiles LaTeX (the request format is documented in the classic editor's Settings → Compiler API) |

### The in-browser engine

The engine (~190 MB) and any extra LaTeX packages it needs are downloaded on
first use and cached in `~/.gitlatex`, so compiling without a TeX installation
needs a network connection once. `gitlatex --fetch-engine` downloads the engine
ahead of time (for example before going offline).

Browser builds write `main.pdf` and its SyncTeX data into the project folder,
just like local builds. The package shelf defaults to a public one hosted on
GitHub Pages; point `GITLATEX_SHELF_URL` elsewhere, or set it empty to disable
on-demand packages.

### Remote Compiler API

Point GitLaTeX at a web service that compiles LaTeX and it will build there
instead of locally, so you do not need a TeX distribution installed at all. The
app ships with full documentation for building one at **Settings → Compiler
API**. If the API also returns the SyncTeX file, PDF ↔ source sync works for
those builds too.

## Builds

- **One click to PDF**, with the result shown in a pane beside the editor.
- **Full multi-pass builds** — the engine runs, `biber` or `bibtex` runs when your
  document needs it, then the engine reruns until cross-references and citations
  settle. No more compiling three times by hand to clear `??`.
- **Choose your engine**: `pdflatex`, `xelatex` or `lualatex`.
- **A real problems list.** Errors and warnings are parsed out of the LaTeX log
  into a clickable list — click one to jump straight to the line, with squiggles
  in the editor to match.
- **Pick the main file** when your project has more than one `.tex`, so compiling
  a chapter always builds the root document.
- **Lands where you are working.** After a build the PDF opens on the page your
  cursor is on, and what changed on that page is highlighted for a few seconds
  (see [pdf-cursor-sync.md](pdf-cursor-sync.md)).

## PDF ↔ source sync (SyncTeX)

- **Source → PDF:** `Cmd`+click (macOS) or `Ctrl`+click a line in the editor, or
  right-click → **Show in PDF**, and the PDF viewer scrolls to that spot and
  highlights it.
- **PDF → source:** double-click anywhere in the PDF to open the matching `.tex`
  file and jump to the line, which flashes briefly so you can find it.
- Works with any file in a multi-file project, not only the main file.
- Reads the `.synctex.gz` file written by the last compile with a built-in
  reader, so **no TeX installation is needed** for the jump itself. Local and
  browser builds always write it; with a remote Compiler API it works when the
  API returns the file too.
- After editing, positions can be a few lines off until you compile again.
