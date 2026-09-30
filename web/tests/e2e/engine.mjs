// End-to-end test of the WebAssembly TeX engine in headless Chromium.
// Usage: node tests/e2e/engine.mjs [baseUrl] [docName...]
import { chromium } from 'playwright';
import { DOCS } from './engine-docs.mjs';

const base = process.argv[2] || 'http://127.0.0.1:5173/';
const only = process.argv.slice(3);
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 300)); });
await page.goto(new URL('engine-harness.html', base).href);
await page.waitForFunction(() => window.engine);
const t0 = Date.now();
const info = await page.evaluate(() => window.engine.start());
console.log(`engine ready in ${Date.now() - t0} ms:`, info.name, '| shelf:', info.shelf.label, info.shelf.bundles);

let failures = 0;
for (const [name, doc] of Object.entries(DOCS)) {
  if (only.length && !only.includes(name)) continue;
  const t = Date.now();
  const r = await page.evaluate(async ({ doc }) => {
    const files = Object.entries(doc.files).map(([path, data]) => ({ path, data }));
    for (const [path, b64] of Object.entries(doc.binary ?? {})) files.push({ path, data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) });
    try {
      const res = await window.engine.compile({ files, mainFile: 'main.tex', engine: doc.engine, bibtex: 'auto', makeindex: true, maxPasses: 5, haltOnError: false, synctex: true, clean: true, useShelf: true });
      return { ...res, pdf: res.pdf ? res.pdf.length : 0, synctex: res.synctex ? res.synctex.length : 0, pdfHead: res.pdf ? String.fromCharCode(...res.pdf.slice(0, 5)) : '' };
    } catch (e) { return { error: String(e) }; }
  }, { doc });
  const ms = Date.now() - t;
  if (r.error || doc.expect.error) {
    if (doc.expect.error && r.error?.includes(doc.expect.error)) console.log(`✔ ${name}: rejected as expected (${r.error})`);
    else { console.log(`✖ ${name}: ${r.error ?? 'expected an error'}`); failures++; }
    continue;
  }
  const problems = [];
  const e = doc.expect;
  if (!e.status.includes(r.status)) problems.push(`status ${r.status}`);
  if (e.status.some((s) => s !== 'failed' && s !== 'errors') && r.pdfHead !== '%PDF-') problems.push('no PDF');
  for (const s of e.logIncludes ?? []) if (!r.log.includes(s)) problems.push(`log lacks "${s}"`);
  for (const s of e.logExcludes ?? []) if (r.log.includes(s)) problems.push(`log has "${s}"`);
  if (e.fetchedIncludes && !r.fetched.some((f) => f === e.fetchedIncludes)) problems.push(`did not fetch ${e.fetchedIncludes}`);
  if (e.passesAtLeast && r.passes < e.passesAtLeast) problems.push(`only ${r.passes} passes`);
  const summary = `${r.status} pdf=${r.pdf}B synctex=${r.synctex}B passes=${r.passes} steps=${r.steps.map((s) => `${s.tool}:${s.exitCode}:${s.ms}ms`).join(',')} fetched=[${r.fetched.join(',')}] unresolved=[${r.unresolved.join(',')}] ${ms}ms`;
  if (problems.length) {
    failures++;
    console.log(`✖ ${name}: ${problems.join('; ')}\n   ${summary}\n   notices: ${r.notices.join(' | ')}\n   --- log tail ---\n${r.log.split('\n').filter((l) => /^!|:\d+:|Error|Warning|not found/.test(l)).slice(0, 25).join('\n')}\n   --- transcript tail ---\n${r.transcript.slice(-1500)}`);
  } else console.log(`✔ ${name}: ${summary}`);
}
await browser.close();
console.log(failures ? `\n${failures} failure(s)` : '\nall engine tests passed');
process.exit(failures ? 1 : 0);
