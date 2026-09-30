/**
 * Lightweight BibTeX parser for editor features (citation completion, hover
 * cards, the cite picker). BibTeX itself runs in the engine; this only needs
 * keys and a few display fields, and must never throw on malformed input.
 */
export interface BibEntry {
  key: string;
  type: string;
  fields: Record<string, string>;
  file: string;
  line: number;
}

/** Remove the outer braces/quotes and collapse LaTeX grouping for display. */
export function cleanField(v: string): string {
  return v
    .replace(/\\(?:textit|textbf|emph|mathrm)\{([^}]*)\}/g, '$1')
    .replace(/\\([&%$#_{}])/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseBib(text: string, file = ''): BibEntry[] {
  const out: BibEntry[] = [];
  const re = /@(\w+)\s*[{(]\s*([^,\s]+)\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const type = m[1].toLowerCase();
    if (type === 'comment' || type === 'string' || type === 'preamble') continue;
    // Find the end of the entry by brace matching.
    let depth = 1;
    let i = re.lastIndex;
    for (; i < text.length && depth > 0; i++) {
      const c = text[i];
      if (c === '\\') i++;
      else if (c === '{' || c === '(') depth++;
      else if (c === '}' || c === ')') depth--;
    }
    const body = text.slice(re.lastIndex, i - 1);
    const fields: Record<string, string> = {};
    const fre = /(\w+)\s*=\s*/g;
    let f: RegExpExecArray | null;
    while ((f = fre.exec(body))) {
      let j = fre.lastIndex;
      let value = '';
      if (body[j] === '{') {
        let d = 0;
        const start = j;
        for (; j < body.length; j++) {
          if (body[j] === '{') d++;
          else if (body[j] === '}' && --d === 0) break;
        }
        value = body.slice(start + 1, j);
        j++;
      } else if (body[j] === '"') {
        const end = body.indexOf('"', j + 1);
        value = body.slice(j + 1, end < 0 ? body.length : end);
        j = end < 0 ? body.length : end + 1;
      } else {
        const end = body.slice(j).search(/[,\n]/);
        value = body.slice(j, end < 0 ? body.length : j + end);
        j = end < 0 ? body.length : j + end;
      }
      fields[f[1].toLowerCase()] = cleanField(value);
      fre.lastIndex = j;
    }
    out.push({ key: m[2], type, fields, file, line: text.slice(0, m.index).split('\n').length });
    re.lastIndex = i;
  }
  return out;
}

export function formatEntry(e: BibEntry): string {
  const author = e.fields.author?.split(/\s+and\s+/i).map((a) => a.split(',')[0].trim()).join(', ');
  const year = e.fields.year ?? e.fields.date?.slice(0, 4);
  const where = e.fields.journal ?? e.fields.booktitle ?? e.fields.publisher ?? '';
  return [author, year && `(${year})`, e.fields.title && `“${e.fields.title}”`, where].filter(Boolean).join(' ');
}

/** Fetch a BibTeX record for a DOI via doi.org content negotiation (CORS-enabled). */
export async function bibtexFromDoi(doi: string): Promise<string> {
  const clean = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  if (!/^10\.\d{4,9}\/\S+$/.test(clean)) throw new Error('That does not look like a DOI (expected 10.xxxx/…)');
  const res = await fetch(`https://doi.org/${encodeURIComponent(clean).replace(/%2F/g, '/')}`, {
    headers: { Accept: 'application/x-bibtex; charset=utf-8' },
  });
  if (!res.ok) throw new Error(`DOI lookup failed (${res.status})`);
  const text = (await res.text()).trim();
  if (!text.startsWith('@')) throw new Error('No BibTeX record returned for this DOI');
  // Pretty-print the single-line record returned by the resolver.
  return text.replace(/,\s*(\w+)\s*=/g, ',\n  $1 = ').replace(/\}\s*$/, '\n}') + '\n';
}
