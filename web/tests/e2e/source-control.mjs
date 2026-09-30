// The Source control panel end to end: Alice works in the browser, Bob pushes
// from a second clone, and conflicts are resolved in the editor.
//
//   gitlatex --no-browser --port 5075 --repos /tmp/gl-scm/repos
//   node tests/e2e/source-control.mjs http://127.0.0.1:5075 /tmp/gl-scm
//
// The second argument is the parent of the repos folder: the test puts its
// bare "remote" and Bob's clone next to it.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [base = 'http://127.0.0.1:5075', root] = process.argv.slice(2);
if (!root) {
  console.error('usage: node tests/e2e/source-control.mjs <server url> <folder containing repos/>');
  process.exit(2);
}
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
fs.mkdirSync(out, { recursive: true });
const id = Date.now().toString(36);
const NAME = `scm-${id}`;
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

// A shared remote with one commit, Alice's clone in the served repos folder, Bob's beside it.
git(root, 'init', '-q', '--bare', '-b', 'main', remote);
git(root, 'clone', '-q', remote, alice);
for (const [dir, user] of [[alice, 'Alice']]) {
  git(dir, 'config', 'user.name', user);
  git(dir, 'config', 'user.email', `${user.toLowerCase()}@example.com`);
}
fs.writeFileSync(path.join(alice, 'main.tex'), '\\documentclass{article}\n\\begin{document}\none\ntwo\nthree\nfour\nfive\n\\end{document}\n');
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
const panel = page.locator('aside');
const editLine = (find, replace) =>
  app(({ find, replace }) => {
    const ws = window.__GITLATEX__.actions.workspace();
    window.__GITLATEX__.editor.get().getModel().setValue(ws.getText('main.tex').replace(find, replace));
  }, { find, replace });
