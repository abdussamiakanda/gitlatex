/**
 * Monaco bootstrap: core editor + contributions only (no bundled language
 * services), our own LaTeX/BibTeX languages, and the GitLaTeX themes.
 * Everything is bundled locally — no CDN.
 */
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/features/register.all.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

// ---------------------------------------------------------------------------
// LaTeX
// ---------------------------------------------------------------------------

const MATH_ENVS = 'equation\\*?|align\\*?|gather\\*?|multline\\*?|flalign\\*?|alignat\\*?|eqnarray\\*?|displaymath|math|dmath\\*?';
const VERBATIM_ENVS = 'verbatim\\*?|Verbatim|lstlisting|minted|comment|filecontents\\*?';

const latexTokens: monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.latex',
  brackets: [
    { open: '{', close: '}', token: 'delimiter.curly' },
    { open: '[', close: ']', token: 'delimiter.square' },
  ],
  tokenizer: {
    root: [
      [/%.*$/, 'comment'],
      [new RegExp(`(\\\\begin)(\\s*)(\\{)(${VERBATIM_ENVS})(\\})`), ['keyword.env', '', 'delimiter.curly', { token: 'type.env', next: '@verbatim.$4' }, 'delimiter.curly']],
      [new RegExp(`(\\\\begin)(\\s*)(\\{)(${MATH_ENVS})(\\})`), ['keyword.env', '', 'delimiter.curly', { token: 'type.env', next: '@mathenv.$4' }, 'delimiter.curly']],
      [/(\\(?:begin|end))(\s*)(\{)([^}]*)(\})/, ['keyword.env', '', 'delimiter.curly', 'type.env', 'delimiter.curly']],
      [/\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph|frametitle|title|maketitle|caption)\*?(?![a-zA-Z@])/, 'keyword.section'],
      [/\\(?:label|ref|eqref|pageref|autoref|nameref|cref|Cref|vref|cite[a-zA-Z]*|[a-z]*cite|nocite|footcite|parencite|textcite)\*?(?![a-zA-Z@])/, 'keyword.ref'],
      [/\\(?:documentclass|usepackage|RequirePackage|input|include|includeonly|includegraphics|bibliography|bibliographystyle|addbibresource|printbibliography|usetikzlibrary)(?![a-zA-Z@])/, 'keyword.control'],
      [/\\(?:def|edef|gdef|xdef|let|newcommand|renewcommand|providecommand|DeclareRobustCommand|newenvironment|renewenvironment|makeatletter|makeatother|expandafter|noexpand|csname|endcsname|relax|numexpr|dimexpr|glueexpr|the|advance|multiply|divide|ifx|ifnum|ifdim|ifcase|ifdefined|ifcsname|if[a-zA-Z@]*|else|or|fi|unless|global|long|protected|begingroup|endgroup|NewDocumentCommand|ExplSyntaxOn|ExplSyntaxOff)(?![a-zA-Z@])/, 'keyword.primitive'],
      [/\\[a-zA-Z@]+\*?/, 'keyword'],
      [/\\./, 'keyword.escape'],
      [/\$\$/, { token: 'string.math.delim', next: '@displaymath' }],
      [/\$/, { token: 'string.math.delim', next: '@inlinemath' }],
      [/\\\[/, { token: 'string.math.delim', next: '@bracketmath' }],
      [/\\\(/, { token: 'string.math.delim', next: '@parenmath' }],
      [/[{}]/, 'delimiter.curly'],
      [/[[\]]/, 'delimiter.square'],
      [/&/, 'delimiter.amp'],
      [/#\d/, 'variable.param'],
      [/~/, 'delimiter.tilde'],
      [/-?\d+(?:\.\d+)?(?:pt|em|ex|cm|mm|in|bp|sp|pc|dd|cc|mu)\b/, 'number'],
    ],
    mathcommon: [
      [/%.*$/, 'comment'],
      [/\\(?:label|ref|eqref|tag)(?![a-zA-Z@])/, 'keyword.ref'],
      [/\\[a-zA-Z@]+\*?/, 'string.math.command'],
      [/\\./, 'string.math.command'],
      [/[{}]/, 'delimiter.curly'],
      [/&/, 'delimiter.amp'],
      [/[_^]/, 'string.math.op'],
    ],
    inlinemath: [[/\$/, { token: 'string.math.delim', next: '@pop' }], { include: '@mathcommon' }, [/[^$\\{}%&_^]+/, 'string.math']],
    displaymath: [[/\$\$/, { token: 'string.math.delim', next: '@pop' }], { include: '@mathcommon' }, [/[^$\\{}%&_^]+/, 'string.math'], [/\$/, 'string.math']],
    bracketmath: [[/\\\]/, { token: 'string.math.delim', next: '@pop' }], { include: '@mathcommon' }, [/[^\\{}%&_^]+/, 'string.math']],
    parenmath: [[/\\\)/, { token: 'string.math.delim', next: '@pop' }], { include: '@mathcommon' }, [/[^\\{}%&_^]+/, 'string.math']],
    mathenv: [
      [/(\\end)(\s*)(\{)([^}]*)(\})/, { cases: { '$4==$S2': ['keyword.env', '', 'delimiter.curly', { token: 'type.env', next: '@pop' }, 'delimiter.curly'], '@default': ['keyword.env', '', 'delimiter.curly', 'type.env', 'delimiter.curly'] } }],
      [/(\\begin)(\s*)(\{)([^}]*)(\})/, ['keyword.env', '', 'delimiter.curly', 'type.env', 'delimiter.curly']],
      { include: '@mathcommon' },
      [/[^\\{}%&_^]+/, 'string.math'],
    ],
    verbatim: [
      [/(\\end)(\s*)(\{)([^}]*)(\})/, { cases: { '$4==$S2': ['keyword.env', '', 'delimiter.curly', { token: 'type.env', next: '@pop' }, 'delimiter.curly'], '@default': 'string.verbatim' } }],
      [/[^\\]+/, 'string.verbatim'],
      [/./, 'string.verbatim'],
    ],
  },
};

