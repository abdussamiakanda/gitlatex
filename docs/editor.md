# The editor

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
- **Vim mode** with VimTeX-style mappings — see [vim-mode.md](vim-mode.md).

## Spell checking

- Unknown words in `.tex`, `.txt` and `.md` are underlined as you type.
- **LaTeX-aware**: comments, math (`$...$`, `equation`, `align`, …), verbatim
  blocks, and the arguments of `\ref`, `\cite`, `\url`, `\includegraphics` and
  friends are all skipped, so you only get flagged on actual prose.
- **Built for papers**: prefixed and hyphenated coinages (`nanowire`,
  `ferromagnets`, `anti-symmetric`) resolve against their parts instead of being
  flagged, and US spellings the base dictionary omits are included.
- Fix from the lightbulb or `Ctrl+.`, or add a word to your **personal
  dictionary** — it persists across projects and sessions.

## Snippets

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

## Settings

- **Light and dark themes**, applied to the whole app and the editor together.
- Spell check, Vim mode, font size, word wrap and the minimap.
- Tells you when a newer GitLaTeX is on PyPI.
