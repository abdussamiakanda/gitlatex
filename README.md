<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/abdussamiakanda/gitlatex/master/web/public/logo-dark.png">
  <img src="https://raw.githubusercontent.com/abdussamiakanda/gitlatex/master/web/public/logo-light.png" alt="GitLaTeX" width="300">
</picture>

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

The in-browser TeX engine (~190 MB) is downloaded once, on first use. Everything
else — your files, the editor and Git — stays local.

---

## Getting started

```bash
pip install gitlatex
gitlatex
```

Your browser opens at **http://localhost:5000**. Start from a template, clone a
repository, import a `.zip` or open a folder, and start writing. Changes save
automatically as you type.

| Requirement | |
| --- | --- |
| Python | 3.8 or newer |
| Git | For cloning, pushing and version history |
| LaTeX | Optional — [TeX Live](https://www.tug.org/texlive/), [MiKTeX](https://miktex.org/) or [MacTeX](https://www.tug.org/mactex/). Without one, documents compile in the browser |

| Option | Description |
| --- | --- |
| `--port`, `-p` | Port to serve on (default: `5000`) |
| `--host` | Bind address (default: `127.0.0.1`) |
| `--no-browser` | Do not open a browser on start |
| `--repos` | Where projects live (default: `./repos` in the current directory) |
| `--fetch-engine` | Download the in-browser TeX engine now, then exit |

---

## Features

- **A real code editor** — Monaco (from VS Code) with LaTeX and BibTeX
  highlighting, autocomplete for labels and citations, an outline, LaTeX-aware
  spell checking and snippets. [More](https://github.com/abdussamiakanda/gitlatex/blob/master/docs/editor.md)
- **Compile anywhere** — with your own TeX, with TeX Live in the browser, or with
  a remote compiler, in full multi-pass builds with a clickable problems list.
  [More](https://github.com/abdussamiakanda/gitlatex/blob/master/docs/compiling.md)
- **PDF ↔ source sync** — click a line to find it in the PDF, double-click the
  PDF to jump back, and land on your cursor's page after every build.
  [More](https://github.com/abdussamiakanda/gitlatex/blob/master/docs/compiling.md#pdf--source-sync-synctex)
- **Git built in** — stage, commit, pull, push, branches and merge conflicts in a
  VS Code-style panel, plus history and side-by-side diffs.
  [More](https://github.com/abdussamiakanda/gitlatex/blob/master/docs/git.md)
- **Review comments** — Overleaf-style comment threads, shared with coauthors
  through Git. [More](https://github.com/abdussamiakanda/gitlatex/blob/master/docs/review-comments.md)
- **Vim mode** with VimTeX-style keys. [More](https://github.com/abdussamiakanda/gitlatex/blob/master/docs/vim-mode.md)

All the docs are in [`docs/`](https://github.com/abdussamiakanda/gitlatex/tree/master/docs).

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Compile fails immediately | With **Local TeX**, make sure `pdflatex` is on your `PATH`, or switch **Settings → Compiler** to **Auto** or **In the browser**. |
| Citations show as `??` | Locally, install `biber` or `bibtex`. In the browser, use `backend=bibtex` with biblatex. |
| Port already in use | `gitlatex --port 3000` |

More in [docs/troubleshooting.md](https://github.com/abdussamiakanda/gitlatex/blob/master/docs/troubleshooting.md).

---

## Contributing

Contributions are welcome. See
[CONTRIBUTING.md](https://github.com/abdussamiakanda/gitlatex/blob/master/CONTRIBUTING.md)
for running from source, the project layout and releasing.

---

## Credits

Built and maintained by **[Md Abdus Sami Akanda](https://github.com/abdussamiakanda)** and **[Md Atiqur Rahman](https://github.com/revolutionibus)**,
with contributions from **[Md Shamim Towhid](https://github.com/shamimtowhid)**.

Parts of the editor UI and the in-browser LaTeX compiler come from
**[Jahir Uddin Komol](https://github.com/jukomol)**'s
[TexBrowser IDE](https://github.com/jukomol/TexBrowser-IDE).

If GitLaTeX saves you some time, you can
[keep the coffee flowing](https://buymeacoffee.com/abdussamiakanda).

---

## License

Released under the [ISC License](https://opensource.org/licenses/ISC).
