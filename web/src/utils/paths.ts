/** POSIX-style path helpers for project files. */

export const TEXT_EXTENSIONS = new Set([
  'tex', 'sty', 'cls', 'bib', 'bst', 'bbx', 'cbx', 'lbx', 'dbx', 'def', 'cfg', 'clo', 'ltx', 'dtx', 'ins',
  'txt', 'md', 'csv', 'tsv', 'dat', 'json', 'xml', 'yaml', 'yml', 'tikz', 'pgf', 'lua', 'py', 'r', 'm',
  'ist', 'gls', 'glo', 'latexmkrc', 'bbl', 'svg', 'gitignore', 'fd', 'enc', 'map',
]);

export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'eps', 'bmp']);

export const extname = (p: string) => {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
};
export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const stripExt = (p: string) => p.replace(/\.[^./]+$/, '');

export function isTextPath(p: string): boolean {
  const e = extname(p);
  return TEXT_EXTENSIONS.has(e) || (!e && !basename(p).startsWith('.'));
}
export const isImagePath = (p: string) => IMAGE_EXTENSIONS.has(extname(p));

/** Normalise user input into a safe project-relative path, or null if invalid. */
export function normalisePath(p: string): string | null {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..' || /[\0<>:"|?*]/.test(seg)) return null;
    parts.push(seg);
  }
  return parts.length ? parts.join('/') : null;
}

export function joinPath(dir: string, name: string) {
  return dir ? `${dir}/${name}` : name;
}

/** Relative path from the directory of `from` to `to` (both project-relative). */
export function relativePath(fromFile: string, to: string): string {
  const fromDir = dirname(fromFile).split('/').filter(Boolean);
  const target = to.split('/');
  let i = 0;
  while (i < fromDir.length && i < target.length - 1 && fromDir[i] === target[i]) i++;
  return [...fromDir.slice(i).map(() => '..'), ...target.slice(i)].join('/');
}

export function languageFor(path: string): string {
  const e = extname(path);
  if (['tex', 'sty', 'cls', 'ltx', 'dtx', 'def', 'clo', 'bbx', 'cbx', 'tikz', 'bbl'].includes(e)) return 'latex';
  if (e === 'bib') return 'bibtex';
  if (e === 'md') return 'markdown';
  if (e === 'json') return 'json';
  if (e === 'lua') return 'lua';
  if (e === 'py') return 'python';
  return 'plaintext';
}
