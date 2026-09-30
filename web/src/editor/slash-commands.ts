/**
 * Notion-style slash commands. Typing "/" at the start of a line (or after a
 * space) opens a menu of ready-made LaTeX blocks. Selecting one inserts a
 * snippet with tab stops and adds any package it needs to the preamble.
 */

export type SlashCategory = 'Structure' | 'Text' | 'Lists' | 'Math' | 'Figures & tables' | 'References' | 'Code' | 'Layout' | 'Slides';

export type Wizard = 'table' | 'matrix' | 'image' | 'cite' | 'ref' | 'symbols';

export interface SlashCommand {
  id: string;
  title: string;
  description: string;
  category: SlashCategory;
  /** Material Symbols icon shown in the menu tile. */
  icon: string;
  keywords?: string[];
  /** Monaco snippet syntax. `${TM_SELECTED_TEXT}` is not available here. */
  snippet?: string;
  packages?: { name: string; options?: string }[];
  /** Opens an interactive helper instead of inserting a fixed snippet. */
  wizard?: Wizard;
  /** LaTeX math rendered with KaTeX as a live preview in the menu. */
  preview?: string;
}

const pkg = (name: string, options?: string) => ({ name, options });

export const SLASH_COMMANDS: SlashCommand[] = [
  // Structure
  { id: 'section', title: 'Section', description: 'Numbered section heading', category: 'Structure', icon: 'format_h1', keywords: ['heading', 'h1'], snippet: '\\section{${1:Title}}\\label{sec:${2:label}}\n$0' },
  { id: 'subsection', title: 'Subsection', description: 'Second-level heading', category: 'Structure', icon: 'format_h2', keywords: ['heading', 'h2'], snippet: '\\subsection{${1:Title}}\n$0' },
  { id: 'subsubsection', title: 'Subsubsection', description: 'Third-level heading', category: 'Structure', icon: 'format_h3', keywords: ['heading', 'h3'], snippet: '\\subsubsection{${1:Title}}\n$0' },
  { id: 'chapter', title: 'Chapter', description: 'Chapter heading (report/book)', category: 'Structure', icon: 'book', snippet: '\\chapter{${1:Title}}\\label{ch:${2:label}}\n$0' },
  { id: 'title', title: 'Title block', description: 'Title, author, date and \\maketitle', category: 'Structure', icon: 'title', keywords: ['maketitle', 'author'], snippet: '\\title{${1:Title}}\n\\author{${2:Author}}\n\\date{${3:\\today}}\n\\maketitle\n$0' },
  { id: 'abstract', title: 'Abstract', description: 'Summary at the start of a paper', category: 'Structure', icon: 'subject', snippet: '\\begin{abstract}\n\t${1:Summarise the paper here.}\n\\end{abstract}\n$0' },
  { id: 'toc', title: 'Table of contents', description: 'Automatic table of contents', category: 'Structure', icon: 'toc', keywords: ['contents', 'tableofcontents'], snippet: '\\tableofcontents\n$0' },
  { id: 'appendix', title: 'Appendix', description: 'Start the appendices', category: 'Structure', icon: 'post_add', snippet: '\\appendix\n\\section{${1:Supplementary material}}\n$0' },

  // Text
  { id: 'bold', title: 'Bold', description: 'Bold text', category: 'Text', icon: 'format_bold', keywords: ['strong', 'textbf'], snippet: '\\textbf{${1:text}}$0' },
  { id: 'italic', title: 'Italic', description: 'Italic text', category: 'Text', icon: 'format_italic', keywords: ['textit', 'emph'], snippet: '\\textit{${1:text}}$0' },
  { id: 'underline', title: 'Underline', description: 'Underlined text', category: 'Text', icon: 'format_underlined', snippet: '\\underline{${1:text}}$0' },
  { id: 'color', title: 'Coloured text', description: 'Text in a colour', category: 'Text', icon: 'format_color_text', keywords: ['colour', 'textcolor'], snippet: '\\textcolor{${1|red,blue,teal,orange,violet,gray|}}{${2:text}}$0', packages: [pkg('xcolor')] },
  { id: 'footnote', title: 'Footnote', description: 'Footnote at the bottom of the page', category: 'Text', icon: 'superscript', snippet: '\\footnote{${1:text}}$0' },
  { id: 'quote', title: 'Quote', description: 'Indented quotation', category: 'Text', icon: 'format_quote', keywords: ['quotation', 'blockquote'], snippet: '\\begin{quote}\n\t${1:Quotation}\n\\end{quote}\n$0' },
  { id: 'link', title: 'Link', description: 'Clickable hyperlink', category: 'Text', icon: 'link', keywords: ['href', 'url', 'hyperlink'], snippet: '\\href{${1:https://example.org}}{${2:link text}}$0', packages: [pkg('hyperref')] },
  { id: 'center', title: 'Centred block', description: 'Centre content', category: 'Text', icon: 'format_align_center', snippet: '\\begin{center}\n\t${1}\n\\end{center}\n$0' },
  { id: 'lorem', title: 'Dummy text', description: 'Lorem ipsum paragraphs', category: 'Text', icon: 'notes', keywords: ['lipsum', 'placeholder', 'lorem ipsum'], snippet: '\\lipsum[${1:1-2}]\n$0', packages: [pkg('lipsum')] },
  { id: 'todo', title: 'To-do note', description: 'Margin note for later', category: 'Text', icon: 'sticky_note_2', keywords: ['todonotes', 'comment'], snippet: '\\todo{${1:Fix this}}$0', packages: [pkg('todonotes')] },

  // Lists
  { id: 'itemize', title: 'Bulleted list', description: 'Unordered list', category: 'Lists', icon: 'format_list_bulleted', keywords: ['itemize', 'bullet', 'ul'], snippet: '\\begin{itemize}\n\t\\item ${1:First}\n\t\\item ${2:Second}\n\\end{itemize}\n$0' },
  { id: 'enumerate', title: 'Numbered list', description: 'Ordered list', category: 'Lists', icon: 'format_list_numbered', keywords: ['enumerate', 'ol', 'ordered'], snippet: '\\begin{enumerate}\n\t\\item ${1:First}\n\t\\item ${2:Second}\n\\end{enumerate}\n$0' },
  { id: 'enumerate-custom', title: 'Custom numbered list', description: '(a), (b)… or i., ii.… labels with enumitem', category: 'Lists', icon: 'list_alt', keywords: ['enumitem', 'label', 'alph', 'roman'], snippet: '\\begin{enumerate}[label=${1|(\\alph*),\\roman*.,\\Alph*),Step \\arabic*:|}, leftmargin=${2:2.4em}]\n\t\\item ${3:First}\n\t\\item ${4:Second}\n\\end{enumerate}\n$0', packages: [pkg('enumitem')] },
  { id: 'description', title: 'Definition list', description: 'Terms and descriptions', category: 'Lists', icon: 'segment', keywords: ['description', 'glossary'], snippet: '\\begin{description}\n\t\\item[${1:Term}] ${2:Definition}\n\\end{description}\n$0' },
  { id: 'checklist', title: 'Checklist', description: 'List with check boxes', category: 'Lists', icon: 'checklist', keywords: ['todo', 'tasks', 'checkbox'], snippet: '\\begin{itemize}[label=$\\square$]\n\t\\item ${1:Task one}\n\t\\item[$\\boxtimes$] ${2:Done task}\n\\end{itemize}\n$0', packages: [pkg('enumitem'), pkg('amssymb')] },

  // Math
  { id: 'inline-math', title: 'Inline math', description: 'Formula inside a sentence', category: 'Math', icon: 'variables', keywords: ['formula', 'dollar'], snippet: '$${1:x^2}$$0', preview: 'x^2' },
  { id: 'equation', title: 'Equation', description: 'Numbered display equation', category: 'Math', icon: 'function', keywords: ['formula', 'display math'], snippet: '\\begin{equation}\n\t${1:E = mc^2}\n\t\\label{eq:${2:label}}\n\\end{equation}\n$0', preview: 'E = mc^2 \\qquad (1)' },
  { id: 'display-math', title: 'Display math', description: 'Unnumbered centred formula', category: 'Math', icon: 'fit_screen', keywords: ['unnumbered'], snippet: '\\[\n\t${1:a^2 + b^2 = c^2}\n\\]\n$0', preview: 'a^2 + b^2 = c^2' },
  { id: 'align', title: 'Aligned equations', description: 'Multiple equations aligned at =', category: 'Math', icon: 'format_align_justify', keywords: ['align', 'amsmath', 'system'], snippet: '\\begin{align}\n\t${1:f(x)} &= ${2:x^2 + 2x + 1} \\\\\\\\\n\t       &= ${3:(x+1)^2}\n\\end{align}\n$0', packages: [pkg('amsmath')], preview: '\\begin{aligned} f(x) &= x^2+2x+1 \\\\ &= (x+1)^2 \\end{aligned}' },
  { id: 'matrix', title: 'Matrix', description: 'Pick size and brackets visually', category: 'Math', icon: 'grid_on', keywords: ['pmatrix', 'bmatrix', 'array', 'vector'], wizard: 'matrix', packages: [pkg('amsmath')], preview: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
  { id: 'fraction', title: 'Fraction', description: 'a over b', category: 'Math', icon: 'percent', keywords: ['frac', 'divide'], snippet: '\\frac{${1:a}}{${2:b}}$0', preview: '\\frac{a}{b}' },
  { id: 'cases', title: 'Piecewise function', description: 'Cases with conditions', category: 'Math', icon: 'data_object', keywords: ['cases', 'piecewise'], snippet: '\\begin{equation}\n\t${1:f(x)} = \\begin{cases}\n\t\t${2:x} & \\text{if } ${3:x \\ge 0}, \\\\\\\\\n\t\t${4:-x} & \\text{otherwise.}\n\t\\end{cases}\n\\end{equation}\n$0', packages: [pkg('amsmath')], preview: 'f(x)=\\begin{cases} x & x\\ge 0\\\\ -x & \\text{otherwise}\\end{cases}' },
  { id: 'integral', title: 'Integral', description: 'Definite integral', category: 'Math', icon: 'area_chart', snippet: '\\int_{${1:a}}^{${2:b}} ${3:f(x)}\\,\\mathrm{d}${4:x}$0', preview: '\\int_a^b f(x)\\,\\mathrm{d}x' },
  { id: 'sum', title: 'Sum', description: 'Summation with limits', category: 'Math', icon: 'functions', keywords: ['sigma', 'series'], snippet: '\\sum_{${1:i=1}}^{${2:n}} ${3:a_i}$0', preview: '\\sum_{i=1}^{n} a_i' },
  { id: 'limit', title: 'Limit', description: 'Limit expression', category: 'Math', icon: 'trending_flat', snippet: '\\lim_{${1:x \\to \\infty}} ${2:f(x)}$0', preview: '\\lim_{x\\to\\infty} f(x)' },
  { id: 'theorem', title: 'Theorem', description: 'Theorem environment (defines it if needed)', category: 'Math', icon: 'lightbulb', keywords: ['lemma', 'amsthm', 'proposition'], snippet: '\\begin{theorem}\\label{thm:${1:label}}\n\t${2:Statement.}\n\\end{theorem}\n$0', packages: [pkg('amsthm')] },
  { id: 'proof', title: 'Proof', description: 'Proof with QED box', category: 'Math', icon: 'verified', keywords: ['amsthm', 'qed'], snippet: '\\begin{proof}\n\t${1:Argument.}\n\\end{proof}\n$0', packages: [pkg('amsthm')] },
  { id: 'symbols', title: 'Symbol palette', description: 'Greek letters, operators, arrows…', category: 'Math', icon: 'emoji_symbols', keywords: ['greek', 'arrow', 'symbol', 'special character'], wizard: 'symbols' },

  // Figures & tables
  { id: 'image', title: 'Image', description: 'Insert an image from the project (or upload one)', category: 'Figures & tables', icon: 'image', keywords: ['figure', 'picture', 'photo', 'includegraphics', 'png', 'jpg'], wizard: 'image', packages: [pkg('graphicx')] },
  { id: 'table', title: 'Table', description: 'Pick rows × columns — booktabs styling', category: 'Figures & tables', icon: 'table', keywords: ['tabular', 'grid', 'booktabs'], wizard: 'table', packages: [pkg('booktabs')] },
  { id: 'side-by-side', title: 'Side-by-side figures', description: 'Two images with sub-captions', category: 'Figures & tables', icon: 'photo_library', keywords: ['subfigure', 'subcaption', 'two images'], snippet: '\\begin{figure}[htbp]\n\t\\centering\n\t\\begin{subfigure}{0.48\\linewidth}\n\t\t\\centering\n\t\t\\includegraphics[width=\\linewidth]{${1:left}}\n\t\t\\caption{${2:Left}}\n\t\\end{subfigure}\\hfill\n\t\\begin{subfigure}{0.48\\linewidth}\n\t\t\\centering\n\t\t\\includegraphics[width=\\linewidth]{${3:right}}\n\t\t\\caption{${4:Right}}\n\t\\end{subfigure}\n\t\\caption{${5:Caption}}\n\t\\label{fig:${6:label}}\n\\end{figure}\n$0', packages: [pkg('graphicx'), pkg('subcaption')] },
  { id: 'tikz', title: 'TikZ drawing', description: 'Vector drawing (fetched on demand)', category: 'Figures & tables', icon: 'draw', keywords: ['tikzpicture', 'diagram', 'draw'], snippet: '\\begin{tikzpicture}\n\t\\draw[thick, ->] (0,0) -- (${1:2},${2:1}) node[right] {${3:label}};\n\t\\filldraw[blue!40] (0,0) circle (2pt);\n\\end{tikzpicture}\n$0', packages: [pkg('tikz')] },
  { id: 'plot', title: 'Function plot', description: 'PGFPlots chart (fetched on demand)', category: 'Figures & tables', icon: 'show_chart', keywords: ['pgfplots', 'chart', 'graph'], snippet: '\\begin{tikzpicture}\n\t\\begin{axis}[xlabel=$x$, ylabel=$y$, grid=major, width=0.8\\linewidth]\n\t\t\\addplot[blue, thick, domain=${1:-3}:${2:3}, samples=100] {${3:x^2}};\n\t\\end{axis}\n\\end{tikzpicture}\n$0', packages: [pkg('pgfplots')] },

  // References
  { id: 'cite', title: 'Citation', description: 'Cite from your .bib files — or import by DOI', category: 'References', icon: 'bookmarks', keywords: ['bibliography', 'reference', 'doi', 'bibtex'], wizard: 'cite' },
  { id: 'ref', title: 'Cross-reference', description: 'Refer to a labelled section, figure or equation', category: 'References', icon: 'find_in_page', keywords: ['label', 'reference', 'eqref'], wizard: 'ref' },
  { id: 'label', title: 'Label', description: 'Name this spot for cross-references', category: 'References', icon: 'label', snippet: '\\label{${1|sec,fig,tab,eq|}:${2:name}}$0' },
  { id: 'bibliography', title: 'Bibliography', description: 'BibTeX bibliography from references.bib', category: 'References', icon: 'library_books', keywords: ['references', 'bibtex', 'natbib'], snippet: '\\bibliographystyle{${1|plain,unsrt,alpha,abbrv,ieeetr,plainnat|}}\n\\bibliography{${2:references}}\n$0' },

  // Code
  { id: 'code', title: 'Code listing', description: 'Syntax-highlighted source code', category: 'Code', icon: 'code', keywords: ['listings', 'lstlisting', 'source', 'program'], snippet: '\\begin{lstlisting}[language=${1|Python,C,C++,Java,JavaScript,Matlab,R,bash,SQL,TeX|}, basicstyle=\\ttfamily\\small, frame=single]\n${2:print("Hello, world!")}\n\\end{lstlisting}\n$0', packages: [pkg('listings')] },
  { id: 'verbatim', title: 'Verbatim', description: 'Text exactly as typed', category: 'Code', icon: 'terminal', snippet: '\\begin{verbatim}\n${1}\n\\end{verbatim}\n$0' },
  { id: 'algorithm', title: 'Algorithm', description: 'Pseudocode with algpseudocode', category: 'Code', icon: 'account_tree', keywords: ['pseudocode', 'algorithmic'], snippet: '\\begin{algorithm}[htbp]\n\t\\caption{${1:Algorithm name}}\n\t\\begin{algorithmic}[1]\n\t\t\\Require ${2:input}\n\t\t\\For{${3:$i = 1$ to $n$}}\n\t\t\t\\State ${4:do something}\n\t\t\\EndFor\n\t\t\\State \\Return ${5:result}\n\t\\end{algorithmic}\n\\end{algorithm}\n$0', packages: [pkg('algorithm'), pkg('algpseudocode')] },

  // Layout
  { id: 'newpage', title: 'New page', description: 'Start a new page', category: 'Layout', icon: 'insert_page_break', keywords: ['pagebreak', 'clearpage'], snippet: '\\newpage\n$0' },
  { id: 'columns', title: 'Two columns', description: 'Multi-column text', category: 'Layout', icon: 'view_column', keywords: ['multicol'], snippet: '\\begin{multicols}{${1:2}}\n\t${2}\n\\end{multicols}\n$0', packages: [pkg('multicol')] },
  { id: 'minipage', title: 'Mini-pages', description: 'Two boxes side by side', category: 'Layout', icon: 'view_week', snippet: '\\noindent\n\\begin{minipage}[t]{0.48\\linewidth}\n\t${1:Left}\n\\end{minipage}\\hfill\n\\begin{minipage}[t]{0.48\\linewidth}\n\t${2:Right}\n\\end{minipage}\n$0' },
  { id: 'margins', title: 'Page margins', description: 'Set margins with geometry (preamble)', category: 'Layout', icon: 'margin', keywords: ['geometry', 'paper'], snippet: '\\geometry{margin=${1:2.5cm}}\n$0', packages: [pkg('geometry')] },
  { id: 'header', title: 'Header & footer', description: 'Custom headers with fancyhdr (preamble)', category: 'Layout', icon: 'vertical_align_top', keywords: ['fancyhdr', 'running head', 'page number'], snippet: '\\pagestyle{fancy}\n\\fancyhf{}\n\\fancyhead[L]{${1:Title}}\n\\fancyhead[R]{\\thepage}\n$0', packages: [pkg('fancyhdr')] },
  { id: 'vspace', title: 'Vertical space', description: 'Extra space between blocks', category: 'Layout', icon: 'height', snippet: '\\vspace{${1:1em}}\n$0' },

  // Slides
  { id: 'frame', title: 'Slide', description: 'Beamer frame', category: 'Slides', icon: 'slideshow', keywords: ['beamer', 'frame', 'presentation'], snippet: '\\begin{frame}{${1:Slide title}}\n\t\\begin{itemize}\n\t\t\\item ${2:Point}\n\t\\end{itemize}\n\\end{frame}\n$0' },
  { id: 'block', title: 'Slide block', description: 'Highlighted beamer block', category: 'Slides', icon: 'crop_square', keywords: ['beamer', 'alertblock', 'exampleblock'], snippet: '\\begin{${1|block,alertblock,exampleblock|}}{${2:Title}}\n\t${3:Content}\n\\end{$1}\n$0' },
];

/** Rank commands for a query (fuzzy subsequence + keyword + prefix bonuses). */
export function filterSlash(query: string, cmds = SLASH_COMMANDS): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return cmds;
  const scored: [number, SlashCommand][] = [];
  for (const c of cmds) {
    const hay = [c.id, c.title.toLowerCase(), ...(c.keywords ?? [])];
    let score = 0;
    for (const h of hay) {
      if (h === q) score = Math.max(score, 100);
      else if (h.startsWith(q)) score = Math.max(score, 80 - h.length / 10);
      else if (h.includes(q)) score = Math.max(score, 50);
      else if (subsequence(q, h)) score = Math.max(score, 20);
    }
    if (c.description.toLowerCase().includes(q)) score = Math.max(score, 15);
    if (score) scored.push([score, c]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map(([, c]) => c);
}

function subsequence(q: string, s: string) {
  let i = 0;
  for (const ch of s) if (ch === q[i]) i++;
  return i === q.length;
}

// ---------------------------------------------------------------------------
// Generators used by the wizards
// ---------------------------------------------------------------------------

export interface TableOptions {
  rows: number;
  cols: number;
  header: boolean;
  booktabs: boolean;
  caption: boolean;
  align: 'l' | 'c' | 'r';
}

export function tableSnippet(o: TableOptions): string {
  let n = 1;
  const cell = (label: string) => `\${${n++}:${label}}`;
  const lines: string[] = [];
  const rule = (b: string, plain = '\\hline') => (o.booktabs ? b : plain);
  lines.push('\\begin{table}[htbp]', '\t\\centering');
  if (o.caption) lines.push(`\t\\caption{${cell('Caption')}}`, `\t\\label{tab:${cell('label')}}`);
  lines.push(`\t\\begin{tabular}{${o.align.repeat(o.cols)}}`);
  lines.push(`\t\t${rule('\\toprule')}`);
  for (let r = 0; r < o.rows; r++) {
    const cells = Array.from({ length: o.cols }, (_, c) => (o.header && r === 0 ? cell(`Header ${c + 1}`) : cell(`${String.fromCharCode(65 + (r - (o.header ? 1 : 0)) % 26)}${c + 1}`)));
    lines.push(`\t\t${cells.join(' & ')} \\\\\\\\`);
    if (o.header && r === 0) lines.push(`\t\t${rule('\\midrule')}`);
  }
  lines.push(`\t\t${rule('\\bottomrule')}`, '\t\\end{tabular}', '\\end{table}', '$0');
  return lines.join('\n');
}

export type MatrixKind = 'pmatrix' | 'bmatrix' | 'Bmatrix' | 'vmatrix' | 'Vmatrix' | 'matrix';
export type MatrixFill = 'placeholders' | 'identity' | 'zeros' | 'symbolic';

export function matrixSnippet(rows: number, cols: number, kind: MatrixKind, fill: MatrixFill, display: boolean): string {
  let n = 1;
  const body: string[] = [];
  for (let r = 0; r < rows; r++) {
    const cells: string[] = [];
    for (let c = 0; c < cols; c++) {
      const v = fill === 'identity' ? (r === c ? '1' : '0') : fill === 'zeros' ? '0' : fill === 'symbolic' ? `a_{${r + 1}${c + 1}}` : `a_{${r + 1}${c + 1}}`;
      cells.push(fill === 'placeholders' ? `\${${n++}:${v}}` : v);
    }
    body.push(cells.join(' & '));
  }
  const m = `\\begin{${kind}}\n\t${body.join(' \\\\\\\\\n\t')}\n\\end{${kind}}`;
  return display ? `\\[\n${m.replace(/^/gm, '\t')}\n\\]\n$0` : `${m}$0`;
}

export function matrixPreview(rows: number, cols: number, kind: MatrixKind, fill: MatrixFill): string {
  const body: string[] = [];
  for (let r = 0; r < rows; r++) {
    const cells: string[] = [];
    for (let c = 0; c < cols; c++) cells.push(fill === 'identity' ? (r === c ? '1' : '0') : fill === 'zeros' ? '0' : `a_{${r + 1}${c + 1}}`);
    body.push(cells.join(' & '));
  }
  return `\\begin{${kind}} ${body.join(' \\\\ ')} \\end{${kind}}`;
}

export const SYMBOL_GROUPS: { name: string; symbols: [string, string][] }[] = [
  { name: 'Greek', symbols: 'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega'.split(' ').map((g) => [`\\${g}`, `\\${g}`]) },
  { name: 'Operators', symbols: ['\\pm', '\\mp', '\\times', '\\div', '\\cdot', '\\circ', '\\ast', '\\oplus', '\\otimes', '\\cup', '\\cap', '\\setminus', '\\wedge', '\\vee', '\\nabla', '\\partial', '\\infty', '\\sum', '\\prod', '\\int', '\\oint', '\\sqrt{x}', '\\angle', '\\ell'].map((s) => [s, s]) },
  { name: 'Relations', symbols: ['\\leq', '\\geq', '\\neq', '\\approx', '\\equiv', '\\sim', '\\simeq', '\\cong', '\\propto', '\\ll', '\\gg', '\\in', '\\notin', '\\subset', '\\subseteq', '\\supset', '\\supseteq', '\\perp', '\\parallel', '\\mid'].map((s) => [s, s]) },
  { name: 'Arrows', symbols: ['\\to', '\\leftarrow', '\\leftrightarrow', '\\Rightarrow', '\\Leftarrow', '\\Leftrightarrow', '\\mapsto', '\\uparrow', '\\downarrow', '\\nearrow', '\\searrow', '\\longrightarrow', '\\hookrightarrow', '\\rightleftharpoons'].map((s) => [s, s]) },
  { name: 'Sets & logic', symbols: ['\\mathbb{R}', '\\mathbb{N}', '\\mathbb{Z}', '\\mathbb{Q}', '\\mathbb{C}', '\\emptyset', '\\forall', '\\exists', '\\nexists', '\\neg', '\\land', '\\lor', '\\implies', '\\iff', '\\therefore', '\\because', '\\top', '\\bot'].map((s) => [s, s]) },
  { name: 'Accents', symbols: ['\\hat{a}', '\\bar{a}', '\\vec{a}', '\\dot{a}', '\\ddot{a}', '\\tilde{a}', '\\overline{ab}', '\\underline{ab}', '\\widehat{ab}', '\\overrightarrow{AB}'].map((s) => [s, s]) },
];
