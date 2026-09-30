/**
 * TeX / BibTeX log parser → structured diagnostics with file and line.
 *
 * TeX logs are notoriously hard to parse: lines are hard-wrapped at 79
 * columns, and the "current file" is only implied by the nesting of
 * parentheses — `(./chapter.tex … )`. We compile with `-file-line-error`, so
 * most errors are prefixed with `file:line:`; for the rest we track the file
 * stack ourselves.
 */
import type { Diagnostic } from '../types';
import { unwrapLog } from '../engine/missing';

const PROJECT_ROOT = '/home/web_user/project/';

/** Convert a path as printed by TeX to a project-relative path (undefined for TeX Live files). */
export function toProjectPath(p: string, mainDir: string): string | undefined {
  let path = p.trim().replace(/^"|"$/g, '');
  if (path.startsWith(PROJECT_ROOT)) return path.slice(PROJECT_ROOT.length);
  if (path.startsWith('/')) return undefined;
  if (path.startsWith('./')) path = path.slice(2);
  const parts: string[] = mainDir ? mainDir.split('/') : [];
  for (const seg of path.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/') || undefined;
}

const looksLikeFile = (s: string) => /^(\.{0,2}\/|[\w-]+\/)?[^\s()]*\.[A-Za-z]{1,8}$/.test(s) || s.startsWith('./') || s.startsWith('/');

/** Track `(file … )` nesting across one log line. */
function updateStack(line: string, stack: (string | null)[]) {
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    if (c === '(') {
      const m = /^\(("[^"]+"|[^\s()"]+)/.exec(line.slice(j));
      if (m && looksLikeFile(m[1].replace(/"/g, ''))) {
        stack.push(m[1].replace(/"/g, ''));
        j += m[1].length;
      } else stack.push(null);
    } else if (c === ')') stack.pop();
  }
}

const currentFile = (stack: (string | null)[]) => {
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i]) return stack[i]!;
  return undefined;
};

const FILE_LINE = /^(\.{0,2}\/?[^:\s][^:]*?\.[A-Za-z0-9]+):(\d+): (.*)$/;
const WARNING = /^((?:LaTeX|Package|Class|Module)(?: [\w-]+)? Warning|LaTeX Font Warning|pdfTeX warning(?: \([^)]*\))?)[:\s]\s*(.*)$/;
const BOX = /^(Over|Under)full \\[hv]box \(([^)]*)\) (?:in paragraph at lines (\d+)--(\d+)|detected at line (\d+)|has occurred while \\output is active)/;

