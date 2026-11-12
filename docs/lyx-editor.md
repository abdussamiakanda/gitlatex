# The LyX-style editor

A "what you see is what you mean" editor for `.tex` files, modelled on
[LyX](https://www.lyx.org). Headings look like headings, lists like lists,
formulas are typeset as you type them, and LaTeX shows only where you need it.
The file stays an ordinary `.tex` file. Compiling, Git, coauthors and the
source editor all see plain LaTeX.

## Turning it on

- **One file:** click **LyX** in the **Source | LyX** switch above the editor.
  **Source** switches back. Both show the same file, and an edit in one shows
  in the other.
- **Every `.tex` file:** **Settings → Editor → Editor style for .tex files →
  LyX style**. Other files (`.bib`, `.sty`…) always open as source.
- **Not at all:** turn off **Settings → Editor → LyX-style editor**. The
  Source | LyX switch disappears and every file opens as source.

## What happens to your LaTeX

Only what you change is rewritten. A paragraph, list item, table or figure you
haven't touched is written back exactly as it was, with its spacing, line
breaks, comments and indentation. A file you only open and read never changes.

What the editor shows as a picture or box:

| In the file | In the editor |
| --- | --- |
| `\section{…}`, `\title{…}`, `\begin{abstract}`… | Headings and front matter, numbered as LaTeX will number them |
| `itemize`, `enumerate`, `description` | Lists, nested by depth |
| `theorem`, `lemma`, `proof`, your own `\newtheorem`s | Theorem paragraphs, numbered |
| `$…$`, `\[…\]`, `equation`, `align`… | Typeset formulas you edit in place |
| `\emph`, `\textbf`, `\textsc`, `\texttt`… | Styled text |
| `\footnote`, `\marginpar` | Footnote and margin-note boxes |
| `% comments` | Grey **notes** (not printed) |
| `\label`, `\ref`, `\cite`, `\url` | Small coloured chips |
| `\includegraphics` | The picture itself (PDF figures show their first page; EPS, see below) |
| `figure`, `table` | Float boxes with numbered captions |
| `tabular` | An editable table (see [Tables](#tables)) |
| `center`, `flushleft`, `flushright` | Aligned paragraphs |

Anything else stays as LaTeX in a red **TeX code** box, which you can edit
directly. Press **Ctrl+L** to make one yourself, for example for a command the
editor doesn't know.

When you insert something that needs a package (a picture, a URL, a booktabs
rule, a theorem type), the line for it is added to the preamble, as LyX does.
A package your file already uses is never added twice.

### EPS figures

Browsers can't draw EPS (PostScript), so an EPS figure is shown from a PDF
made of it:

- **After a compile:** compiling with pdfLaTeX converts each EPS figure to
  `name-eps-converted-to.pdf` next to it, and the editor shows that.
- **Before a compile:** if Ghostscript or `epstopdf` is installed (TeX Live and
  MiKTeX include `epstopdf`), the server converts the figure for display. The
  PDF is made in a temporary folder; nothing is added to your project.

Until then the figure shows as its file name.

## Writing

Every paragraph has a **layout**, shown in the box at the left of the toolbar:
Standard, Section, Itemize, Theorem, Quote and so on. Change it there, or with
**Alt+P** followed by a key:

| Keys | Layout |
| --- | --- |
| Alt+P S | Standard |
| Alt+P 1 … 6 | Part, Chapter, Section, Subsection, Subsubsection, Paragraph |
| Alt+P * then 1 … 6 | The same, unnumbered (`\section*`) |
| Alt+P I / E / D | Itemize / Enumerate / Description |
| Alt+P T / A / D (capital) | Title / Abstract / Date |
| Alt+P Q / V | Quote / Verse |
| Alt+P Space | Opens the layout box |

**Depth** nests a paragraph under the one above it: a list inside a list item,
or a second paragraph of a theorem. **Alt+Shift+→** goes deeper and
**Alt+Shift+←** comes back out. Tab does not indent, as in LyX.

- **Enter** starts a new paragraph. In a list it starts a new item; on an empty
  item it leaves the list. **Alt+Enter** leaves a list in one step.
- **Ctrl+Enter** is a line break (`\\`).
- **Ctrl+Space** is a space that never breaks (`~`).
- **Alt+↑ / Alt+↓** move the paragraph.
- **Alt+P ↑ / ↓ / ← / →** move a whole section with everything in it, or
  promote and demote it.

As you type, the editor follows LaTeX's rules, as LyX does:
- A space at the start of a paragraph, or a second space in a row, is ignored.
- `"` gives typographic quotes.
- `$` starts a formula.

Each rule can be turned off under **Settings → Editor → LyX-style typing**.

### Text styles

| Keys | Style |
| --- | --- |
| Ctrl+E | Emphasis |
| Ctrl+B | Bold |
| Ctrl+U | Underline |
| Ctrl+Shift+P | Typewriter |
| Alt+C C / Alt+C S | Small caps / Sans serif |
| Alt+C Space | Back to the default font |

With text selected, the style applies to it; otherwise it applies to what you
type next.

## Formulas

**Ctrl+M** (or `$`) inserts an inline formula and **Ctrl+Shift+M** a display
formula. **Ctrl+Alt+N** inserts a numbered one, and **Alt+M N** numbers or
unnumbers the selected formula. Type LaTeX (`\alpha`, `x^2`, `\frac`) and it is
typeset as you go. Arrow keys or Esc take you back out to the text.

## Inserting

The toolbar, and **Alt+I** followed by a letter:

| Keys | Inserts |
| --- | --- |
| Alt+I F / M | Footnote / margin note |
| Alt+I N | Note (shown in the editor, never printed) |
| Alt+I L | Label, with a suggested name such as `sec:related-work` |
| Alt+I R | Cross-reference (the app's reference picker) |
| Alt+I C / Z | Citation / citation from Zotero ([citations.md](citations.md)) |
| Alt+I U / H | URL / hyperlink on the selected text |
| Alt+I G | Figure with a picture |
| Alt+I T | Table |
| Alt+A L / C / R | Align left / centre / right (Alt+A J: back to the default) |

Double-click a chip to change it. Double-clicking a label renames it along with
every reference to it, a reference jumps to its label, and a citation, URL or
picture lets you edit its keys, address or options.

## Tables

Tables are edited cell by cell. With the cursor in a table, a second row of
table tools appears below the toolbar.

- **Tab** goes to the next cell; in the last cell it adds a row.
  **Shift+Tab** goes back.
- **Enter** goes to the cell below; in the last row it adds a row.
- **Rows and columns:** add above, below, left or right, or delete. New ones
  take the lines and alignment of their neighbours.
- **Alignment:** in a table, the left, centre and right buttons (and
  **Alt+A**) align the column.
- **Lines:** above or below the row, left or right of the column, or all lines
  on or off. In a booktabs table these are `\toprule`, `\midrule` and
  `\bottomrule`; elsewhere `\hline` and `|`.
- **Merging:** drag across cells of one row (or Shift+click) and click
  **Merge** to make a `\multicolumn`. **Split** undoes it.

A table the editor can't edit cell by cell (one with more cells in a row than
its column spec allows, or an unusual column spec) stays as TeX code.

## The ☰ menu and the command buffer

The **☰** button at the start of the toolbar holds what the other buttons
don't: find & replace, the command buffer, the outline and code preview panes,
your bookmarks, document settings and export. Entries that can't be used at the
cursor are greyed out.

**Alt+X** opens LyX's command buffer at the bottom of the editor. Type a LyX
command and press Enter:

```
layout Section
font-emph
tabular-feature append-row
paragraph-align center
bookmark-goto 2
dialog-toggle toc
buffer-export text
```

**Tab** completes command names and their arguments. **↑ ↓** pick from the
completions, or step through the commands you ran before.

## Find & replace

**Ctrl+F** opens the find bar, filled in with the selected text. Matches are
highlighted everywhere: in text, list items, table cells, footnotes and TeX
code.

- **Enter** goes to the next match and **Shift+Enter** to the previous one.
- **Aa** matches case and **“w”** matches whole words only.
- **Replace** replaces the current match and moves to the next.
- **All** replaces every match in one step, which Ctrl+Z undoes.
- **Esc** closes the bar.

Formulas aren't searched: their LaTeX is not text.

## Outline and code preview

**☰ → Outline pane** shows the sections, numbered, and the figures and
tables with their captions. The section you're in is highlighted, and clicking
an entry goes there. The arrows at the top move the current section up or down
or promote and demote it, with everything in it.

**☰ → Code preview pane** shows the LaTeX written for the paragraph at the
cursor, so you can see what the editor produces.

Both panes stay open from one file to the next until you close them.

## Bookmarks

LyX's bookmarks are five numbered places in a file:

- **Ctrl+Shift+1 … 5** saves one at the cursor, marked with a small number in
  the text.
- **Alt+1 … 5** goes back to it.

Bookmarks move with the text as you edit, and are kept for the next time you
open the file. The **☰** menu lists them and has **Clear bookmarks**. These are
separate from the PDF viewer's bookmarks ([pdf-viewer.md](pdf-viewer.md)).

## Child documents

`\input{chapters/one}`, `\include{chapters/one}` and `\subfile{…}` show as a
TeX-code box. **Double-click** it, or use **☰ → Open child document** (the one
at the cursor, else the next one below it), to open that file in the LyX
editor. The file is found the way TeX finds it: relative to the main file
(`\subfile`: to the file it is in first), with `.tex` added. If it does not
exist yet, you are asked whether to create it.

A child document shows **← Back to main.tex** above the editor. Click it, or use
**☰ → Back to parent document**, to return to the line with its `\input`. The
link also appears when you open a child file directly from the file tree, as
long as some file in the project inputs it. Compiling from a child document
builds the main file as usual.

## Document settings and export

**☰ → Document settings** edits the document class, its options (`11pt`,
`a4paper`, `twocolumn`…) and the preamble, the LaTeX between `\documentclass`
and `\begin{document}`. A file without `\documentclass`, such as a chapter
included with `\input`, has no settings of its own: open the main file instead.

**☰ → Export** saves the file as LaTeX (`.tex`) or as plain text
(`.txt`). The plain text keeps section and item numbers, writes formulas as
LaTeX and leaves notes out. For the PDF, compile and use the PDF's download
button.

## Compiling and the PDF

**Ctrl+S** (or the ▶ button) compiles. **Show in PDF** (the crosshair button)
opens the PDF at the cursor's paragraph, and double-clicking the PDF comes back
to the editor ([compiling.md](compiling.md#pdf--source-sync-synctex)).
