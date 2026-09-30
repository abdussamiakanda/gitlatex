// Browser checks for the editor features: review comments, spell checking,
// snippets and Vim mode, against a running gitlatex server.
//
//   gitlatex --no-browser --port 5058 --repos /tmp/gl-feat
//   node tests/e2e/editor-features.mjs http://127.0.0.1:5058 /tmp/gl-feat
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [base = 'http://127.0.0.1:5058', reposDir] = process.argv.slice(2);
if (!reposDir) {
  console.error('usage: node tests/e2e/editor-features.mjs <server url> <repos dir>');
  process.exit(2);
}
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
fs.mkdirSync(out, { recursive: true });
const NAME = `feat-${Date.now().toString(36)}`;
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
const editorText = () => app(() => window.__GITLATEX__.editor.get().getValue());
const typeInEditor = async (text) => {
  // Monaco takes input through an EditContext element, not a textarea: focus it via the API.
  await app(() => window.__GITLATEX__.editor.get().focus());
  await page.keyboard.type(text);
};

try {
  await page.goto(base);
  await app(() => {
    localStorage.clear();
    localStorage.setItem('gitlatex.settings', JSON.stringify({ compiler: 'browser', autoCompile: false, spellCheck: true }));
  });
  await page.reload();
  await page.waitForFunction(() => !window.__GITLATEX__.store.getState().booting);
  await app((name) => window.__GITLATEX__.actions.createProject(name, 'blank', true), NAME);
  await page.waitForFunction(() => !!window.__GITLATEX__.editor.get()?.getModel());
  const main = await app(() => window.__GITLATEX__.store.getState().project.mainFile);

  // ---- snippets -------------------------------------------------------------------------------
  await fetch(base + '/snippets', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snippets: [{ prefix: 'eqq', body: '\\begin{equation}\n  $1\n\\end{equation}$0', description: 'equation', scope: 'latex' }] }) });
  await app(async () => {
    const e = window.__GITLATEX__.editor.get();
    const m = e.getModel();
    const line = m.getLineCount();
    e.setPosition({ lineNumber: line, column: m.getLineMaxColumn(line) });
  });
  // Settings loads the list fresh; the editor loads it once, so reopen the page's copy.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByText('eqq', { exact: true }).waitFor({ timeout: 5000 });
  check(true, 'snippet manager lists the saved snippet');
  await page.keyboard.press('Escape');
  await typeInEditor('\neqq');
  await page.keyboard.press('Escape'); // close the suggestion list so Tab expands
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  check((await editorText()).includes('\\begin{equation}'), 'Tab expands a snippet prefix');

  // ---- spell checking ------------------------------------------------------------------------
  // Outside the equation the snippet just inserted: math is (rightly) not spell-checked.
  await page.keyboard.press('Escape');
  await app(() => {
    const e = window.__GITLATEX__.editor.get();
    const m = e.getModel();
    e.setPosition({ lineNumber: m.getLineCount(), column: m.getLineMaxColumn(m.getLineCount()) });
  });
  await typeInEditor('\n\nThis sentense has a speling mistake.\n');
  await page.waitForTimeout(2500);
  const markers = await app(() => {
    const G = window.__GITLATEX__;
    return G.monaco.editor.getModelMarkers({ owner: 'spell', resource: G.editor.get().getModel().uri }).length;
  });
  const status = await (await fetch(base + '/spell/status')).json();
  if (status.available) check(markers >= 2, `misspelled words are underlined (${markers})`);
  else console.log('    (symspellpy not installed: spell check reports unavailable)', status.error ?? '');

  // ---- review comments -----------------------------------------------------------------------
  await app(() => {
    const e = window.__GITLATEX__.editor.get();
    const m = e.getModel();
    const match = m.findMatches('mistake', false, false, true, null, false)[0] ?? m.findMatches('equation', false, false, true, null, false)[0];
    e.setSelection(match.range);
    e.focus();
  });
  await page.keyboard.press('Control+Alt+KeyM');
  const draftBox = page.locator('#review-cards [data-review-input="draft"]');
  await draftBox.waitFor({ timeout: 5000 });
  await draftBox.fill('Please rephrase this.');
  await draftBox.press('Enter');
  await page.locator('#review-cards .review-card').first().waitFor();
  await page.waitForTimeout(500);
  const commentFiles = fs.readdirSync(path.join(reposDir, NAME, '.gitlatex', 'comments'));
  check(commentFiles.length === 1, 'comment saved under .gitlatex/comments/');
  const thread = JSON.parse(fs.readFileSync(path.join(reposDir, NAME, '.gitlatex', 'comments', commentFiles[0]), 'utf8'));
  check(thread.file === main && thread.messages?.[0]?.text === 'Please rephrase this.', 'comment is attached to the file and text');
  check((await page.locator('.monaco-editor .review-highlight').count()) > 0, 'commented text is highlighted');
  check(await app(() => window.__GITLATEX__.store.getState().sidebar === 'review'), 'Add Comment opens Review in the sidebar');
  check((await page.getByRole('button', { name: 'Review comments' }).innerText()).trim() === '1', 'Review icon shows 1 open comment');
  // reply + resolve
  const reply = page.locator('#review-cards [data-review-input="reply"]').first();
  await page.locator('#review-cards .review-card').first().click();
  await reply.fill('Done.');
  await reply.press('Enter');
  await page.waitForTimeout(600);
  check(JSON.parse(fs.readFileSync(path.join(reposDir, NAME, '.gitlatex', 'comments', commentFiles[0]), 'utf8')).messages.length === 2, 'reply saved');
  // comments survive switching files
  await app(() => {
    const ws = window.__GITLATEX__.actions.workspace();
    ws.writeFile('other.tex', 'Other file\n');
    window.__GITLATEX__.actions.openFile('other.tex');
  });
  await page.waitForTimeout(600);
  check((await page.locator('.monaco-editor .review-highlight').count()) === 0, 'another file shows no highlights');
  await app((m) => window.__GITLATEX__.actions.openFile(m), main);
  await page.waitForTimeout(1200);
  check((await page.locator('.monaco-editor .review-highlight').count()) > 0, 'highlights come back with the file (no duplicates)');
  await page.screenshot({ path: path.join(out, 'review.png') });
  await page.locator('#review-cards .review-card button[title="Resolve"]').first().click();
  await page.waitForTimeout(600);
  check(JSON.parse(fs.readFileSync(path.join(reposDir, NAME, '.gitlatex', 'comments', commentFiles[0]), 'utf8')).resolved === true, 'resolve saved');

  // ---- context menu ---------------------------------------------------------------------------
  await app(() => {
    const e = window.__GITLATEX__.editor.get();
    e.setSelection(e.getModel().findMatches('Untitled', false, false, true, null, false)[0].range);
  });
  const sel = await app(() => {
    const e = window.__GITLATEX__.editor.get();
    return e.getScrolledVisiblePosition(e.getSelection().getStartPosition());
  });
  const box = await page.locator('.monaco-editor').first().boundingBox();
  await page.mouse.click(box.x + sel.left + 20, box.y + sel.top + 5, { button: 'right' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, 'context-menu.png') });
  const menu = await page.evaluate(() => {
    const host = [...document.querySelectorAll('.shadow-root-host')].find((h) => h.shadowRoot?.querySelector('.monaco-menu'));
    const m = host?.shadowRoot?.querySelector('.monaco-menu');
    // The colour sits on the menu or one of its containers inside the shadow root.
    const chain = [];
    for (let n = m; n && n.nodeType === 1; n = n.parentNode) chain.push(n);
    const painted = chain.map((n) => getComputedStyle(n).backgroundColor).find((c) => c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent');
    return m ? { bg: painted ?? '', items: [...m.querySelectorAll('.action-label')].map((n) => n.textContent?.trim()).filter(Boolean) } : { bg: '', items: [] };
  });
  check(menu.items.includes('Add Comment') && menu.items.some((t) => t?.startsWith('Save Selection as Snippet')), `context menu has Add Comment and Save Selection as Snippet`);
  check(!!menu.bg && menu.bg !== 'rgba(0, 0, 0, 0)' && menu.bg !== 'transparent', `context menu has a background (${menu.bg})`);
  await page.keyboard.press('Escape');

  // ---- slash menu (Material icons) ------------------------------------------------------------
  await app(() => {
    const e = window.__GITLATEX__.editor.get();
    const m = e.getModel();
    e.setPosition({ lineNumber: m.getLineCount(), column: m.getLineMaxColumn(m.getLineCount()) });
  });
  await typeInEditor('\n/');
  await page.waitForTimeout(500);
  const icons = await page.locator('.material-symbols-outlined').count();
  check(icons > 10, `slash menu shows Material icons (${icons})`);
  await page.screenshot({ path: path.join(out, 'slash-menu.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');

  // ---- vim ------------------------------------------------------------------------------------
  await app(() => window.__GITLATEX__.store.setState((s) => ({ settings: { ...s.settings, vim: true } })));
  await page.locator('.vim-statusbar').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('.vim-statusbar')?.textContent?.includes('NORMAL'), null, { timeout: 10000 });
  check(true, 'Vim mode loads and shows NORMAL');
  await app(() => {
    const e = window.__GITLATEX__.editor.get();
    const m = e.getModel();
    const r = m.findMatches('\\begin{equation}', false, false, true, null, false)[0].range;
    e.setPosition({ lineNumber: r.startLineNumber + 1, column: 3 });
    e.focus();
  });
  await page.keyboard.type('dse');
  await page.waitForTimeout(300);
  const afterDse = await editorText();
  check(!afterDse.includes('\\begin{equation}') && !afterDse.includes('\\end{equation}'), 'VimTeX dse deletes the surrounding environment');
  await page.keyboard.press('u');
  await page.waitForTimeout(200);
  check((await editorText()).includes('\\begin{equation}'), 'u undoes it');
  await page.screenshot({ path: path.join(out, 'vim.png') });
  await app(() => window.__GITLATEX__.store.setState((s) => ({ settings: { ...s.settings, vim: false } })));
  await page.waitForTimeout(300);
  check(!(await page.locator('.vim-statusbar').isVisible()), 'Vim mode turns off');

  check(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (err) {
  failures++;
  console.error('  ✗', err);
  await page.screenshot({ path: path.join(out, 'features-failure.png') }).catch(() => undefined);
  if (errors.length) console.error(errors.slice(-5).join('\n'));
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
