// Documents exercised by the engine end-to-end test (tests/e2e/engine.mjs).
export const DOCS = {
  macros: {
    engine: 'pdftex',
    files: {
      'main.tex': String.raw`\documentclass{article}
\usepackage[margin=2cm]{geometry}
\usepackage{fancyhdr}\pagestyle{fancy}\fancyhead[L]{GitLaTeX}\fancyhead[R]{\thepage}
\usepackage{titlesec}\titleformat{\section}{\Large\bfseries\sffamily}{\thesection}{1em}{}
\usepackage{enumitem}
\makeatletter
\newcommand\checkopt{\@ifnextchar[{\@checkopt}{\@checkopt[none]}}
\def\@checkopt[#1]{(opt=#1)}
\makeatother
\newcount\n \n=2
\begin{document}
\section{Low-level macros}\label{sec:low}
Dimexpr: \the\dimexpr 1pt*3+2pt\relax. Numexpr: \the\numexpr 7*6\relax.
Case: \ifcase\n zero\or one\or two\else many\fi. \checkopt \checkopt[x].
\begin{itemize}[leftmargin=2.4em, label=$\triangleright$]\item one \item two\end{itemize}
See Section~\ref{sec:low} and \cite{knuth,lamport}.
\bibliographystyle{plain}\bibliography{refs}
\end{document}`,
      'refs.bib': `@book{knuth, author={Donald E. Knuth}, title={The {\\TeX}book}, publisher={Addison-Wesley}, year={1984}}
@book{lamport, author={Leslie Lamport}, title={{\\LaTeX}: A Document Preparation System}, publisher={Addison-Wesley}, year={1994}}`,
    },
    expect: { status: ['success', 'warnings'], logExcludes: ['undefined references', 'Citation'], passesAtLeast: 2 },
  },
  t1fonts: {
    engine: 'pdftex',
    files: {
      'main.tex': String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\begin{document}
\section{Café}
Ünïcödé-ish text with T1 fonts \textdegree{} \textbullet{} « guillemets ».
\end{document}`,
    },
    expect: { status: ['success', 'warnings'], fetchedIncludes: 'font:sfrm1000.pfb' },
  },
  tikz: {
    engine: 'pdftex',
    files: {
      'main.tex': String.raw`\documentclass{article}
\usepackage{tikz}
\usetikzlibrary{arrows,positioning,shapes.geometric}
\usepackage{pgfplots}\pgfplotsset{compat=1.17}
\begin{document}
\begin{tikzpicture}[node distance=2cm]
\node[draw, circle] (a) {A};
\node[draw, rectangle, right=of a] (b) {B};
\draw[->] (a) -- (b);
\end{tikzpicture}
\begin{tikzpicture}\begin{axis}[width=6cm]\addplot {x^2};\end{axis}\end{tikzpicture}
\end{document}`,
    },
    expect: { status: ['success', 'warnings'], fetchedIncludes: 'pgf' },
  },
  biblatex: {
    engine: 'pdftex',
    files: {
      'main.tex': String.raw`\documentclass{article}
\usepackage[backend=bibtex,style=numeric]{biblatex}
\addbibresource{refs.bib}
\begin{document}
Cite \cite{knuth}.
\printbibliography
\end{document}`,
      'refs.bib': `@book{knuth, author={Donald E. Knuth}, title={The TeXbook}, publisher={Addison-Wesley}, year={1984}}`,
    },
    expect: { status: ['success', 'warnings'], fetchedIncludes: 'biblatex', logExcludes: ['undefined references'] },
  },
  xelatex: {
    engine: 'xetex',
    files: {
      'main.tex': String.raw`\documentclass{article}
\usepackage{fontspec}
\begin{document}
\section{XeLaTeX}
Unicode: ‘quotes’ — dash, café, naïve, Ελληνικά? $E=mc^2$.
\end{document}`,
    },
    expect: { status: ['success', 'warnings'] },
  },
  errors: {
    engine: 'pdftex',
    files: {
      'main.tex': String.raw`\documentclass{article}
\begin{document}
Hello \undefinedmacro{} world.
\end{document}`,
    },
    expect: { status: ['errors'], logIncludes: ['Undefined control sequence'] },
  },
  multifile: {
    engine: 'pdftex',
    files: {
      'main.tex': String.raw`\documentclass{report}
\usepackage{graphicx}
\usepackage{makeidx}\makeindex
\begin{document}
\tableofcontents
\include{chapters/intro}
\input{chapters/body.tex}
\printindex
\end{document}`,
      'chapters/intro.tex': String.raw`\chapter{Intro}Intro text\index{intro}.`,
      'chapters/body.tex': String.raw`\chapter{Body}\includegraphics[width=2cm]{img/dot.png}\index{body}`,
    },
    binary: { 'img/dot.png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' },
    expect: { status: ['success', 'warnings'], passesAtLeast: 2 },
  },
  // A real-world academic CV preamble: optional newtx via \IfFileExists (must be fetched,
  // not silently replaced by the fallback), Times metrics from an engine font collection,
  // TeX Gyre, microtype, lastpage (needs a rerun), enumitem with beginpenalty.
  cv: {
    engine: 'pdftex',
    files: {
      'main.tex': String.raw`\PassOptionsToPackage{dvipsnames}{xcolor}
\documentclass[11pt,letterpaper]{article}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\IfFileExists{newtxtext.sty}{\usepackage{newtxtext,newtxmath}}{\usepackage{mathptmx}}
\usepackage{microtype}
\usepackage[letterpaper,top=0.8in,bottom=0.85in,left=0.85in,right=0.85in,footskip=0.4in]{geometry}
\usepackage{needspace,enumitem,titlesec,fancyhdr,lastpage}
\usepackage[dvipsnames]{xcolor}
\usepackage{hyperref}
\definecolor{accent}{RGB}{25,55,105}
\newcommand{\monthyear}{\ifcase\month\or January\or February\or March\or April\or May\or June\or
  July\or August\or September\or October\or November\or December\fi\ \number\year}
\pagestyle{fancy}\fancyhf{}\renewcommand{\headrulewidth}{0pt}
\fancyfoot[C]{\footnotesize Updated \monthyear}
\fancyfoot[R]{\footnotesize Page \thepage\ of \pageref*{LastPage}}
\titleformat{\section}{\large\scshape\bfseries\color{accent}}{}{0pt}{}[{\titlerule[0.6pt]}]
\makeatletter
\newcommand{\cvkeep}{\par\if@nobreak\else\needspace{4\baselineskip}\fi}
\makeatother
\newcommand{\detail}[1]{\par\noindent\hspace*{1.2em}\parbox{\dimexpr\linewidth-1.2em}{#1}\par}
\newenvironment{yearlist}{\begin{itemize}[leftmargin=6.2em,labelwidth=5.7em,labelsep=0.5em,
  align=left,topsep=2pt,itemsep=2pt,parsep=0pt,beginpenalty=10000]}{\end{itemize}}
\begin{document}
{\LARGE\bfseries\scshape A. N. Author}
\section{Education}
\cvkeep\textbf{Ph.D., Something} \hfill 2025 -- Present
\detail{Advisors: Dr.\ One and Dr.\ Two --- 95\%, 2\,cm, $\alpha+\beta$}
\begin{itemize}[leftmargin=2.4em,label=\textbullet]\item Item\end{itemize}
\section{Honors}
\begin{yearlist}\item[2026] Champion \item[2021] Finalist\end{yearlist}
\end{document}`,
    },
    expect: { status: ['success', 'warnings'], fetchedIncludes: 'newtx', logIncludes: ['newtxtext.sty', 'lastpage.sty'], logExcludes: ['mathptmx.sty'], passesAtLeast: 2 },
  },
  lualatex: {
    engine: 'luatex',
    files: {
      'main.tex': String.raw`\documentclass{article}
\begin{document}
Hello from Lua\TeX: \directlua{tex.print(6*7)}.
\end{document}`,
    },
    // Not available in the TeX Live 2022 BusyTeX build (see scripts/fetch-engine.mjs).
    expect: { error: 'not available' },
  },
};
