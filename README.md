# GitLaTeX IDE

A simple web-based IDE for LaTeX projects with Git support. Create workspaces, clone repos, edit in a Monaco-powered editor, compile to PDF, and push changes—without Overleaf or the command line.

---

## Installation

Install from PyPI:

```bash
pip install gitlatex
```

**Requirements:** Python 3.8+, and (for full use) Git and a LaTeX distribution with `pdflatex` (e.g. [TeX Live](https://www.tug.org/texlive/), [MiKTeX](https://miktex.org/)).

---

## Quick start

```bash
gitlatex
```

Your browser will open at **http://localhost:5000**. Create a workspace or clone a repo, then open it to edit, compile, and use Git (status, diff, commit, push) from the toolbar.

**Options:**

| Option | Description |
|--------|-------------|
| `--port`, `-p` | Port (default: 5000) |
| `--host` | Bind host (default: 127.0.0.1) |
| `--no-browser` | Do not open the browser on start |
| `--repos` | Directory for workspaces (default: `./repos` in current working directory) |

Example: `gitlatex --port 3000 --repos /path/to/my/repos`

---

## Features

- **Workspaces** – Create local folders or clone from a Git URL (e.g. GitHub).
- **File tree** – Create, rename, move, delete, and upload files and folders.
- **Editor** – Monaco editor, multiple tabs, resizable panels.
- **Compile** – Build with `pdflatex`, view PDF in-app, see errors in the console.
- **Git** – Status, diff, commit, and push from the **Git** dropdown in the toolbar.
- **Settings** – Light/dark theme; optional remote Compiler API (URL + API key) to compile via a web service instead of local `pdflatex`.

---

## Workflow

1. Run `gitlatex` and open the app in your browser.
2. **Add a project** – Create a new workspace or clone from a Git URL.
3. **Open** – Click a repo to open the editor.
4. **Edit** – Use the file tree and editor; click **Compile** to build.
5. **Git** – Use the **Git** menu for Status, Diff, Commit, Push.

Projects are stored in the `repos` directory (or the path you set with `--repos`).

---

## Troubleshooting

- **Compile fails** – Install a LaTeX distribution and ensure `pdflatex` is on your PATH.
- **Port in use** – Use another port: `gitlatex --port 3000`.
- **Windows: "The process cannot access the file... gitlatex.exe"** – Another instance is running. Close it, then run `gitlatex` again.

---

## Development

Run from source (no PyPI install): clone the repository, then from its root:

```bash
pip install -e .
gitlatex
```

Or run the package without installing:

```bash
pip install flask gitpython
python -m gitlatex
```

---

## Author Note

This project was introduced to me by [Atiq Bro](https://github.com/revolutionibus). He was learning node. Then I kinda hijacked his project and made some ui change, added some features and then created another branch to publish it as a python package.

---

## License

ISC
