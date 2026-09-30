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
- **Compiles locally**, so your unpublished work never leaves your machine —
  with your own TeX installation, or with **TeX Live running in the browser**
  when you have none.
- **One command to start.** `pip install gitlatex && gitlatex`.

> The in-browser TeX engine (~190 MB) and any extra LaTeX packages it needs
> are downloaded on first use and cached in `~/.gitlatex`, so compiling without
> a TeX installation needs a network connection once. Everything else — your
> files, the editor, and Git — is local.

---

## Installation

```bash
pip install gitlatex
```

**Requirements**

| | |
| --- | --- |
| Python | 3.8 or newer |
| LaTeX | Optional — [TeX Live](https://www.tug.org/texlive/), [MiKTeX](https://miktex.org/) or [MacTeX](https://www.tug.org/mactex/). Without one, documents compile in the browser |
| Git | Required for cloning, pushing and version history |

### Compilers

**Settings → Compiler** picks where documents are built:

| | |
| --- | --- |
| **Auto** (default) | Local TeX when `pdflatex`/`xelatex`/`lualatex` is on your `PATH`, otherwise the browser |
| **In the browser** | Real TeX Live 2022 (pdfTeX, XeTeX, BibTeX, makeindex) compiled to WebAssembly, from [BusyTeX](https://github.com/busytex/busytex). Missing packages (TikZ, biblatex, extra fonts…) are fetched on demand from a package shelf. No LuaLaTeX, no biber (use `backend=bibtex`), no shell escape |
| **Local TeX** | Your TeX installation, with bibtex/biber |
| **Compiler API** | A remote web service that compiles LaTeX (same format as before; see the classic editor's Settings → Compiler API) |

Browser builds write `main.pdf` and its SyncTeX data into the project folder,
just like local builds. `gitlatex --fetch-engine` downloads the engine ahead of
time (for example before going offline). The package shelf defaults to the one
published by [TexBrowser IDE](https://github.com/jukomol/TexBrowser-IDE); point
`GITLATEX_SHELF_URL` elsewhere, or set it empty to disable on-demand packages.

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

- **Status, diff, pull and push** from the toolbar. Push asks for a commit message
  (default: `Update LaTeX project`), then stages everything, commits and pushes.
  Edit the message or accept the default; Cancel or Escape stops the
  operation. Submitting an empty message also cancels. If the working tree is
  clean, existing commits are pushed without creating an empty commit.
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
  building one at **Settings → Compiler API**. If the API also returns the
  SyncTeX file, PDF ↔ source sync works for those builds too.
- Tells you when a newer GitLaTeX is on PyPI.

---

## Advanced editing

### PDF ↔ source sync (SyncTeX)

- **Source → PDF:** `Cmd`+click (macOS) or `Ctrl`+click a line in the editor, or
  right-click → **Show in PDF**, and the PDF viewer scrolls to that spot and
  highlights it.
- **PDF → source:** double-click anywhere in the PDF to open the matching `.tex`
  file and jump to the line, which flashes briefly so you can find it.
- Works with any file in a multi-file project, not only the main file.
- Reads the `.synctex.gz` file written by the last compile with a built-in
  reader, so **no TeX installation is needed** for the jump itself. Local builds
  always write it; with a remote Compiler API it works when the API returns the
  file too (see **Settings → Compiler API**).
- After editing, positions can be a few lines off until you compile again.

### Snippets

- Create your own **prefix → LaTeX** expansions in **Settings → Snippets**, or
  select text in the editor and right-click → **Save Selection as Snippet**.
- Type a prefix and press `Tab`, or pick it from the suggestion list.
- Bodies use tab stops and placeholders — `$1`, `${1:default}`, `${1|a,b|}`,
  `$0` — so one `fig` can expand into a full figure environment with the cursor
  hopping between caption and label.
- Limit a snippet to `.tex`, `.bib` or all files.
- Snippets are saved in `~/.gitlatex/snippets.json`, so every project and
  browser shares them. **Export** and **Import** move them between machines, and
  Import also accepts VS Code snippet files.

### Vim mode with VimTeX-style mappings

Turn on **Settings → Editor → Vim keybindings** for normal, insert and visual
modes, with `:w` to save. In `.tex` files you also get the parts of
[VimTeX](https://github.com/lervag/vimtex) people use every day:

| | Keys |
| --- | --- |
| Text objects | `ie`/`ae` environment · `i$`/`a$` math · `ic`/`ac` command · `id`/`ad` delimiters · `iP`/`aP` section · `im`/`am` item |
| Motions | `]]` `[[` `][` `[]` sections · `]m` `[m` `]M` `[M` environments · `]n` `[n` `]N` `[N` math · `]r` `[r` `]R` `[R` frames · `]*` `[*` comments · `%` |
| Delete / change / toggle | `dse` `cse` `tse` `tss` environment · `dsc` `csc` `tsc` command · `ds$` `cs$` `ts$` math · `dsd` `csd` `tsd` delimiters · `tsf` fractions · `tsb` `\\` |
| Leader commands | `\ll` compile · `\lv` show in PDF · `\lt` outline · `\le` errors |
| Insert mode | `]]` closes the current environment |
| Ex commands | `:VimtexCompile` · `:VimtexView` · `:VimtexToc` · `:VimtexErrors` |

See [docs/vim-mode.md](docs/vim-mode.md) for what each key does, with examples.

### Review comments

An Overleaf-style review panel for leaving comments on your text.

- **Add a comment:** select some text (or put the cursor on a line) and click
  **Add comment** in the panel, press `Cmd`+`Option`+`M` / `Ctrl`+`Alt`+`M`, or
  right-click → **Add Comment**.
- **Open the panel** with the **Review** button in the toolbar. Its badge shows how
  many comments are open in the current file.
- Comment cards line up with the text they are about and scroll with the editor.
  Commented text is highlighted, with a marker in the margin.
- **Hover** over commented text to see a preview of the comment. Click the
  preview to open that thread in the review panel.
- **Reply** (`Enter` sends, `Shift`+`Enter` adds a new line), **resolve** or
  **reopen**, and **delete** threads or your own replies. Tick **Resolved** in the
  panel to show resolved threads.
- Comments are **signed with your git identity** (`user.name` and `user.email`),
  the same one your commits use.
- **Shared through Git.** Each thread is a small JSON file in
  `.gitlatex/comments/` inside the project, so comments are pushed and pulled
  with your files. Each thread has its own file, so two people starting threads
  at the same time won't get merge conflicts, and replies made on both sides of
  a pull are combined automatically (the app registers a git merge driver for
  these files, so this also works for `git pull` in a terminal).
  See [docs/sync-and-conflicts.md](docs/sync-and-conflicts.md) for how push,
  pull and conflicts are handled.
- Comments **stay attached to their text** as you edit, find it again after a
  pull, and follow a file when you rename it. Deleting a file removes its
  comments.

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
| Show in PDF / double-click says "No SyncTeX data" | Compile first. With a Compiler API, the API must return `synctex` alongside the PDF — see **Settings → Compiler API**. |
| Comments are signed "Anonymous" | Set your git identity: `git config --global user.name "Your Name"`. |
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

The editor UI lives in `web/` (React + TypeScript + Vite) and is built into
`gitlatex/ui/`, which the server serves at `/`. It needs Node 22+:

```bash
cd web
npm install
npm run build        # → gitlatex/ui (then run `gitlatex` as usual)
npm run dev          # hot reload on :5173, proxying the API to `gitlatex --no-browser` on :5000
npm test             # unit tests (vitest)
npm run e2e:gitlatex -- http://127.0.0.1:5000 /tmp/gl-e2e   # browser tests: run `gitlatex --repos /tmp/gl-e2e` first
npm run e2e:features -- http://127.0.0.1:5000 /tmp/gl-e2e  # (and e2e:synctex); they create projects, so never ./repos
```

The previous vanilla-JS editor is still served at `/classic` (no build step).
Vim mode, review comments, spell checking and snippets have been ported to the
new UI and share their settings, snippets and dictionary with it. An install
without a built UI falls back to the classic editor.

`web/` started as [TexBrowser IDE](https://github.com/jukomol/TexBrowser-IDE)
(MIT, see `web/LICENSE-texbrowser`); its browser storage and GitHub sync were
replaced by gitlatex's folders and Git.

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
| `services/synctex.py`, `services/synctex_reader.py` | PDF ↔ source lookups; the reader is a Python port of the `synctex` tool's logic, so no TeX install is needed |
| `services/snippets.py` | User snippets, stored in `~/.gitlatex/snippets.json` |
| `services/projectindex.py` | Parsing `\label{}` and BibTeX entries for autocomplete |
| `services/paths.py` | Path safety and project tree walking |
| `services/updates.py` | The cached PyPI version check |
| `services/comments.py` | Review comment threads, stored in `.gitlatex/comments/` |
| `services/gitrepo.py`, `services/git_backend.py` | Shared GitPython plumbing |
| `routes/workspace.py` | The file API the editor UI uses (open a project, write/move/delete files) |
| `routes/engine.py` | Serves the in-browser TeX engine and package shelf, downloading and caching them in `~/.gitlatex` |
| `engine/manifest.json` | The engine's file list and checksums, generated by `web/scripts/fetch-engine.mjs` |
| `routes/` | One blueprint per area — see `routes/__init__.py` |

To add an endpoint: put the logic in `services/`, then a short handler in the
matching `routes/*.py`. `routes/pages.py` registers last, because its catch-all
serves `index.html` for unknown paths.

**Editor UI** (`web/src/`)

| Path | What lives there |
| --- | --- |
| `state/actions.ts` | Every user-facing operation: projects, files, compiling (browser / local / API), Git |
| `state/workspace.ts` | The open project in memory, written back to disk through one ordered queue |
| `storage/server.ts` | Typed client for the gitlatex server |
| `engine/` | The WebAssembly TeX engine: worker, latexmk-style compile loop, package shelf |
| `editor/`, `pdf/`, `latex/` | Monaco setup and LaTeX language features, the pdf.js viewer, log parsing and SyncTeX |
| `components/` | Panels, dialogs, the projects home, Git panels |

**Classic front end** (`gitlatex/public/`, served at `/classic`)

| Path | What lives there |
| --- | --- |
| `app.js` | Entry point — event wiring only, no logic |
| `js/core/` | `api`, `state`, `storage`, `router`, `filetypes` |
| `js/home/` | `repolist` — the project list on the start page |
| `js/ui/` | `theme`, `modals`, `settings`, `consolepane`, `layout`, `viewer`, `pdfviewer`, `loading` |
| `js/editor/` | `monaco`, `languages`, `completions`, `filetree`, `session`, `outline`, `spell`, `mainfile`, `envcolors`, `projectindex`, `review`, `snippets`, `synctex`, `vim`, `vimtex` |
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

### Releasing

The version comes from the latest `v*` git tag (via `setuptools-scm`), so there
is no version number to edit in the code. To publish to PyPI, go to **Actions →
Publish to PyPI → Run workflow** and pick `patch`, `minor` or `major`. The
workflow tags the next version, builds it and uploads it. Pushing a tag by hand
(`git tag v2.0.0 && git push origin v2.0.0`) works too. Ordinary pushes never
publish.

---

## Credits

Built and maintained by **[Md Abdus Sami Akanda](https://github.com/abdussamiakanda)** and **[Md Atiqur Rahman](https://github.com/revolutionibus)**.

If GitLaTeX saves you some time, you can
[keep the coffee flowing](https://buymeacoffee.com/abdussamiakanda).

---

## License

Released under the [ISC License](https://opensource.org/licenses/ISC).
