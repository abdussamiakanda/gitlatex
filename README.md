<div align="center">

# GitLaTeX IDE

**A local, Git-native LaTeX editor that runs in your browser.**

Write in a Monaco editor, compile to PDF, and push to GitHub — without Overleaf,
without a subscription, and without leaving your own machine.

[![PyPI version](https://img.shields.io/pypi/v/gitlatex?color=blue)](https://pypi.org/project/gitlatex/)
[![PyPI Downloads](https://static.pepy.tech/personalized-badge/gitlatex?period=total&units=INTERNATIONAL_SYSTEM&left_color=BLACK&right_color=GREEN&left_text=downloads)](https://pepy.tech/projects/gitlatex)
[![Python](https://img.shields.io/pypi/pyversions/gitlatex)](https://pypi.org/project/gitlatex/)
[![License: ISC](https://img.shields.io/badge/license-ISC-green.svg)](#license)

</div>

---

## Why GitLaTeX

Overleaf is excellent until you want your files on your own disk, your own Git
remote, and no upload limits. GitLaTeX gives you the same shape of workflow —
editor, live PDF, one-click compile — but everything runs locally against a real
Git repository. Your `.tex` files are just files, and your history is just Git.

- **Your files stay yours.** Plain folders on your disk, versioned with real Git.
- **No account, no subscription, no upload cap.**
- **Compiles locally**, so your unpublished work never leaves your machine.
- **One command to start.** `pip install gitlatex && gitlatex`.

> The editor itself (Monaco), the icon set and the web fonts are loaded from a
> CDN, so the interface needs a network connection the first time it is opened
> on a machine. Everything else — your files, compiling, and Git — is local.

---

## Installation

```bash
pip install gitlatex
```

**Requirements**

| | |
| --- | --- |
| Python | 3.8 or newer |
| LaTeX | A distribution providing `pdflatex` — [TeX Live](https://www.tug.org/texlive/), [MiKTeX](https://miktex.org/), or [MacTeX](https://www.tug.org/mactex/) |
| Git | Required for cloning, pushing and version history |

LaTeX and Git are optional if you only want to edit files, but compiling and the
Git features need them on your `PATH`.

---

## Quick start

```bash
gitlatex
```

Your browser opens at **http://localhost:5000**. Clone a repository or create a
local folder, open it, and start writing. Changes save automatically as you type.

**Command line options**

| Option | Description |
| --- | --- |
| `--port`, `-p` | Port to serve on (default: `5000`) |
| `--host` | Bind address (default: `127.0.0.1`) |
| `--no-browser` | Do not open a browser on start |
| `--repos` | Where projects live (default: `./repos` in the current directory) |

```bash
gitlatex --port 3000 --repos ~/Documents/papers
```

---

## Features

### Editor

Built on [Monaco](https://microsoft.github.io/monaco-editor/), the editor that
powers VS Code.

- **LaTeX and BibTeX syntax highlighting** with themes tuned for both — commands,
  environment names, math delimiters, labels and citation keys each get their own
  colour, in light and dark.
- **Autocomplete** for 150+ LaTeX commands and 50+ environments. Inside `\ref{}`
  and `\cite{}` it completes from your project's actual labels and `.bib` keys,
  showing the title, author and year of each entry as you pick.
- **BibTeX IntelliSense** — entry types after `@`, and field names inside an entry.
- **Document outline** of every chapter, section and subsection, tracking your
  cursor and jumping you anywhere in the file with a click.
- **Matched `\begin`/`\end` colouring** so nested environments are obvious at a
  glance, and you can see immediately when one is left unclosed.
- **Autosave** — edits are written to disk shortly after you stop typing.

### Spell checking

- Unknown words in `.tex`, `.txt` and `.md` are underlined as you type.
- **LaTeX-aware**: comments, math (`$...$`, `equation`, `align`, …), verbatim
  blocks, and the arguments of `\ref`, `\cite`, `\url`, `\includegraphics` and
  friends are all skipped, so you only get flagged on actual prose.
- **Built for papers**: prefixed and hyphenated coinages (`nanowire`,
  `ferromagnets`, `anti-symmetric`) resolve against their parts instead of being
  flagged, and US spellings the base dictionary omits are included.
- Fix from the lightbulb or `Ctrl+.`, or add a word to your **personal
  dictionary** — it persists across projects and sessions.

### Compiling

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

### Git and version history

- **Status, diff, pull and push** from the toolbar. Push stages everything,
  commits with a timestamp, and pushes in one action.
- Pull and push **enable themselves only when there is something to do**, with
  ahead/behind counts read from the remote.
- **Version history panel** listing your commits, with the files each one touched
  and per-file insertion/deletion counts.
- **Side-by-side diffs** for any file in any commit, for your uncommitted working
  tree, or **between any two commits** you select.

### Settings

- **Light and dark themes**, applied to the whole app and the editor together.
- Spell check on or off.
- **Remote Compiler API** — point GitLaTeX at a web service that compiles LaTeX
  and it will build there instead of locally, so you do not need a TeX
  distribution installed at all. The app ships with full documentation for
  building one at **Settings → Compiler API**.
- Tells you when a newer GitLaTeX is on PyPI.

---

## Workflow

1. Run `gitlatex`.
2. **Add a project** — clone from a Git URL, or create a local folder.
3. **Open it** and edit. The file tree supports creating, renaming, moving
   (drag and drop), deleting and uploading.
4. **Compile** to build the PDF and see any problems.
5. **Push** when you are ready.

Projects live in `./repos` unless you pass `--repos`.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Compile fails immediately | Install a LaTeX distribution and make sure `pdflatex` is on your `PATH`. |
| Citations show as `??` | Install `biber` (for `biblatex`) or `bibtex` with your TeX distribution. |
| Port already in use | Run on another port: `gitlatex --port 3000`. |
| Spell check unavailable | `pip install symspellpy` — it ships as a dependency, but a partial install can miss it. |
| Windows: "The process cannot access the file… gitlatex.exe" | Another instance is running. Close it and try again. |
| Windows: a project will not delete | A file in it is open elsewhere. Close any Explorer window or terminal sitting in that folder. |

---

## Contributing

Contributions are welcome. Run from a clone:

```bash
git clone https://github.com/abdussamiakanda/gitlatex.git
cd gitlatex
pip install -e .
gitlatex
```

There is **no build step**. The browser loads the ES modules directly, so editing
a file and reloading the page is the entire feedback loop.

### Project layout

The code is split by area, so a change usually touches one small file.

**Server** (`gitlatex/`) — two layers: `services/` holds the logic and knows
nothing about HTTP, `routes/` holds thin blueprints that parse a request, call a
service and return JSON. That is why `services/spell.py` and `routes/spell.py`
both exist: the first is the spell checker, the second is the four endpoints in
front of it.

| Path | What lives there |
| --- | --- |
| `server.py` | CLI entry point — argument parsing only |
| `app.py` | Flask app factory: CORS, request logging, blueprint registration |
| `state.py` | The three process-wide values: repos dir, selected project, last compile error |
| `http.py` | Request helpers and MIME/extension tables |
| `services/spell.py` | LaTeX-aware spell checking on top of symspellpy |
| `services/latex.py` | Running the engine + bibtex/biber, and parsing the log |
| `services/projectindex.py` | Parsing `\label{}` and BibTeX entries for autocomplete |
| `services/paths.py` | Path safety and project tree walking |
| `services/updates.py` | The cached PyPI version check |
| `services/gitrepo.py`, `services/git_backend.py` | Shared GitPython plumbing |
| `routes/` | One blueprint per area — see `routes/__init__.py` |

To add an endpoint: put the logic in `services/`, then a short handler in the
matching `routes/*.py`. `routes/pages.py` registers last, because its catch-all
serves `index.html` for unknown paths.

**Front end** (`gitlatex/public/`)

| Path | What lives there |
| --- | --- |
| `app.js` | Entry point — event wiring only, no logic |
| `js/core/` | `api`, `state`, `storage`, `router`, `filetypes` |
| `js/ui/` | `theme`, `modals`, `settings`, `consolepane`, `layout`, `viewer`, `loading` |
| `js/editor/` | `monaco`, `languages`, `completions`, `filetree`, `session`, `outline`, `spell`, `mainfile`, `envcolors`, `projectindex` |
| `js/build/` | `compile`, `problems` |
| `js/git/` | `actions`, `menu`, `versions`, `diffview` |
| `css/` | One stylesheet per area — the `<link>` order in `index.html` **is** the cascade order |

Three conventions worth knowing:

- **Shared state** lives on the single `state` object in `js/core/state.js`.
  Anything only one module cares about stays local to that module.
- **Buttons** opt in with `data-action="name"` in the markup plus an entry in the
  `ACTIONS` map in `app.js`. One delegated listener dispatches them all, so a new
  button needs no `id` and no new listener.
- **Loading states** come from `js/ui/loading.js` — `showSkeleton` for lists,
  `setPaneLoading` for panes, `setButtonLoading` for actions. Use these rather
  than inventing a fourth pattern.

---

## Credits

Built and maintained by **[Md Abdus Sami Akanda](https://github.com/abdussamiakanda)** and **[Md Atiqur Rahman](https://github.com/revolutionibus)**.

If GitLaTeX saves you some time, you can
[keep the coffee flowing](https://buymeacoffee.com/abdussamiakanda).

---

## License

Released under the [ISC License](https://opensource.org/licenses/ISC).
