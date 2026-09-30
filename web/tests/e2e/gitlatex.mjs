// End-to-end check of the editor against a running gitlatex server.
//
//   gitlatex --no-browser --port 5055 --repos /tmp/gl-e2e
//   node tests/e2e/gitlatex.mjs http://127.0.0.1:5055 /tmp/gl-e2e
//
// Creates a project from a template, compiles it with the in-browser engine
// (Settings → Compiler: In the browser), checks that edits and the PDF land on
// disk, commits, and saves screenshots to tests/e2e/out/.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [base = 'http://127.0.0.1:5055', reposDir] = process.argv.slice(2);
if (!reposDir) {
  console.error('usage: node tests/e2e/gitlatex.mjs <server url> <repos dir>');
  process.exit(2);
}
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
fs.mkdirSync(out, { recursive: true });

const NAME = `e2e-${Date.now().toString(36)}`;
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${what}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const app = (fn, arg) => page.evaluate(fn, arg);

try {
  await page.goto(base);
  await page.addInitScript(() => {
    try {
      const s = JSON.parse(localStorage.getItem('gitlatex.settings') || '{}');
      localStorage.setItem('gitlatex.settings', JSON.stringify({ ...s, compiler: 'browser' }));
    } catch {}
  });
  await page.reload();
  await page.getByRole('heading', { name: 'Projects' }).waitFor({ timeout: 15000 });
  await page.screenshot({ path: path.join(out, '1-home-dark.png') });
  check(true, 'projects home renders');

  // Create a project through the dialog.
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByPlaceholder(/./).last().fill(NAME);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForFunction(() => !!window.__GITLATEX__.store.getState().project, null, { timeout: 15000 });
  const project = await app(() => window.__GITLATEX__.store.getState().project);
  check(project.id === NAME && project.hasGit, `project "${project.id}" created with Git`);
  check(fs.existsSync(path.join(reposDir, NAME, project.mainFile)), `${project.mainFile} is on disk`);

  // Compile in the browser.
  const t0 = Date.now();
  await page.waitForFunction(
    () => {
      const c = window.__GITLATEX__.store.getState().compile;
      return c.pdfFromCurrentRun || ['failed', 'crashed'].includes(c.status);
    },
    null,
    { timeout: 240000, polling: 500 },
  );
  const compile = await app(() => {
    const c = window.__GITLATEX__.store.getState().compile;
    return { status: c.status, backend: c.backend, bytes: c.pdf?.length ?? 0, error: c.error, errors: c.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message) };
  });
  console.log(`    compile: ${JSON.stringify(compile)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  check(compile.backend === 'browser' && compile.bytes > 1000, 'compiled to PDF with the in-browser engine');
  const pdfOnDisk = path.join(reposDir, NAME, project.mainFile.replace(/\.tex$/, '.pdf'));
  await page.waitForTimeout(1500);
  check(fs.existsSync(pdfOnDisk) && fs.statSync(pdfOnDisk).size === compile.bytes, 'PDF saved into the project folder');
  check(fs.existsSync(pdfOnDisk.replace(/\.pdf$/, '.synctex.gz')), 'SyncTeX saved next to it');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(out, '2-editor-dark.png') });

  // Edit → disk.
  await app((main) => {
    const ws = window.__GITLATEX__.actions.workspace();
    ws.setText(main, ws.getText(main).replace('\\end{document}', 'Edited by the e2e test.\n\\end{document}'));
  }, project.mainFile);
  await app(() => window.__GITLATEX__.actions.workspace().flush());
  check(fs.readFileSync(path.join(reposDir, NAME, project.mainFile), 'utf8').includes('Edited by the e2e test.'), 'edits are written to disk');

  // New file + folder, rename, delete.
  await app(() => {
    const ws = window.__GITLATEX__.actions.workspace();
    ws.writeFile('chapters/one.tex', '\\section{One}\n');
    ws.createFolder('figures');
    ws.rename('chapters', 'parts');
  });
  await app(() => window.__GITLATEX__.actions.workspace().flush());
  check(fs.existsSync(path.join(reposDir, NAME, 'parts', 'one.tex')) && !fs.existsSync(path.join(reposDir, NAME, 'chapters')), 'create + rename reach the disk in order');
  check(fs.statSync(path.join(reposDir, NAME, 'figures')).isDirectory(), 'empty folder created');
  await app(() => window.__GITLATEX__.actions.workspace().delete('figures'));
  await app(() => window.__GITLATEX__.actions.workspace().flush());
  check(!fs.existsSync(path.join(reposDir, NAME, 'figures')), 'delete reaches the disk');

  // Commit through the Source control panel.
  await page.getByRole('button', { name: 'Source control', exact: true }).click();
  await page.getByPlaceholder('Commit message').fill('First draft');
  await page.getByRole('button', { name: 'Commit', exact: true }).click();
  await page.getByText('Committed').first().waitFor({ timeout: 15000 });
  const log = await (await fetch(base + '/commits')).json();
  check(log.commits?.[0]?.message === 'First draft', 'commit recorded in Git');
  await page.getByRole('button', { name: 'Commit history' }).click();
  const history = page.locator('aside');
  await history.getByText('First draft').waitFor({ timeout: 15000 });
  await history.getByText('First draft').click();
  await history.getByText('main.tex').waitFor({ timeout: 15000 });
  check(true, 'history lists the commit and its files');
  await page.screenshot({ path: path.join(out, '3-history-dark.png') });

  // Remote Compiler API (intercepted): same request format as the classic editor.
  const pdfBytes = fs.readFileSync(pdfOnDisk);
  let apiRequest = null;
  await page.route('https://compiler.example.test/compile', async (route) => {
    apiRequest = { body: route.request().postDataJSON(), auth: route.request().headers()['authorization'] };
    await route.fulfill({
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      contentType: 'application/json',
      body: JSON.stringify({ success: true, pdf: 'data:application/pdf;base64,' + pdfBytes.toString('base64'), log: 'This is the remote log' }),
    });
  });
  const idle = () => page.waitForFunction(() => window.__GITLATEX__.store.getState().compile.status !== 'running', null, { timeout: 120000 });
  await idle();
  fs.rmSync(pdfOnDisk);
  await app(async () => {
    const { store, actions } = window.__GITLATEX__;
    localStorage.setItem('gitlatex-compiler-api', 'compiler.example.test/compile');
    localStorage.setItem('gitlatex-compiler-api-key', 'test-key');
    store.setState((s) => ({ settings: { ...s.settings, compiler: 'api' } }));
    await actions.compile({ reason: 'manual' });
  });
  await page.waitForFunction(() => window.__GITLATEX__.store.getState().compile.backend === 'api' && window.__GITLATEX__.store.getState().compile.status !== 'running', null, { timeout: 30000 });
  const viaApi = await app(() => {
    const c = window.__GITLATEX__.store.getState().compile;
    return { backend: c.backend, status: c.status, bytes: c.pdf?.length ?? 0, log: c.result?.log?.slice(0, 60) };
  });
  check(
    apiRequest?.body.main === project.mainFile && apiRequest.body.engine === 'pdflatex' && apiRequest.body.files.some((f) => f.path === project.mainFile && f.content) && apiRequest.auth === 'Bearer test-key',
    'Compiler API receives { main, files, engine } with the Bearer key',
  );
  check(viaApi.backend === 'api' && viaApi.bytes === pdfBytes.length && viaApi.log === 'This is the remote log', `Compiler API result is shown (${JSON.stringify(viaApi)})`);
  await page.waitForTimeout(1500);
  check(fs.existsSync(pdfOnDisk), 'Compiler API PDF saved into the project folder');
  await app(() => window.__GITLATEX__.store.setState((s) => ({ settings: { ...s.settings, compiler: 'browser' } })));

  // Light theme.
  await app(() => window.__GITLATEX__.actions.setTheme('light'));
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, '4-editor-light.png') });
  await app(() => window.__GITLATEX__.actions.setTheme('dark'));

  const unexpected = errors.filter((e) => !/favicon|ResizeObserver/.test(e));
  check(!unexpected.length, `no page errors${unexpected.length ? ': ' + unexpected.slice(0, 5).join(' | ') : ''}`);
} catch (err) {
  failures++;
  console.error('  ✗', err);
  await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => undefined);
  console.error(errors.slice(-10).join('\n'));
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
