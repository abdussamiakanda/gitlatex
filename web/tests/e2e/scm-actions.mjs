// Every button in the Source control panel's header (Commit, Refresh) and in
// its "More actions" menu (Pull, Push, Sync, Fetch, Stage all, Unstage all,
// Discard all, Create branch), clicked in the browser against a real remote.
// Alice works in the browser; Bob pushes from a second clone.
//
//   gitlatex --no-browser --port 5075 --repos /tmp/gl-scm/repos
//   node tests/e2e/scm-actions.mjs http://127.0.0.1:5075 /tmp/gl-scm
//
// The second argument is the parent of the repos folder: the test puts its
// bare "remote" and Bob's clone next to it.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [base = 'http://127.0.0.1:5075', root] = process.argv.slice(2);
if (!root) {
  console.error('usage: node tests/e2e/scm-actions.mjs <server url> <folder containing repos/>');
  process.exit(2);
}
const id = Date.now().toString(36);
const NAME = `scm-actions-${id}`;
const remote = path.join(root, `remote-${id}.git`);
const alice = path.join(root, 'repos', NAME);
const bob = path.join(root, `bob-${id}`);
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const read = (p) => fs.readFileSync(p, 'utf8');

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${what}`);
  if (!ok) failures++;
};

fs.mkdirSync(path.join(root, 'repos'), { recursive: true });
git(root, 'init', '-q', '--bare', '-b', 'main', remote);
git(root, 'clone', '-q', remote, alice);
git(alice, 'config', 'user.name', 'Alice');
git(alice, 'config', 'user.email', 'alice@example.com');
fs.writeFileSync(path.join(alice, 'main.tex'), '\\documentclass{article}\n\\begin{document}\none\ntwo\nthree\nfour\nfive\nsix\nseven\n\\end{document}\n');
git(alice, 'add', '-A');
git(alice, 'commit', '-qm', 'init');
git(alice, 'push', '-q', '-u', 'origin', 'main');
git(root, 'clone', '-q', remote, bob);
git(bob, 'config', 'user.name', 'Bob');
git(bob, 'config', 'user.email', 'bob@example.com');
const bobPushes = (find, replace, msg) => {
  git(bob, 'pull', '-q', '--rebase');
  const p = path.join(bob, 'main.tex');
  fs.writeFileSync(p, read(p).replace(find, replace));
  git(bob, 'commit', '-qam', msg);
  git(bob, 'push', '-q');
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
const app = (fn, arg) => page.evaluate(fn, arg);
const scm = () => app(() => window.__GITLATEX__.store.getState().scm);
const until = (fn, arg, ms = 20000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const panel = page.locator('aside');
const editor = () => app(() => window.__GITLATEX__.editor.get().getValue());
const editLine = (find, replace) =>
  app(({ find, replace }) => {
    const model = window.__GITLATEX__.editor.get().getModel();
    model.setValue(model.getValue().replace(find, replace));
  }, { find, replace });
const settle = async () => {
  await app(() => window.__GITLATEX__.actions.workspace().flush());
  await app(() => window.__GITLATEX__.actions.refreshScm());
  await page.waitForTimeout(300);
};
const toastSeen = (text) => page.getByText(text).first().isVisible().catch(() => false);
/** Open "More actions" and click an item; returns false when the item is disabled. */
const more = async (label) => {
  await panel.getByRole('button', { name: 'More actions' }).click();
  const item = page.getByRole('menuitem', { name: label, exact: true });
  if (await item.isDisabled()) {
    await page.keyboard.press('Escape');
    return false;
  }
  await item.click();
  return true;
};
const menuDisabled = async (label) => {
  await panel.getByRole('button', { name: 'More actions' }).click();
  const disabled = await page.getByRole('menuitem', { name: label, exact: true }).isDisabled();
  await page.keyboard.press('Escape');
  return disabled;
};
const commitWithHeader = async (message) => {
  await panel.getByPlaceholder(/^Message/).fill(message);
  await panel.getByRole('button', { name: /^Commit \(/ }).click();
};

try {
  await page.goto(base);
  await app(() => {
    localStorage.clear();
    localStorage.setItem('gitlatex.settings', JSON.stringify({ compiler: 'browser', autoCompile: false }));
  });
  await page.reload();
  await page.waitForFunction(() => !window.__GITLATEX__.store.getState().booting);
  await app((n) => window.__GITLATEX__.actions.openProject(n), NAME);
  await page.waitForFunction(() => window.__GITLATEX__.editor.get()?.getModel());
  await page.getByRole('button', { name: 'Source control', exact: true }).click();
  await page.waitForFunction(() => window.__GITLATEX__.store.getState().scm);

  // ---- header: Commit ----
  check(await panel.getByRole('button', { name: /^Commit \(/ }).isDisabled(), 'header Commit is disabled with nothing to commit');
  await editLine('one', 'ONE');
  await settle();
  await commitWithHeader('alice one');
  check(await until(() => window.__GITLATEX__.store.getState().scm.ahead === 1), 'header Commit commits (1 ahead)');
  check(git(alice, 'log', '-1', '--format=%s') === 'alice one' && git(alice, 'status', '--porcelain') === '', '… with the message, and the tree is clean');

  // ---- More → Push ----
  check(await more('Push'), 'Push is enabled');
  check(await until(() => window.__GITLATEX__.store.getState().scm.ahead === 0), 'Push: nothing left ahead');
  check(git(remote, 'log', '-1', '--format=%s', 'main') === 'alice one', '… and the remote has the commit');
  check(await toastSeen('Pushed'), '… with a "Pushed" message');

  // ---- More → Fetch ----
  bobPushes('two', 'TWO (bob)', 'bob two');
  check(await more('Fetch'), 'Fetch is enabled');
  check(await until(() => window.__GITLATEX__.store.getState().scm.behind === 1), 'Fetch: the panel shows 1 behind');
  check(!read(path.join(alice, 'main.tex')).includes('TWO (bob)') && !(await editor()).includes('TWO (bob)'), '… without changing any file');
  check((await panel.innerText()).includes('1↓'), '… and the branch row says 1↓');

  // ---- More → Pull ----
  check(await more('Pull'), 'Pull is enabled');
  check(await until(() => window.__GITLATEX__.store.getState().scm.behind === 0), 'Pull: nothing left behind');
  check(read(path.join(alice, 'main.tex')).includes('TWO (bob)'), '… Bob’s change is on disk');
  check(await until(() => window.__GITLATEX__.editor.get().getValue().includes('TWO (bob)')), '… and in the open editor');

  // ---- More → Sync (both sides have a new commit) ----
  bobPushes('three', 'THREE (bob)', 'bob three');
  await editLine('five', 'FIVE (alice)');
  await settle();
  await commitWithHeader('alice five');
  await until(() => window.__GITLATEX__.store.getState().scm.ahead === 1);
  await app(() => window.__GITLATEX__.actions.scmFetch());
  await until(() => window.__GITLATEX__.store.getState().scm.behind === 1);
  check(await more('Sync'), 'Sync is enabled');
  check(await until(() => { const s = window.__GITLATEX__.store.getState().scm; return s.ahead === 0 && s.behind === 0; }), 'Sync: nothing ahead or behind');
  const synced = read(path.join(alice, 'main.tex'));
  check(synced.includes('THREE (bob)') && synced.includes('FIVE (alice)'), '… both changes are in the file');
  check(git(remote, 'log', '--format=%s', '-2', 'main').split('\n').join(' | ') === 'alice five | bob three', '… and the remote has both, Alice’s on top');

  // ---- More → Stage all / Unstage all / Discard all ----
  await editLine('six', 'SIX (draft)');
  await app(() => window.__GITLATEX__.actions.workspace().writeFile('notes.tex', '% scratch\n'));
  await settle();
  const two = await until(() => window.__GITLATEX__.store.getState().scm.changes.length === 2, null, 8000);
  if (!two) console.log('    changes:', JSON.stringify((await scm()).changes), '| editor has SIX (draft):', (await editor()).includes('SIX (draft)'), '| disk:', read(path.join(alice, 'main.tex')).includes('SIX (draft)'), fs.existsSync(path.join(alice, 'notes.tex')));
  check(two, 'two changes (an edit and a new file)');
  check(await more('Stage all changes'), 'Stage all is enabled');
  check(await until(() => window.__GITLATEX__.store.getState().scm.staged.length === 2), 'Stage all: both staged');
  check(await more('Unstage all changes'), 'Unstage all is enabled');
  check(await until(() => { const s = window.__GITLATEX__.store.getState().scm; return s.staged.length === 0 && s.changes.length === 2; }), 'Unstage all: both back under Changes');
  check(await more('Discard all changes…'), 'Discard all is enabled');
  await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
  check(await until(() => window.__GITLATEX__.store.getState().scm.changes.length === 0), 'Discard all: no changes left');
  check(!fs.existsSync(path.join(alice, 'notes.tex')) && !read(path.join(alice, 'main.tex')).includes('SIX (draft)'), '… the new file is deleted and the edit reverted on disk');
  check(await until(() => !window.__GITLATEX__.editor.get().getValue().includes('SIX (draft)')), '… and in the editor');
  check(await menuDisabled('Stage all changes') && await menuDisabled('Unstage all changes') && await menuDisabled('Discard all changes…'), 'with nothing to do, Stage/Unstage/Discard all are disabled');

  // ---- header: Refresh (a change made outside GitLaTeX) ----
  fs.writeFileSync(path.join(alice, 'outside.tex'), '% written by another program\n');
  await panel.getByRole('button', { name: 'Refresh' }).click();
  check(await until(() => window.__GITLATEX__.store.getState().scm.changes.some((f) => f.path === 'outside.tex')), 'Refresh picks up a file written outside GitLaTeX');
  fs.rmSync(path.join(alice, 'outside.tex'));
  await panel.getByRole('button', { name: 'Refresh' }).click();
  await until(() => window.__GITLATEX__.store.getState().scm.changes.length === 0);

  // ---- More → Create branch…, then Push publishes it ----
  check(await more('Create branch…'), 'Create branch is enabled');
  await page.getByRole('dialog').getByRole('textbox').fill('revision two');
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  check(await until(() => window.__GITLATEX__.store.getState().scm.branch === 'revision-two'), 'Create branch: on "revision-two"');
  check(await menuDisabled('Pull') && await menuDisabled('Sync'), 'an unpublished branch: Pull and Sync are disabled');
  check(await more('Push'), 'Push is enabled on it');
  check(await until(() => !!window.__GITLATEX__.store.getState().scm.upstream), 'Push publishes the branch with an upstream');
  check(git(remote, 'branch', '--list', 'revision-two') !== '', '… the remote has the branch');

  check(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (err) {
  console.error(err);
  failures++;
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