const latexConfig: monaco.languages.LanguageConfiguration = {
  comments: { lineComment: '%' },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '$', close: '$', notIn: ['string', 'comment'] },
    { open: '`', close: "'", notIn: ['string', 'comment'] },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '$', close: '$' },
  ],
  wordPattern: /(-?\d*\.\d\w*)|([^`~!@#$%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/g,
  folding: {
    markers: { start: /^\s*%\s*#?region\b/, end: /^\s*%\s*#?endregion\b/ },
  },
  onEnterRules: [],
};

// ---------------------------------------------------------------------------
// BibTeX
// ---------------------------------------------------------------------------

const bibtexTokens: monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.bib',
  ignoreCase: true,
  tokenizer: {
    root: [
      [/%.*$/, 'comment'],
      [/(@\w+)(\s*)(\{)(\s*)([^,\s]+)/, ['keyword', '', 'delimiter.curly', '', 'type.key']],
      [/(@\w+)/, 'keyword'],
      [/([a-zA-Z_-]+)(\s*)(=)/, ['attribute.name', '', 'delimiter']],
      [/\{/, { token: 'string', next: '@brace' }],
      [/"/, { token: 'string', next: '@quoted' }],
      [/\d+/, 'number'],
      [/[},]/, 'delimiter'],
    ],
    brace: [
      [/\{/, { token: 'string', next: '@push' }],
      [/\}/, { token: 'string', next: '@pop' }],
      [/\\[a-zA-Z]+/, 'string.escape'],
      [/[^{}\\]+/, 'string'],
      [/./, 'string'],
    ],
    quoted: [
      [/"/, { token: 'string', next: '@pop' }],
      [/[^"]+/, 'string'],
    ],
  },
};

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

// GitLaTeX's colours (the classic editor's gitlatex-dark / gitlatex-light), spread
// over this tokenizer's finer-grained tokens.
monaco.editor.defineTheme('gitlatex-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: '569cd6' },
    { token: 'keyword.escape', foreground: 'd7ba7d' },
    { token: 'keyword.section', foreground: '4ec9b0', fontStyle: 'bold' },
    { token: 'keyword.ref', foreground: 'd7ba7d' },
    { token: 'keyword.control', foreground: 'c586c0' },
    { token: 'keyword.primitive', foreground: 'c586c0' },
    { token: 'keyword.env', foreground: 'c586c0', fontStyle: 'bold' },
    { token: 'type.env', foreground: '4ec9b0' },
    { token: 'type.key', foreground: 'dcdcaa', fontStyle: 'bold' },
    { token: 'string.math', foreground: 'b5cea8' },
    { token: 'string.math.delim', foreground: 'e8ab53', fontStyle: 'bold' },
    { token: 'string.math.command', foreground: 'dcdcaa' },
    { token: 'string.math.op', foreground: 'd4d4d4' },
    { token: 'string.verbatim', foreground: 'ce9178' },
    { token: 'string', foreground: 'ce9178' },
    { token: 'attribute.name', foreground: '9cdcfe' },
    { token: 'number', foreground: 'b5cea8' },
    { token: 'delimiter.curly', foreground: '808080' },
    { token: 'delimiter.square', foreground: '808080' },
    { token: 'delimiter.amp', foreground: 'e8ab53', fontStyle: 'bold' },
    { token: 'variable.param', foreground: '9cdcfe' },
  ],
  colors: {
    'editor.background': '#0d1117',
    'editor.foreground': '#e6edf3',
    'editorCursor.foreground': '#e6edf3',
    'editorLineNumber.foreground': '#484f58',
    'editorLineNumber.activeForeground': '#8b949e',
    'editor.lineHighlightBackground': '#161b22',
    'editor.selectionBackground': '#00808055',
    'editor.inactiveSelectionBackground': '#00808028',
    'editorIndentGuide.background1': '#21262d',
    'editorBracketMatch.background': '#00808030',
    'editorBracketMatch.border': '#008080a0',
    'editorWidget.background': '#161b22',
    'editorWidget.border': '#30363d',
    'editorSuggestWidget.background': '#161b22',
    'editorSuggestWidget.selectedBackground': '#21262d',
    'editorHoverWidget.background': '#161b22',
    'editorGutter.background': '#0d1117',
    'editorInfo.foreground': '#4a9eff',
    'scrollbarSlider.background': '#ffffff14',
    'minimap.background': '#0d1117',
  },
});

monaco.editor.defineTheme('gitlatex-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: '0000ff' },
    { token: 'keyword.escape', foreground: '8a5a00' },
    { token: 'keyword.section', foreground: '795e26', fontStyle: 'bold' },
    { token: 'keyword.ref', foreground: '8a5a00' },
    { token: 'keyword.control', foreground: 'af00db' },
    { token: 'keyword.primitive', foreground: 'af00db' },
    { token: 'keyword.env', foreground: 'af00db', fontStyle: 'bold' },
    { token: 'type.env', foreground: '267f99' },
    { token: 'type.key', foreground: '7a6a00', fontStyle: 'bold' },
    { token: 'string.math', foreground: '098658' },
    { token: 'string.math.delim', foreground: 'd16969', fontStyle: 'bold' },
    { token: 'string.math.command', foreground: '795e26' },
    { token: 'string.math.op', foreground: '000000' },
    { token: 'string.verbatim', foreground: 'a31515' },
    { token: 'string', foreground: 'a31515' },
    { token: 'attribute.name', foreground: '001080' },
    { token: 'number', foreground: '098658' },
    { token: 'delimiter.curly', foreground: '808080' },
    { token: 'delimiter.square', foreground: '808080' },
    { token: 'delimiter.amp', foreground: 'd16969', fontStyle: 'bold' },
    { token: 'variable.param', foreground: '001080' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#1f2328',
    'editorCursor.foreground': '#1f2328',
    'editorLineNumber.foreground': '#8c959f',
    'editorLineNumber.activeForeground': '#656d76',
    'editor.lineHighlightBackground': '#f6f8fa',
    'editor.selectionBackground': '#00808033',
    'editorInfo.foreground': '#1a73e8',
  },
});

let registered = false;
export function registerLanguages() {
  if (registered) return;
  registered = true;
  monaco.languages.register({ id: 'latex', extensions: ['.tex', '.sty', '.cls', '.ltx', '.bbl'], aliases: ['LaTeX', 'TeX'] });
  monaco.languages.setMonarchTokensProvider('latex', latexTokens);
  monaco.languages.setLanguageConfiguration('latex', latexConfig);
  monaco.languages.register({ id: 'bibtex', extensions: ['.bib'], aliases: ['BibTeX'] });
  monaco.languages.setMonarchTokensProvider('bibtex', bibtexTokens);
  monaco.languages.setLanguageConfiguration('bibtex', {
    comments: { lineComment: '%' },
    brackets: [['{', '}']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '"', close: '"' },
    ],
  });
}

export { monaco };
