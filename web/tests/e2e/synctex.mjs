// SyncTeX in the browser: source → PDF and back, for a multi-file project,
// after reopening (the .synctex.gz on disk, with paths rewritten by the
// server), and for a Compiler API build whose paths are from another machine.
//
//   gitlatex --no-browser --port 5059 --repos /tmp/gl-sync
//   node tests/e2e/synctex.mjs http://127.0.0.1:5059 /tmp/gl-sync
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const [base = 'http://127.0.0.1:5059', reposDir] = process.argv.slice(2);
if (!reposDir) {
  console.error('usage: node tests/e2e/synctex.mjs <server url> <repos dir>');
  process.exit(2);
}
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
fs.mkdirSync(out, { recursive: true });
const NAME = `sync-${Date.now().toString(36)}`;
const CHAPTER = 'chapters/introduction.tex';
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${what}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
const app = (fn, arg) => page.evaluate(fn, arg);
const state = () => app(() => window.__GITLATEX__.store.getState());
const target = () => app(() => window.__GITLATEX__.store.getState().pdfTarget);

/** Forward-search `line` of the chapter, then click back from the highlighted spot. */
async function roundTrip(label, line) {
  await app(({ f, l }) => {
    window.__GITLATEX__.actions.openFile(f, l);
    window.__GITLATEX__.actions.forwardSearch(l);
  }, { f: CHAPTER, l: line });
  const t = await target();
  check(!!t?.rects?.length, `${label}: forward search from ${CHAPTER}:${line} finds the PDF spot (page ${t?.rects?.[0]?.page})`);
  if (!t?.rects?.length) return;
  await app(() => window.__GITLATEX__.actions.openFile('main.tex'));
  const r = t.rects[0];
  await app((r) => window.__GITLATEX__.actions.inverseSearch(r.page, r.x + Math.min(r.w, 40) / 2, r.y + r.h / 2), r);
  await page.waitForTimeout(300);
  const s = await state();
  check(s.activePath === CHAPTER && Math.abs((s.reveal?.line ?? 0) - line) <= 2, `${label}: inverse search lands back in ${s.activePath}:${s.reveal?.line}`);
}

try {
  await page.goto(base);
  await app(() => {
    localStorage.clear();
    localStorage.setItem('gitlatex.settings', JSON.stringify({ compiler: 'browser', autoCompile: false }));
  });
  await page.reload();
  await page.waitForFunction(() => !window.__GITLATEX__.store.getState().booting);
  await app((n) => window.__GITLATEX__.actions.createProject(n, 'thesis', false), NAME);
  await app(() => window.__GITLATEX__.actions.compile({ reason: 'manual' }));
  await page.waitForFunction(() => window.__GITLATEX__.store.getState().compile.lastCompiledAt, null, { timeout: 240000 });
  const c = await app(() => ({ status: window.__GITLATEX__.store.getState().compile.status, sync: !!window.__GITLATEX__.store.getState().compile.synctex }));
  check(c.sync, `browser build has SyncTeX (${c.status})`);
  await roundTrip('browser build', 5);

  // ---- real UI: Ctrl+click, right-click → Show in PDF, double-click the PDF ----------------
  await app((f) => window.__GITLATEX__.actions.openFile(f, 7), CHAPTER);
  await page.waitForTimeout(400);
  const before = (await target())?.nonce;
  const pos = await app(() => {
    const e = window.__GITLATEX__.editor.get();
    const p = e.getScrolledVisiblePosition({ lineNumber: 7, column: 10 });
    const r = e.getDomNode().getBoundingClientRect();
    return { x: r.left + p.left, y: r.top + p.top + p.height / 2 };
  });
  // page.mouse.click has no modifiers option: hold Control on the keyboard.
  await page.keyboard.down('Control');
  await page.mouse.click(pos.x, pos.y);
  await page.keyboard.up('Control');
  await page.waitForTimeout(300);
  check((await target())?.nonce !== before, 'Ctrl+click in the editor shows the line in the PDF');

  await page.mouse.click(pos.x, pos.y, { button: 'right' });
  await page.waitForTimeout(400);
  const hasShow = await page.evaluate(() =>
    [...document.querySelectorAll('.shadow-root-host')].some((h) => [...(h.shadowRoot?.querySelectorAll('.action-label') ?? [])].some((a) => a.textContent?.trim() === 'Show in PDF')),
  );
  check(hasShow, 'right-click menu has "Show in PDF"');
  await page.keyboard.press('Escape');

  await app(() => window.__GITLATEX__.actions.openFile('main.tex'));
  await page.waitForTimeout(800);
  const t = await target();
  const pageEl = page.locator(`[data-testid="pdf-viewer"] [data-page="${t.rects[0].page}"]`);
  await pageEl.scrollIntoViewIfNeeded();
  const box = await pageEl.boundingBox();
  const scale = box.width / 595.28; // A4 width in points (the thesis template)
  await page.mouse.dblclick(box.x + (t.rects[0].x + 10) * scale, box.y + (t.rects[0].y + t.rects[0].h / 2) * scale);
  await page.waitForTimeout(500);
  check((await state()).activePath === CHAPTER, `double-clicking the PDF opens ${CHAPTER}`);
  await page.screenshot({ path: path.join(out, 'synctex.png') });

  // ---- reopen: SyncTeX comes from the file on disk (server-rewritten absolute paths) --------
  const gz = path.join(reposDir, NAME, 'main.synctex.gz');
  const disk = zlib.gunzipSync(fs.readFileSync(gz)).toString('latin1');
  const firstInput = /^Input:\d+:(.*)$/m.exec(disk)?.[1] ?? '';
  console.log(`    saved SyncTeX inputs look like: ${firstInput}`);
  await page.reload();
  await page.waitForFunction(() => !window.__GITLATEX__.store.getState().booting && window.__GITLATEX__.store.getState().compile.synctex, null, { timeout: 20000 });
  check((await state()).compile.backend === null, 'after reopening, the PDF and SyncTeX come from disk (no compile)');
  await roundTrip('reopened', 5);

  // ---- Compiler API whose SyncTeX lists paths in its own temp folder -------------------------
  const pdf = fs.readFileSync(path.join(reposDir, NAME, 'main.pdf'));
  const remote = zlib.gzipSync(Buffer.from(disk.replace(/^Input:(\d+):(.*)$/gm, (m, tag, p) => {
    const rel = p.replace(/\\/g, '/').split('/' + NAME + '/')[1];
    return rel ? `Input:${tag}:/tmp/remote-build/./${rel.replace(/^\.\//, '')}` : m;
  }), 'latin1'));
  await page.route('https://compiler.example.test/compile', (route) =>
    route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      contentType: 'application/json',
      body: JSON.stringify({ success: true, pdf: pdf.toString('base64'), synctex: remote.toString('base64') }),
    }),
  );
  await app(async () => {
    localStorage.setItem('gitlatex-compiler-api', 'https://compiler.example.test/compile');
    window.__GITLATEX__.store.setState((s) => ({ settings: { ...s.settings, compiler: 'api', savePdf: false } }));
    await window.__GITLATEX__.actions.compile({ reason: 'manual' });
  });
  await page.waitForFunction(() => window.__GITLATEX__.store.getState().compile.backend === 'api' && window.__GITLATEX__.store.getState().compile.status !== 'running', null, { timeout: 20000 });
  await roundTrip('Compiler API (remote paths)', 5);

  check(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (err) {
  failures++;
  console.error('  ✗', err);
  await page.screenshot({ path: path.join(out, 'synctex-failure.png') }).catch(() => undefined);
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