const settle = async () => {
  await app(() => window.__GITLATEX__.actions.workspace().flush());
  await app(() => window.__GITLATEX__.actions.refreshScm());
  await page.waitForTimeout(300);
};
const primary = () => panel.locator('button.brand-gradient').first();
const confirmDialog = (label) => page.getByRole('dialog').getByRole('button', { name: label }).click();

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
  check((await panel.innerText()).includes('main'), 'panel shows the branch');

  // ---- edit, stage, unstage, commit, sync ----
  await editLine('two', 'TWO');
  await settle();
  check((await scm()).changes.map((f) => f.path).join() === 'main.tex', 'the edit shows under Changes');
  const row = panel.locator('[role=button][title^="main.tex"]').first();
  await row.hover();
  await row.getByRole('button', { name: 'Stage changes' }).click();
  await page.waitForFunction(() => window.__GITLATEX__.store.getState().scm.staged.length === 1);
  check((await panel.innerText()).toUpperCase().includes('STAGED CHANGES'), 'stage from the row → Staged Changes');
  const staged = panel.locator('[role=button][title^="main.tex"]').first();
  await staged.hover();
  await staged.getByRole('button', { name: 'Unstage changes' }).click();
  await page.waitForFunction(() => window.__GITLATEX__.store.getState().scm.staged.length === 0);
  check(true, 'unstage from the row');
  await panel.getByPlaceholder(/^Message/).fill('alice edits two');
  await primary().click();
  await page.waitForFunction(() => window.__GITLATEX__.store.getState().scm.ahead === 1);
  check((await primary().innerText()).includes('Sync changes'), 'after committing, the button offers Sync');
  await primary().click();
  await page.waitForFunction(() => window.__GITLATEX__.store.getState().scm.ahead === 0, null, { timeout: 20000 });
  check(git(remote, 'log', '-1', '--format=%s', 'main') === 'alice edits two', 'Sync pushed the commit');

  // ---- a rebase conflict, resolved in the editor ----
  bobPushes('three', "bob's three", 'bob three');
  await editLine('three', "alice's three");
  await settle();
  await panel.getByPlaceholder(/^Message/).fill('alice three');
  await primary().click();
  await page.waitForFunction(() => window.__GITLATEX__.store.getState().scm.ahead === 1);
  await app(() => window.__GITLATEX__.actions.scmSync());
  let st = await scm();
  check(st.inProgress === 'rebase' && st.conflicts.map((c) => c.path).join() === 'main.tex', 'Sync stops at the conflict (rebase kept, not undone)');
  check((await panel.innerText()).toUpperCase().includes('MERGE CHANGES'), 'Merge Changes section lists the file');
  await panel.locator('[role=button][title^="main.tex"]').first().click();
  await page.waitForTimeout(800);
  const lens = page.locator('.monaco-editor .codelens-decoration a', { hasText: 'Accept Incoming Change' });
  await lens.first().waitFor({ timeout: 10000 });
  check((await lens.first().innerText()).includes('Your version'), `the editor names the sides: "${await lens.first().innerText()}"`);
  check((await page.locator('.monaco-editor .conflict-current, .monaco-editor .conflict-incoming').count()) > 0, 'conflict blocks are coloured');
  await page.screenshot({ path: path.join(out, 'scm-conflict.png') });
  await lens.first().click();
  await page.waitForTimeout(300);
  const text = await app(() => window.__GITLATEX__.editor.get().getValue());
  check(!text.includes('<<<<<<<') && text.includes("alice's three") && !text.includes("bob's three"), 'Accept Incoming Change keeps Alice’s line');
  await settle();
  const conflictRow = panel.locator('[role=button][title^="main.tex"]').first();
  await conflictRow.hover();
  await conflictRow.getByRole('button', { name: 'Mark resolved (stage)' }).click();
  await page.waitForFunction(() => window.__GITLATEX__.store.getState().scm.conflicts.length === 0);
  check((await primary().innerText()).includes('Continue rebase'), 'resolved: the button continues the rebase');
  await primary().click();
  await page.waitForFunction(() => !window.__GITLATEX__.store.getState().scm.inProgress, null, { timeout: 15000 });
  check(git(alice, 'log', '--format=%s', '-3').split('\n').join(' | ') === 'alice three | bob three | alice edits two', 'history is linear: Alice’s commit on top of Bob’s');
  await primary().click(); // Sync
  await page.waitForFunction(() => window.__GITLATEX__.store.getState().scm.ahead === 0, null, { timeout: 20000 });
  check(git(remote, 'log', '-1', '--format=%s', 'main') === 'alice three', 'and it is pushed');

  // ---- unsaved edits that conflict with a pull: abort puts them back ----
  bobPushes('five', "bob's five", 'bob five');
  await editLine('five', "alice's unsaved five");
  await settle();
  await app(() => window.__GITLATEX__.actions.scmPull());
  st = await scm();
  check(st.inProgress === 'autostash' && st.sides.incoming === 'Your unsaved edits', 'pull with a conflicting unsaved edit → autostash state');
  await panel.getByRole('button', { name: 'Abort pull' }).click();
  await confirmDialog('Abort pull');
  await page.waitForFunction(() => !window.__GITLATEX__.store.getState().scm.inProgress, null, { timeout: 15000 });
  // The panel updates first; the editor follows once the files are re-read.
  await page.waitForFunction(() => !window.__GITLATEX__.editor.get().getValue().includes('<<<<<<<'), null, { timeout: 10000 }).catch(() => undefined);
  const afterAbort = await app(() => window.__GITLATEX__.editor.get().getValue());
  check(afterAbort.includes("alice's unsaved five") && !afterAbort.includes('<<<<<<<'), 'abort restores her unsaved edit (editor re-synced from disk)');

  // ---- discard ----
  const discardRow = panel.locator('[role=button][title^="main.tex"]').first();
  await discardRow.hover();
  await discardRow.getByRole('button', { name: 'Discard changes' }).click();
  await confirmDialog('Discard');
  await page.waitForFunction(() => window.__GITLATEX__.store.getState().scm.changes.length === 0);
  await page.waitForFunction(() => !window.__GITLATEX__.editor.get().getValue().includes('unsaved five'), null, { timeout: 10000 }).catch(() => undefined);
  check(!(await app(() => window.__GITLATEX__.editor.get().getValue())).includes('unsaved five'), 'discard reverts the file in the editor too');

  // ---- branches ----
  await panel.locator('button[title="Switch or create a branch"]').click();
  await page.getByRole('menuitem', { name: 'Create new branch…' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('revision two');
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  await page.waitForFunction(() => window.__GITLATEX__.store.getState().scm.branch === 'revision-two');
  check((await primary().innerText()).includes('Publish branch'), 'a new branch offers Publish branch');
  await primary().click();
  await page.waitForFunction(() => window.__GITLATEX__.store.getState().scm.upstream === 'origin/revision-two', null, { timeout: 15000 });
  check(true, 'Publish branch pushes it with an upstream');

  // ---- publish a local-only project ----
  await app((n) => window.__GITLATEX__.actions.createProject(n, 'blank', true), `local-${id}`);
  await page.waitForFunction(() => window.__GITLATEX__.editor.get()?.getModel());
  // Source control is already the open view (its icon would toggle it closed).
  await app(() => window.__GITLATEX__.store.setState({ sidebar: 'git' }));
  await page.waitForFunction(() => window.__GITLATEX__.store.getState().scm?.hasCommits === false);
  await panel.getByPlaceholder(/^Message/).fill('first');
  await primary().click();
  await page.waitForFunction(() => window.__GITLATEX__.store.getState().scm.hasCommits);
  check((await primary().innerText()).includes('Publish branch'), 'no remote → Publish branch');
  await primary().click();
  const target = path.join(root, `published-${id}.git`);
  git(root, 'init', '-q', '--bare', target);
  await page.getByRole('dialog').getByPlaceholder(/github\.com/).fill(target);
  await page.screenshot({ path: path.join(out, 'scm-publish.png') });
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  // The branch name comes from the user's git (init.defaultBranch): main or master.
  await page.waitForFunction(() => window.__GITLATEX__.store.getState().scm.upstream?.startsWith('origin/'), null, { timeout: 20000 });
  const branch = (await scm()).branch;
  check(git(target, 'log', '-1', '--format=%s', branch) === 'first', `Publish dialog adds the remote and pushes (${branch})`);
  check((await page.getByText('changed the same lines').count()) === 0, 'conflict warnings are gone once conflicts are resolved');

  await page.screenshot({ path: path.join(out, 'scm-panel.png') });
  check(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (err) {
  failures++;
  console.error('  ✗', err);
  await page.screenshot({ path: path.join(out, 'scm-failure.png') }).catch(() => undefined);
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
