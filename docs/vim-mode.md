# Vim mode and VimTeX-style keybindings

gitlatex's editor has an optional Vim mode, built on
[monaco-vim](https://github.com/brijeshb42/monaco-vim), with a layer of
[VimTeX](https://github.com/lervag/vimtex)-style mappings for LaTeX on top.

- **Turn it on:** **Settings → Editor → Vim keybindings**. It is off by default,
  and monaco-vim is only downloaded the first time you switch it on.
- **Where the VimTeX keys work:** only in TeX files (`.tex`, `.sty`, `.cls`,
  `.ltx`, `.dtx`). In every other file (`.md`, `.bib`, …) the same keys do
  whatever plain Vim does. See [Standard Vim](#standard-vim-every-file).
- **Comments are ignored:** a `\begin`, `\end`, `$` or bracket inside a `%`
  comment never pairs with a real one.

The code lives in `web/src/editor/vimtex.ts` (the VimTeX layer) and
`web/src/editor/vim.ts` (loading monaco-vim, ex commands). The classic editor
at `/classic` has the same keys, in `gitlatex/public/js/editor/`. A shorter
table is also in Settings.

## Text objects

Text objects don't do anything on their own. Put one after an operator (`d`
delete, `c` change, `y` copy, `>` indent, …) or use it in visual mode (`v`).
`i…` means *inside*, `a…` means *around* (including the delimiters).

| Keys | Object |
| --- | --- |
| `ie` `ae` | LaTeX environment (`\begin{…}` … `\end{…}`) |
| `i$` `a$` | Math: `$…$`, `$$…$$`, `\(…\)`, `\[…\]`, and math environments (`equation`, `align`, `gather`, `multline`, …, starred or not) |
| `ic` `ac` | Command: `ic` is the argument the cursor is in (or the first `{}` argument); `ac` is the whole `\name*[…]{…}` |
| `id` `ad` | Delimiters: `()`, `[]`, `{}`, `\{\}`; `ad` also takes `\left`/`\right` or `\bigl`/`\bigr`, … |
| `iP` `aP` | Section: `iP` is the body, `aP` includes the heading. Runs to the next heading of the same or higher level, or to `\end{document}` |
| `im` `am` | `\item` in `itemize`, `enumerate` or `description`: `im` is the text after `\item[…]`, `am` includes `\item` |

They act on the **innermost** object around the cursor. When the opening and
closing tokens each sit on their own line, `ie`, `i$` (display math) and `am`
work on whole lines.

### Example

With the cursor anywhere inside:

```latex
\begin{itemize}
  \item one
  \item two
\end{itemize}
```

| Keys | Result |
| --- | --- |
| `die` | Deletes both `\item` lines, keeps `\begin`/`\end` |
| `dae` | Deletes the whole environment |
| `cie` | Empties the environment and enters insert mode |
| `yae` | Copies the environment (paste with `p`) |
| `vie` | Selects the contents, so you can see what `ie` covers |
| `dam` | Deletes the item under the cursor |
| `cim` | Rewrites the item's text |

More: `ci$` rewrites an equation, `dac` deletes `\textbf{word}`, `cic` changes
just `word`, `yaP` copies a whole section.

Typing `ie` in normal mode *without* an operator starts insert mode and types
`e`, because `i` means insert there.

## Motions

All motions take a count (`3]]`) and can follow an operator (`d]]`). Jumps are
added to the jump list, so `Ctrl-o` takes you back.

| Keys | Moves to |
| --- | --- |
| `]]` `[[` | Next / previous section start |
| `][` `[]` | Next / previous section end |
| `]m` `[m` | Next / previous `\begin{…}` |
| `]M` `[M` | Next / previous `\end{…}` |
| `]n` `[n` | Next / previous math start |
| `]N` `[N` | Next / previous math end |
| `]r` `[r` | Next / previous `\begin{frame}` (Beamer) |
| `]R` `[R` | Next / previous `\end{frame}` |
| `]*` | Next comment end |
| `[*` | Previous comment start |
| `%` | Matching `\begin` ↔ `\end`, `$` ↔ `$`, `\(` ↔ `\)`, `\[` ↔ `\]`, or bracket |

Comments on consecutive lines count as one block for `]*` and `[*`.

## Delete, change and toggle surroundings

Put the cursor anywhere inside the thing, then type the keys in normal mode.

| Keys | Environment | Command | Math | Delimiters |
| --- | --- | --- | --- | --- |
| `ds…` delete | `dse` | `dsc` | `ds$` | `dsd` |
| `cs…` change | `cse` | `csc` | `cs$` | `csd` |
| `ts…` toggle | `tse` / `tss` | `tsc` | `ts$` | `tsd` |

- **`dse`** removes `\begin{…}`/`\end{…}` and keeps the contents. If a token
  was alone on its line, the line goes too.
- **`dsc`** replaces `\cmd[…]{text}` with `text`.
- **`ds$`** removes the math delimiters or math environment.
- **`dsd`** removes a bracket pair, including `\left`/`\right`.
- **`cse`**, **`csc`** ask for a new name.
- **`cs$`** asks for the new math form: `$`, `\(`, `\[`, `$$`, or an
  environment name such as `align`.
- **`csd`** asks for the new opening delimiter: `(`, `[`, `{`, `\{`, `|`, `\|`,
  `\langle`, `\lvert` or `\lVert`. `\left`/`\right` are kept.
- **`tse`** switches to the complementary environment: `itemize` ↔
  `enumerate`, `equation` ↔ `align` (a star is kept). For any other
  environment it asks for a name.
- **`tss`** toggles the environment's star: `equation` ↔ `equation*`.
- **`tsc`** toggles the command's star: `\section` ↔ `\section*`.
- **`ts$`** toggles inline math (`$…$`, `\(…\)`) ↔ display math (`\[…\]`).
- **`tsd`** toggles `(…)` ↔ `\left(…\right)`.

### Other toggles

| Keys | Does |
| --- | --- |
| `tsf` | `\frac{a}{b}` ↔ `a/b` (also `\dfrac`, `\tfrac`). Parentheses are added or removed as needed: `\frac{a+b}{c}` ↔ `(a+b)/c` |
| `tsb` | Adds or removes a trailing `\\` on the current line, ignoring any `%` comment |

## Leader commands

| Keys | Does |
| --- | --- |
| `\ll` | Compile |
| `\lv` | Show the cursor position in the PDF (SyncTeX) |
| `\lt` | Toggle the outline |
| `\le` | Show compile errors |

## Insert mode

| Keys | Does |
| --- | --- |
| `]]` | Closes the innermost open environment: typing `]]` after `\begin{align}…` inserts `\end{align}` |

## Ex commands

| Command | Does |
| --- | --- |
| `:w`, `:up` | Save |
| `:VimtexCompile` | Compile |
| `:VimtexView` | Show the cursor position in the PDF |
| `:VimtexToc` | Toggle the outline |
| `:VimtexErrors` | Show compile errors |

The `:Vimtex…` ex commands work from any file, not only TeX files.

## Standard Vim (every file)

Everything monaco-vim supports works in every file, TeX or not:

- **Modes:** `i a I A o O gi`, visual `v V Ctrl-v gv`, replace `R`, back to
  normal with `Esc`, `Ctrl-[` or `Ctrl-c`.
- **Moving:** `h j k l gj gk`, `w W b B e E ge gE`, `0 ^ $`, `f F t T` + char
  with `;` `,`, `{ }` paragraphs, `( )` sentences, `gg G`, `H M L`,
  `Ctrl-d Ctrl-u Ctrl-f Ctrl-b`, `zz zt zb`, marks `ma` / `` `a `` / `'a`,
  jump list `Ctrl-o Ctrl-i`.
- **Editing:** operators `d c y > < = gu gU g~`, plus `x X D C Y s S J gJ r ~
  p P u Ctrl-r . Ctrl-a Ctrl-x`, and counts (`3dd`).
- **Text objects:** `iw aw iW aW ip ap`, brackets `i( i[ i{ i<` (`ib` = `i(`,
  `iB` = `i{`), quotes ``i" i' i` ``, tags `it at`.
- **Search:** `/ ? n N * # gn gN`.
- **Macros and registers:** `qa … q`, `@a`, `@@`, `"ayy`, `"ap`.
- **Ex:** `:s` / `:%s`, `:g` / `:v`, `:sort`, `:noh`, `:set`, `:map` / `:nmap` /
  `:imap` / `:vmap` / `:unmap`, `:registers`, `:delmarks`.

Outside TeX files, `%`, `[[`, `]]`, `[m`, `]m`, `[*`, `]*` and the `i…`/`a…`
text objects above fall back to plain Vim. The Vim versions of `[[`, `]m` and
`[*` look for C-style code structure and aren't much use in Markdown.

## Notes

- The `ts…` commands start with `t`, so Vim's "move to just before the letter
  s" (`ts`, then another key) runs as soon as you type the third key, as in
  VimTeX.
- The VimTeX `ds…`, `cs…` and `ts…` commands only start from a fresh normal
  mode: not after a count (`2dse` does nothing special) and not in visual mode.
- Every `ds…`, `cs…` and `ts…` edit is a single undo step.
