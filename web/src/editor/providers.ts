/**
 * Language intelligence for LaTeX and BibTeX in Monaco:
 * completion (commands, environments, citations, labels, files, packages),
 * hover cards, go-to-definition, document symbols, folding and quick fixes.
 */
import { monaco } from './monaco';
import { COMMANDS, ENVIRONMENTS } from '../latex/catalog';
import { labels, loadedPackages, outline, userMacros } from '../latex/analysis';
import { parseBib, formatEntry, type BibEntry } from '../latex/bib';
import { explain, COMMAND_PACKAGES } from '../latex/explain';
import type { Workspace } from '../state/workspace';
import type { Diagnostic } from '../types';
import { dirname, extname, isImagePath, relativePath, stripExt } from '../utils/paths';
import type { QuickFix } from '../latex/explain';

export interface ProviderContext {
  workspace(): Workspace | null;
  diagnostics(): Diagnostic[];
  openFile(path: string, line?: number, column?: number): void;
  applyQuickFix(fix: QuickFix): void;
  ensurePackage(pkg: string): boolean;
}

const pathOf = (model: monaco.editor.ITextModel) => model.uri.path.slice(1);
const CIT = /\\(?:[a-zA-Z]*cite[a-zA-Z]*|nocite)\*?(?:\[[^\]]*\]){0,2}\{([^}]*)$/;
const REF = /\\(?:ref|eqref|pageref|autoref|nameref|[cC]ref|vref|labelcref)\*?\{([^}]*)$/;
const GFX = /\\includegraphics\*?(?:\[[^\]]*\])?\{([^}]*)$/;
const INPUT = /\\(input|include|subfile|lstinputlisting(?:\[[^\]]*\])?)\{([^}]*)$/;
const BIBFILE = /\\(?:bibliography|addbibresource)(?:\[[^\]]*\])?\{([^}]*)$/;
const PKG = /\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{([^}]*)$/;
const CLS = /\\documentclass(?:\[[^\]]*\])?\{([^}]*)$/;
const BEGIN = /\\begin\{([^}]*)$/;
const END = /\\end\{([^}]*)$/;
const CMD = /\\([a-zA-Z@]*)$/;

// ---- caches -----------------------------------------------------------------

let bibCache: { key: string; entries: BibEntry[] } | null = null;
function bibEntries(ws: Workspace): BibEntry[] {
  const bibs = ws.textFiles('.bib');
  const key = bibs.map((b) => `${b.path}:${b.text.length}`).join('|');
  if (bibCache?.key === key) return bibCache.entries;
  const entries = bibs.flatMap((b) => parseBib(b.text, b.path));
  bibCache = { key, entries };
  return entries;
}

let packageList: Promise<{ sty: string[]; cls: string[] }> | null = null;
function availablePackages(): Promise<{ sty: string[]; cls: string[] }> {
  packageList ??= (async () => {
    const sty = new Set<string>();
    const cls = new Set<string>(['article', 'report', 'book', 'letter', 'beamer', 'memoir', 'scrartcl', 'scrreprt', 'scrbook', 'amsart', 'standalone']);
    const add = (name: string) => {
      if (name.endsWith('.sty')) sty.add(name.slice(0, -4));
      else if (name.endsWith('.cls')) cls.add(name.slice(0, -4));
    };
    try {
      const m = (await (await fetch(new URL('engine/manifest.json', document.baseURI))).json()) as { packages: { provides: string[] }[] };
      m.packages.forEach((p) => p.provides.forEach(add));
    } catch {
      /* offline or no engine */
    }
    try {
      const idx = (await (await fetch(new URL('shelf/index.json', document.baseURI))).json()) as { files: string };
      for (const line of idx.files.split('\n')) add(line.slice(0, line.indexOf('\t')));
    } catch {
      /* shelf optional */
    }
    return { sty: [...sty].sort(), cls: [...cls].sort() };
  })();
  return packageList;
}