export function parseTexLog(log: string, mainDir = ''): Diagnostic[] {
  const lines = unwrapLog(log).split('\n');
  const out: Diagnostic[] = [];
  const stack: (string | null)[] = [];
  const seen = new Set<string>();
  const push = (d: Diagnostic) => {
    const key = `${d.severity}|${d.file}|${d.line}|${d.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(d);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1. file:line: error  (from -file-line-error)
    const fl = FILE_LINE.exec(line);
    if (fl && !/^l\.\d+/.test(line)) {
      const ctx: string[] = [];
      let j = i + 1;
      for (; j < lines.length && j < i + 12; j++) {
        const l = lines[j];
        if (!l.trim() && ctx.length) break;
        if (FILE_LINE.test(l)) break;
        ctx.push(l);
      }
      const message = fl[3].replace(/^LaTeX Error: /, 'LaTeX Error: ').trim();
      if (!/==> Fatal error occurred|^Emergency stop\.?$/.test(message) || !out.some((d) => d.severity === 'error')) {
        push({
          severity: 'error',
          message,
          file: toProjectPath(fl[1], mainDir),
          line: Number(fl[2]),
          context: ctx.filter((l) => l.trim()).slice(0, 6).join('\n') || undefined,
          raw: [line, ...ctx].join('\n'),
          source: 'latex',
        });
      }
      updateStack(line, stack);
      continue;
    }

    // 2. Classic "! Message" errors
    if (line.startsWith('!')) {
      const message = line.replace(/^!\s*/, '').trim();
      const ctx: string[] = [];
      let lineNo: number | undefined;
      for (let j = i + 1; j < lines.length && j < i + 15; j++) {
        const m = /^l\.(\d+)\s?(.*)$/.exec(lines[j]);
        ctx.push(lines[j]);
        if (m) {
          lineNo = Number(m[1]);
          if (lines[j + 1]) ctx.push(lines[j + 1]);
          break;
        }
      }
      const redundant = /^(Emergency stop|==> Fatal error occurred)/.test(message) && out.some((d) => d.severity === 'error');
      if (!redundant) {
        const file = currentFile(stack);
        push({
          severity: 'error',
          message,
          file: file ? toProjectPath(file, mainDir) : undefined,
          line: lineNo,
          context: ctx.filter((l) => l.trim()).slice(0, 6).join('\n') || undefined,
          raw: [line, ...ctx].join('\n'),
          source: 'latex',
        });
      }
      updateStack(line, stack);
      continue;
    }

    // 3. Warnings (possibly continued on "(pkg)   " lines)
    const w = WARNING.exec(line);
    if (w) {
      let message = w[2];
      const pkg = /Package (\S+) Warning/.exec(w[1])?.[1] ?? /Class (\S+) Warning/.exec(w[1])?.[1];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() && (/^\(\S+\)\s/.test(lines[j]) || /^\s{4,}/.test(lines[j])) && j < i + 8) {
        message += ' ' + lines[j].replace(/^\(\S+\)\s*/, '').trim();
        j++;
      }
      message = message.replace(/\s+/g, ' ').trim();
      const lineMatch = /on input line (\d+)/.exec(message);
      const file = currentFile(stack);
      push({
        severity: 'warning',
        message: `${pkg ? `[${pkg}] ` : ''}${message.replace(/\s*on input line \d+\.?/, '').replace(/\.$/, '')}`,
        file: file ? toProjectPath(file, mainDir) : undefined,
        line: lineMatch ? Number(lineMatch[1]) : undefined,
        raw: lines.slice(i, j).join('\n'),
        source: 'latex',
      });
      for (let k = i; k < j; k++) updateStack(lines[k], stack);
      i = j - 1;
      continue;
    }

    // 4. Over/underfull boxes (typographic, shown as info)
    const b = BOX.exec(line);
    if (b) {
      const file = currentFile(stack);
      push({
        severity: 'info',
        message: `${b[1]}full box (${b[2]})`,
        file: file ? toProjectPath(file, mainDir) : undefined,
        line: Number(b[3] ?? b[5]) || undefined,
        raw: line,
        source: 'latex',
      });
    }

    if (/^Missing character: There is no/.test(line)) {
      push({ severity: 'warning', message: line.trim(), source: 'latex', file: toProjectPath(currentFile(stack) ?? '', mainDir) });
    }

    updateStack(line, stack);
  }
  return out;
}

/** Parse a BibTeX .blg log. */
export function parseBibtexLog(blg: string, mainDir = ''): Diagnostic[] {
  const out: Diagnostic[] = [];
  const lines = blg.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const warn = /^Warning--(.*)$/.exec(line);
    if (warn) {
      const loc = /^--line (\d+) of file (\S+)/.exec(lines[i + 1] ?? '');
      out.push({
        severity: 'warning',
        message: `BibTeX: ${warn[1]}`,
        file: loc ? toProjectPath(loc[2], mainDir) : undefined,
        line: loc ? Number(loc[1]) : undefined,
        source: 'bibtex',
        raw: line,
      });
      continue;
    }
    const err = /^(.*?)---line (\d+) of file (\S+)/.exec(line);
    if (err) {
      out.push({
        severity: 'error',
        message: `BibTeX: ${err[1].trim() || lines[i - 1]?.trim()}`,
        file: toProjectPath(err[3], mainDir),
        line: Number(err[2]),
        context: lines.slice(i + 1, i + 3).join('\n'),
        source: 'bibtex',
        raw: line,
      });
      continue;
    }
    const open = /^I couldn't open (database|style|auxiliary) file (\S+)/.exec(line);
    if (open) {
      out.push({ severity: 'error', message: `BibTeX: couldn't open ${open[1]} file ${open[2]}`, source: 'bibtex', raw: line });
      continue;
    }
    if (/^I found no (\\citation|\\bibdata|\\bibstyle) commands/.test(line)) {
      out.push({ severity: 'warning', message: `BibTeX: ${line.trim()}`, source: 'bibtex', raw: line });
    }
  }
  return out;
}

export function summarise(diags: Diagnostic[]) {
  return {
    errors: diags.filter((d) => d.severity === 'error').length,
    warnings: diags.filter((d) => d.severity === 'warning').length,
    boxes: diags.filter((d) => d.severity === 'info').length,
  };
}