// ---- helpers ------------------------------------------------------------------

function wordRangeAfter(position: monaco.Position, typedLen: number): monaco.IRange {
  return {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: position.column - typedLen,
    endColumn: position.column,
  };
}

/** Find the innermost \begin{env} still open before `position`. */
function openEnvironment(model: monaco.editor.ITextModel, position: monaco.Position): string | null {
  const text = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
  const stack: string[] = [];
  const re = /\\(begin|end)\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text.replace(/(^|[^\\])%.*$/gm, '$1')))) {
    if (m[1] === 'begin') stack.push(m[2]);
    else if (stack[stack.length - 1] === m[2]) stack.pop();
  }
  return stack.pop() ?? null;
}

// ---- registration ---------------------------------------------------------------

let registered = false;

export function registerProviders(ctx: ProviderContext) {
  if (registered) return;
  registered = true;

  // Clicking a cross-file location (go to definition, references) opens it in our tabs.
  monaco.editor.registerEditorOpener({
    openCodeEditor(_source, resource, selectionOrPosition) {
      if (resource.scheme !== 'tbfile') return false;
      const line = selectionOrPosition && 'startLineNumber' in selectionOrPosition ? selectionOrPosition.startLineNumber : selectionOrPosition?.lineNumber;
      ctx.openFile(resource.path.slice(1), line);
      return true;
    },
  });

  const addPackageCommand = monaco.editor.registerCommand('texbrowser.ensurePackage', (_accessor, pkg: string) => {
    ctx.ensurePackage(pkg);
  });
  void addPackageCommand;
  monaco.editor.registerCommand('texbrowser.quickFix', (_accessor, fix: QuickFix) => ctx.applyQuickFix(fix));

  monaco.languages.registerCompletionItemProvider('latex', {
    triggerCharacters: ['\\', '{', ','],
    async provideCompletionItems(model, position) {
      const ws = ctx.workspace();
      if (!ws) return { suggestions: [] };
      const before = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
      const K = monaco.languages.CompletionItemKind;
      const typedArg = (full: string) => full.slice(full.lastIndexOf(',') + 1).trimStart();
      let m: RegExpExecArray | null;

      if ((m = CIT.exec(before))) {
        const typed = typedArg(m[1]);
        return {
          suggestions: bibEntries(ws).map((e) => ({
            label: { label: e.key, description: e.fields.year ?? '' },
            kind: K.Reference,
            insertText: e.key,
            detail: formatEntry(e),
            documentation: { value: `**${e.fields.title ?? e.key}**\n\n${e.fields.author ?? ''}\n\n*${e.file}*` },
            filterText: `${e.key} ${e.fields.title ?? ''} ${e.fields.author ?? ''}`,
            range: wordRangeAfter(position, typed.length),
          })),
        };
      }
      if ((m = REF.exec(before))) {
        const typed = typedArg(m[1]);
        return {
          suggestions: labels(ws.textFiles('.tex')).map((l) => ({
            label: l.label,
            kind: K.Reference,
            insertText: l.label,
            detail: `${l.file}:${l.line}`,
            documentation: l.context,
            range: wordRangeAfter(position, typed.length),
          })),
        };
      }
      if ((m = GFX.exec(before))) {
        const main = ws.project.mainFile;
        return {
          suggestions: ws
            .paths()
            .filter((p) => isImagePath(p) && extname(p) !== 'svg')
            .map((p) => ({ label: relativePath(main, p), kind: K.File, insertText: relativePath(main, p), range: wordRangeAfter(position, m![1].length) })),
        };
      }
      if ((m = INPUT.exec(before))) {
        const main = ws.project.mainFile;
        const isInclude = m[1] === 'include';
        return {
          suggestions: ws
            .paths()
            .filter((p) => (m![1].startsWith('lstinputlisting') ? true : p.endsWith('.tex')) && p !== main)
            .map((p) => {
              const rel = relativePath(main, p);
              const text = isInclude ? stripExt(rel) : rel;
              return { label: text, kind: K.File, insertText: text, range: wordRangeAfter(position, m![2].length) };
            }),
        };
      }
      if ((m = BIBFILE.exec(before))) {
        const typed = typedArg(m[1]);
        const isBiblatex = before.includes('addbibresource');
        return {
          suggestions: ws
            .paths()
            .filter((p) => p.endsWith('.bib'))
            .map((p) => {
              const rel = relativePath(ws.project.mainFile, p);
              const text = isBiblatex ? rel : stripExt(rel);
              return { label: text, kind: K.File, insertText: text, range: wordRangeAfter(position, typed.length) };
            }),
        };
      }
      if ((m = PKG.exec(before)) || (m = CLS.exec(before))) {
        const typed = typedArg(m[1]);
        const pkgs = await availablePackages();
        const list = PKG.test(before) ? pkgs.sty : pkgs.cls;
        return {
          suggestions: list.map((name) => ({ label: name, kind: K.Module, insertText: name, range: wordRangeAfter(position, typed.length) })),
          incomplete: false,
        };
      }
      if ((m = BEGIN.exec(before))) {
        const userEnvs = userMacros(ws.textFiles()).filter((u) => u.kind === 'environment');
        const lineText = model.getLineContent(position.lineNumber);
        const closing = lineText.slice(position.column - 1).startsWith('}');
        const base = wordRangeAfter(position, m[1].length + '\\begin{'.length);
        const range: monaco.IRange = { ...base, endColumn: base.endColumn + (closing ? 1 : 0) };
        const indent = /^\s*/.exec(lineText)?.[0] ?? '';
        const mk = (name: string, args = '', body = '${0}', doc = '', pkg?: string) => ({
          label: name,
          kind: K.Snippet,
          detail: pkg ? `${doc} — ${pkg}` : doc,
          insertText: `\\begin{${name}}${args}\n${indent}\t${body.replace(/\n/g, `\n${indent}\t`)}\n${indent}\\end{${name}}`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          command: pkg ? { id: 'texbrowser.ensurePackage', title: 'add package', arguments: [pkg] } : undefined,
        });
        return {
          suggestions: [
            ...ENVIRONMENTS.map((e) => mk(e.name, e.args ?? '', e.body ?? '${0}', e.doc, e.pkg)),
            ...userEnvs.map((u) => mk(u.name, u.args ? Array.from({ length: u.args }, (_, i) => `{\${${i + 1}}}`).join('') : '', '${0}', `Defined in ${u.file}`)),
          ],
        };
      }
      if ((m = END.exec(before))) {
        const env = openEnvironment(model, position);
        if (!env) return { suggestions: [] };
        const range = wordRangeAfter(position, m[1].length);
        return { suggestions: [{ label: env, kind: monaco.languages.CompletionItemKind.Keyword, insertText: model.getLineContent(position.lineNumber).slice(position.column - 1).startsWith('}') ? env : `${env}}`, range, sortText: '0' }] };
      }
      if ((m = CMD.exec(before))) {
        const main = ws.getText(ws.project.mainFile) ?? '';
        const loaded = loadedPackages(main);
        const range = wordRangeAfter(position, m[1].length);
        const macros = userMacros(ws.textFiles());
        const seen = new Set<string>();
        const items: monaco.languages.CompletionItem[] = [];
        for (const u of macros) {
          if (u.kind !== 'command' || seen.has(u.name)) continue;
          seen.add(u.name);
          items.push({
            label: { label: `\\${u.name}`, description: 'your macro' },
            kind: K.Function,
            insertText: u.name + Array.from({ length: u.args }, (_, i) => `{\${${i + 1}}}`).join(''),
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: `Defined in ${u.file}`,
            range,
            sortText: '0' + u.name,
          });
        }
        for (const c of COMMANDS) {
          if (seen.has(c.name)) continue;
          seen.add(c.name);
          const needs = c.pkg && !loaded.has(c.pkg) ? c.pkg : undefined;
          items.push({
            label: { label: `\\${c.name}`, description: c.pkg ?? (c.math ? 'math' : '') },
            kind: c.math ? K.Operator : K.Function,
            insertText: c.snippet,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: needs ? `${c.doc} (adds \\usepackage{${needs}})` : c.doc,
            range,
            sortText: '1' + c.name,
            command: needs ? { id: 'texbrowser.ensurePackage', title: 'add package', arguments: [needs] } : undefined,
          });
        }
        return { suggestions: items };
      }
      return { suggestions: [] };
    },
  });

  // ---- hover ------------------------------------------------------------------
  monaco.languages.registerHoverProvider('latex', {
    provideHover(model, position) {
      const ws = ctx.workspace();
      if (!ws) return null;
      const line = model.getLineContent(position.lineNumber);
      const col = position.column - 1;
      // Find a \command{arg} spanning the cursor.
      const re = /\\([a-zA-Z]+)\*?(?:\[[^\]]*\])*\{([^}]*)\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) {
        if (col < m.index || col > m.index + m[0].length) continue;
        const [, cmd, arg] = m;
        const range = new monaco.Range(position.lineNumber, m.index + 1, position.lineNumber, m.index + m[0].length + 1);
        if (/cite/.test(cmd)) {
          const entries = bibEntries(ws);
          const parts = arg.split(',').map((k) => k.trim()).map((k) => {
            const e = entries.find((x) => x.key === k);
            return e ? `**${k}** — ${formatEntry(e)}` : `**${k}** — *not found in any .bib file*`;
          });
          return { range, contents: [{ value: parts.join('\n\n') }] };
        }
        if (/^(ref|eqref|pageref|autoref|cref|Cref|nameref|vref)$/.test(cmd)) {
          const l = labels(ws.textFiles('.tex')).find((x) => x.label === arg);
          return { range, contents: [{ value: l ? `\`${l.file}:${l.line}\`\n\n\`\`\`latex\n${l.context}\n\`\`\`` : `*No* \\label{${arg}} in this project` }] };
        }
      }
      // Command documentation.
      const word = /\\([a-zA-Z@]+)/g;
      while ((m = word.exec(line))) {
        if (col < m.index || col > m.index + m[0].length) continue;
        const c = COMMANDS.find((x) => x.name === m![1]);
        const pkg = c?.pkg ?? COMMAND_PACKAGES[m[1]];
        if (!c && !pkg) return null;
        return {
          range: new monaco.Range(position.lineNumber, m.index + 1, position.lineNumber, m.index + m[0].length + 1),
          contents: [{ value: `**\\${m[1]}**${c ? ` — ${c.doc}` : ''}${pkg ? `\n\nPackage: \`${pkg}\`` : ''}` }],
        };
      }
      return null;
    },
  });

  // ---- go to definition -------------------------------------------------------------
  monaco.languages.registerDefinitionProvider('latex', {
    provideDefinition(model, position) {
      const ws = ctx.workspace();
      if (!ws) return null;
      const line = model.getLineContent(position.lineNumber);
      const col = position.column - 1;
      const re = /\\([a-zA-Z]+)\*?(?:\[[^\]]*\])*\{([^}]*)\}/g;
      let m: RegExpExecArray | null;
      const uri = (p: string) => monaco.Uri.from({ scheme: 'tbfile', path: '/' + p });
      const at = (p: string, l = 1) => ({ uri: uri(p), range: new monaco.Range(l, 1, l, 1) });
      while ((m = re.exec(line))) {
        if (col < m.index || col > m.index + m[0].length) continue;
        const [, cmd, arg] = m;
        const mainDir = dirname(ws.project.mainFile);
        const resolve = (name: string, exts: string[]) => {
          for (const e of ['', ...exts]) {
            const p = (mainDir ? `${mainDir}/` : '') + name + e;
            if (ws.get(p)) return p;
          }
          return null;
        };
        if (/^(input|include|subfile)$/.test(cmd)) {
          const p = resolve(arg, ['.tex']);
          return p ? at(p) : null;
        }
        if (cmd === 'includegraphics') {
          const p = resolve(arg, ['.png', '.jpg', '.jpeg', '.pdf']);
          if (p) ctx.openFile(p);
          return null;
        }
        if (/cite/.test(cmd)) {
          const key = arg.split(',').map((k) => k.trim()).find(Boolean);
          const e = bibEntries(ws).find((x) => x.key === key);
          return e ? at(e.file, e.line) : null;
        }
        if (/ref$/i.test(cmd) || cmd === 'nameref') {
          const l = labels(ws.textFiles('.tex')).find((x) => x.label === arg);
          return l ? at(l.file, l.line) : null;
        }
      }
      return null;
    },
  });

  // ---- outline / symbols --------------------------------------------------------------
  monaco.languages.registerDocumentSymbolProvider('latex', {
    provideDocumentSymbols(model) {
      const items = outline([{ path: pathOf(model), text: model.getValue() }]);
      return items.map((it) => ({
        name: it.title,
        detail: it.kind,
        kind: monaco.languages.SymbolKind.Namespace,
        tags: [],
        range: new monaco.Range(it.line, 1, it.line, model.getLineMaxColumn(it.line)),
        selectionRange: new monaco.Range(it.line, 1, it.line, model.getLineMaxColumn(it.line)),
      }));
    },
  });

  // ---- folding: environments and sections ---------------------------------------------
  monaco.languages.registerFoldingRangeProvider('latex', {
    provideFoldingRanges(model) {
      const ranges: monaco.languages.FoldingRange[] = [];
      const stack: { name: string; line: number }[] = [];
      const sections: { level: number; line: number }[] = [];
      const levels: Record<string, number> = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5 };
      const n = model.getLineCount();
      for (let i = 1; i <= n; i++) {
        const text = model.getLineContent(i).replace(/(^|[^\\])%.*$/, '$1');
        const re = /\\(begin|end)\{([^}]+)\}/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
          if (m[1] === 'begin') stack.push({ name: m[2], line: i });
          else {
            const idx = stack.map((s) => s.name).lastIndexOf(m[2]);
            if (idx >= 0) {
              const open = stack.splice(idx)[0];
              if (i > open.line) ranges.push({ start: open.line, end: i, kind: monaco.languages.FoldingRangeKind.Region });
            }
          }
        }
        const s = /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?[[{]/.exec(text);
        const endDoc = /\\end\{document\}/.test(text);
        if (s || endDoc) {
          const level = s ? levels[s[1]] : -1;
          while (sections.length && sections[sections.length - 1].level >= level) {
            const open = sections.pop()!;
            if (i - 1 > open.line) ranges.push({ start: open.line, end: i - 1 });
          }
          if (s) sections.push({ level, line: i });
        }
      }
      for (const open of sections) if (n > open.line) ranges.push({ start: open.line, end: n });
      return ranges;
    },
  });

  // ---- quick fixes (lightbulb) from compile diagnostics ------------------------------------
  monaco.languages.registerCodeActionProvider('latex', {
    provideCodeActions(model, range) {
      const path = pathOf(model);
      const actions: monaco.languages.CodeAction[] = [];
      for (const d of ctx.diagnostics()) {
        if (d.file !== path || !d.line || d.line < range.startLineNumber || d.line > range.endLineNumber) continue;
        const ex = explain(d);
        for (const fix of ex?.fixes ?? []) {
          actions.push({
            title: fix.label,
            kind: 'quickfix',
            isPreferred: true,
            command: { id: 'texbrowser.quickFix', title: fix.label, arguments: [fix] },
          });
        }
      }
      return { actions, dispose() {} };
    },
  });

  // ---- BibTeX: field completion and entry outline ----------------------------------------
  monaco.languages.registerCompletionItemProvider('bibtex', {
    triggerCharacters: ['@'],
    provideCompletionItems(model, position) {
      const before = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
      const m = /@(\w*)$/.exec(before);
      if (!m) return { suggestions: [] };
      const types: [string, string[]][] = [
        ['article', ['author', 'title', 'journal', 'year', 'volume', 'number', 'pages', 'doi']],
        ['book', ['author', 'title', 'publisher', 'year', 'address', 'isbn']],
        ['inproceedings', ['author', 'title', 'booktitle', 'year', 'pages', 'publisher', 'doi']],
        ['misc', ['author', 'title', 'howpublished', 'year', 'note', 'url']],
        ['phdthesis', ['author', 'title', 'school', 'year']],
        ['mastersthesis', ['author', 'title', 'school', 'year']],
        ['techreport', ['author', 'title', 'institution', 'year', 'number']],
        ['online', ['author', 'title', 'url', 'urldate', 'year']],
      ];
      return {
        suggestions: types.map(([t, fields]) => ({
          label: `@${t}`,
          kind: monaco.languages.CompletionItemKind.Struct,
          insertText: `${t}{\${1:key},\n${fields.map((f, i) => `  ${f.padEnd(9)} = {\${${i + 2}}}`).join(',\n')}\n}\n`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range: wordRangeAfter(position, m[1].length),
        })),
      };
    },
  });
  monaco.languages.registerDocumentSymbolProvider('bibtex', {
    provideDocumentSymbols(model) {
      return parseBib(model.getValue()).map((e) => ({
        name: e.key,
        detail: e.fields.title ?? e.type,
        kind: monaco.languages.SymbolKind.Object,
        tags: [],
        range: new monaco.Range(e.line, 1, e.line, 1),
        selectionRange: new monaco.Range(e.line, 1, e.line, 1),
      }));
    },
  });
}

/** Math under the cursor: returns the TeX source and whether it is display math. */
export function mathAt(model: monaco.editor.ITextModel, position: monaco.Position): { tex: string; display: boolean; endLine: number } | null {
  const offset = model.getOffsetAt(position);
  const text = model.getValue();
  const from = Math.max(0, offset - 3000);
  const to = Math.min(text.length, offset + 3000);
  const win = text.slice(from, to);
  const rel = offset - from;
  const candidates: [RegExp, boolean][] = [
    [/\\begin\{(equation|align|gather|multline|flalign|displaymath|math|eqnarray)(\*?)\}([\s\S]*?)\\end\{\1\2\}/g, true],
    [/\\\[([\s\S]*?)\\\]/g, true],
    [/\$\$([\s\S]*?)\$\$/g, true],
    [/\\\(([\s\S]*?)\\\)/g, false],
    [/(?<![\\$])\$(?!\$)((?:\\.|[^$\\])+?)\$/g, false],
  ];
  for (const [re, display] of candidates) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(win))) {
      if (rel < m.index || rel > m.index + m[0].length) continue;
      const env = m.length > 3 ? m[1] : null;
      let tex = (env ? m[3] : m[1]).replace(/\\label\{[^}]*\}/g, '').replace(/(^|[^\\])%.*$/gm, '$1');
      if (env && /^(align|flalign|eqnarray)$/.test(env)) tex = `\\begin{aligned}${tex}\\end{aligned}`;
      if (env === 'gather') tex = `\\begin{gathered}${tex}\\end{gathered}`;
      if (!tex.trim()) return null;
      const endLine = model.getPositionAt(from + m.index + m[0].length).lineNumber;
      return { tex: tex.trim(), display, endLine };
    }
  }
  return null;
}
