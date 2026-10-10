// End-to-end check of live collaboration: two GitLaTeX servers (two people,
// two folders on disk) share one project through a local collab relay. Ada
// owns the relay (she has its admin token) and hosts the room; Bob joins with
// the invite she copies.
//
//   (in a clone of github.com/abdussamiakanda/gitlatex-collab)
//   echo ADMIN_TOKEN=test-admin > .dev.vars && npx wrangler dev --port 8787
//   gitlatex --no-browser --port 5101 --repos /tmp/gl-a
//   gitlatex --no-browser --port 5102 --repos /tmp/gl-b
//   node tests/e2e/collab.mjs http://127.0.0.1:5101 /tmp/gl-a http://127.0.0.1:5102 /tmp/gl-b localhost:8787 test-admin
//
// The test writes the "paper" project in each repos folder itself, as a git
// repository whose user.name is Ada or Bob (that is the name others see).
import { chromium } from 'playwright';
import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [baseA, dirA, baseB, dirB, relay = 'localhost:8787', adminToken = 'test-admin'] = process.argv.slice(2);
if (!dirB) {
  console.error('usage: node tests/e2e/collab.mjs <url A> <repos A> <url B> <repos B> [relay host] [admin token]');
  process.exit(2);
}

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${what}`);
  if (!ok) failures++;
};
const read = (dir, file) => (fs.existsSync(path.join(dir, 'paper', file)) ? fs.readFileSync(path.join(dir, 'paper', file), 'utf8') : null);
const until = async (fn, what, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`    (timed out waiting for: ${what})`);
  return false;
};

const ROOM = `e2e-${Date.now().toString(36)}`;
for (const [dir, text] of [
  [dirA, '\\documentclass{article}\n\\begin{document}\nFrom A.\n\\end{document}\n'],
  [dirB, '\\documentclass{article}\n\\begin{document}\nStale copy on B.\n\\end{document}\n'],
]) {
  fs.rmSync(path.join(dir, 'paper'), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'paper'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'paper', 'main.tex'), text);
}
fs.writeFileSync(path.join(dirB, 'paper', 'only-b.tex'), '\\section{Only on B}\n');
for (const [dir, name] of [
  [dirA, 'Ada'],
  [dirB, 'Bob'],
]) {
  const git = (...args) => execFileSync('git', args, { cwd: path.join(dir, 'paper'), stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.name', name);
}
fs.mkdirSync(path.join(dirA, 'other'), { recursive: true });
fs.writeFileSync(path.join(dirA, 'other', 'main.tex'), '\\documentclass{article}\n');

const browser = await chromium.launch();
const errors = [];

async function person(base, name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  await page.addInitScript(() => {
    localStorage.setItem('gitlatex.settings', JSON.stringify({ autoCompile: false, compiler: 'browser', beginnerMode: false }));
  });
  await page.goto(base);
  await page.waitForFunction(() => window.__GITLATEX__ && !window.__GITLATEX__.store.getState().booting);
  await page.evaluate(() => window.__GITLATEX__.actions.openProject('paper'));
  await page.waitForFunction(() => window.__GITLATEX__.store.getState().project?.id === 'paper');
  const app = (fn, arg) => page.evaluate(fn, arg);
  const state = () => app(() => window.__GITLATEX__.store.getState().collab);
  const text = (p) => app((p) => window.__GITLATEX__.actions.workspace().getText(p), p);
  const flush = () => app(() => window.__GITLATEX__.actions.workspace().flush());
  return { page, app, state, text, flush, name };
}

const showPanel = (p) => p.app(() => window.__GITLATEX__.store.setState({ sidebar: 'collab' }));

/** The owner signs in to the relay with its admin token, creates the room and goes live. Returns the invite. */
async function host(p) {
  await showPanel(p);
  await p.page.getByRole('tab', { name: 'Host' }).click();
  await p.page.getByLabel('Relay address').fill(relay);
  await p.page.getByLabel('Admin token').fill(adminToken);
  await p.page.getByRole('button', { name: 'Connect' }).click();
  await p.page.getByLabel('Room for this project').fill(ROOM);
  await p.page.getByRole('button', { name: 'Create room & go live' }).click();
  if (!(await until(async () => (await p.state())?.status === 'connected', `${p.name} connected`))) return null;
  return p.page.locator('code[title^="gitlatex-invite:"]').getAttribute('title');
}

/** A co-author pastes the invite. */
async function join(p, invite, ms) {
  await showPanel(p);
  await p.page.getByPlaceholder('Paste the invite').fill(invite);
  await p.page.getByRole('button', { name: 'Join', exact: true }).click();
  return until(async () => (await p.state())?.status === 'connected', `${p.name} connected`, ms);
}

/** The same invite with another token. */
const forge = (invite) => {
  const data = JSON.parse(Buffer.from(invite.slice('gitlatex-invite:'.length), 'base64url').toString());
  return 'gitlatex-invite:' + Buffer.from(JSON.stringify({ ...data, t: 'not-the-token' })).toString('base64url');
};

try {
  const a = await person(baseA, 'Ada');
  const b = await person(baseB, 'Bob');
  check((await a.state()) === null && (await b.state()) === null, 'projects are not shared until asked');

  const invite = await host(a);
  check(!!invite, 'A (the relay owner) creates the room, goes live and gets an invite');
  if (!invite) throw new Error('no invite');
  check((await a.state())?.me.name === 'Ada', 'A appears under her git user.name');

  check(!(await join(b, forge(invite), 2500)), 'an invite with a wrong token is refused');
  await b.app(() => window.__GITLATEX__.actions.leaveCollab(true));
  check(await join(b, invite), 'B joins with the invite');

  check(await until(async () => (await b.text('main.tex'))?.includes('From A.'), 'B gets main.tex'), 'B’s differing main.tex is replaced by the room’s');
  await b.flush();
  check(read(dirB, 'main.tex')?.includes('From A.'), '… and written to B’s disk');
  check(await until(async () => (await a.text('only-b.tex')) !== undefined, 'only-b.tex on A'), 'a file only B had reaches A');
  await a.flush();
  check(read(dirA, 'only-b.tex')?.includes('Only on B'), '… and A’s disk');

  check(await until(async () => (await a.state())?.peers.some((p) => p.name === 'Bob'), 'A sees Bob'), 'A sees Bob in the room');

  // Reloading the page must not leave copies of you behind. In production a reloaded
  // page often leaves its old connection open on the relay for a while; a "zombie"
  // client with Bob's browser id that goes silent stands in for it.
  const bobSid = await b.app(() => localStorage.getItem('gitlatex.collab.browser'));
  const zombieToken = JSON.parse(Buffer.from(invite.slice('gitlatex-invite:'.length), 'base64url').toString()).t;
  const zombie = new YProvider(relay, ROOM, new Y.Doc(), { party: 'collab', params: { token: zombieToken }, protocol: 'ws', WebSocketPolyfill: WebSocket });
  zombie.awareness.setLocalStateField('user', { name: 'Bob', color: '#e5484d', sid: bobSid });
  await until(async () => (await a.state())?.peers.filter((p) => p.name === 'Bob').length === 2 || zombie.wsconnected, 'zombie connected');
  clearInterval(zombie.awareness._checkInterval); // stops its heartbeats: silent, socket still open
  for (let k = 0; k < 2; k++) {
    await b.page.reload();
    await b.page.waitForFunction(() => window.__GITLATEX__ && !window.__GITLATEX__.store.getState().booting);
    await b.app(() => window.__GITLATEX__.store.getState().project?.id === 'paper' || window.__GITLATEX__.actions.openProject('paper'));
    await until(async () => (await b.state())?.status === 'connected', 'B reconnected after reload');
  }
  const bobs = async () => (await a.state())?.peers.filter((p) => p.name === 'Bob').length;
  await until(async () => (await b.state())?.peers.some((p) => p.name === 'Ada'), 'B sees Ada again');
  await new Promise((r) => setTimeout(r, 1500));
  check((await bobs()) === 1, `after B reloads twice, A sees one Bob (saw ${await bobs()})`);
  const bPeers = (await b.state())?.peers.map((p) => p.name) ?? [];
  check(bPeers.length === 1 && bPeers[0] === 'Ada', `and B sees only Ada, not itself (saw ${bPeers.join(', ')})`);
  zombie.destroy();
  await b.app(() => window.__GITLATEX__.actions.openFile('main.tex'));

  // Typing in A's editor shows up in B's editor.
  await a.app(() => window.__GITLATEX__.actions.openFile('main.tex'));
  await b.app(() => window.__GITLATEX__.actions.openFile('main.tex'));
  const editorA = a.page.getByTestId('editor');
  await editorA.click();
  await a.page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
  await a.page.keyboard.type('% typed by Ada\n');
  check(await until(async () => (await b.text('main.tex'))?.includes('% typed by Ada'), 'B sees typing'), 'typing in A appears in B');
  const modelB = await b.app(() => window.__GITLATEX__.editor.get()?.getModel()?.getValue() ?? null);
  check(modelB?.includes('% typed by Ada'), 'B’s open editor shows it');

  // Concurrent edits from both sides converge.
  await b.page.getByTestId('editor').click();
  await b.page.keyboard.press(process.platform === 'darwin' ? 'Meta+Home' : 'Control+Home');
  await Promise.all([a.page.keyboard.type('AAAA'), b.page.keyboard.type('BBBB')]);
  const converged = await until(async () => {
    const [ta, tb] = await Promise.all([a.text('main.tex'), b.text('main.tex')]);
    return ta === tb && ta.includes('AAAA') && ta.includes('BBBB');
  }, 'convergence');
  check(converged, 'simultaneous typing converges to the same text on both sides');
  await Promise.all([a.flush(), b.flush()]);
  check(read(dirA, 'main.tex') === read(dirB, 'main.tex'), 'both disks hold the same main.tex');

  check(await until(() => b.page.locator('.collab-caret').count().then((n) => n > 0), 'caret'), 'B sees A’s cursor');

  // Structural changes travel too.
  await a.app(() => window.__GITLATEX__.actions.workspace().writeFile('chapters/intro.tex', '\\section{Intro}\n'));
  check(await until(async () => (await b.text('chapters/intro.tex')) !== undefined, 'new file on B'), 'a new file in A appears in B');
  await b.app(() => window.__GITLATEX__.actions.workspace().delete('only-b.tex'));
  check(await until(async () => (await a.text('only-b.tex')) === undefined, 'delete on A'), 'a deletion in B removes the file in A');
  await a.flush();
  check(read(dirA, 'only-b.tex') === null, '… and from A’s disk');

  // Clicking a collaborator's avatar takes you to where they are.
  await a.app(() => window.__GITLATEX__.actions.openFile('chapters/intro.tex'));
  await b.app(() => window.__GITLATEX__.actions.openFile('main.tex'));
  await b.app(() => {
    const e = window.__GITLATEX__.editor.get();
    e.focus();
    e.setPosition({ lineNumber: 3, column: 2 });
  });
  check(await until(async () => (await a.state())?.peers.some((p) => p.name === 'Bob' && p.path === 'main.tex'), 'Bob in main.tex'), 'A sees which file Bob is in');
  await a.page.getByRole('button', { name: 'Go to Bob' }).click();
  const landed = await until(() =>
    a.app(() => {
      const s = window.__GITLATEX__.store.getState();
      const pos = window.__GITLATEX__.editor.get()?.getPosition();
      return s.activePath === 'main.tex' && pos?.lineNumber === 3 && pos?.column === 2;
    }),
  'jump to Bob');
  check(landed, 'clicking Bob’s avatar opens his file at his cursor');

  // Another project is not shared; going back reconnects.
  await a.app(() => window.__GITLATEX__.actions.openProject('other'));
  check((await a.state()) === null, 'another project opens unshared');
  await a.app(() => window.__GITLATEX__.actions.openProject('paper'));
  check(await until(async () => (await a.state())?.status === 'connected', 'reconnect'), 'reopening the shared project reconnects automatically');

  await showPanel(b);
  await b.page.getByRole('button', { name: 'Stop sharing this project' }).click();
  check((await b.state()) === null, 'B can stop sharing');
  check(await until(async () => !(await a.state())?.peers.length, 'Bob gone'), 'A sees Bob leave');
  await b.flush();
  check(!read(dirB, 'main.tex')?.includes('Stale copy on B.') && read(dirB, 'main.tex') === (await a.text('main.tex')), 'after stopping, B’s files keep the room’s text');

  // While Bob is away: he edits on his own, Ada edits in the room, and both change the same line.
  const setText = (p, fn) => p.app((src) => {
    const ws = window.__GITLATEX__.actions.workspace();
    ws.setText('main.tex', new Function('t', `return (${src})(t)`)(ws.getText('main.tex')));
  }, fn.toString());
  await b.app(() => window.__GITLATEX__.actions.openFile('main.tex'));
  await setText(b, (t) => t.replace('From A.', 'From A, Bob’s way.') + '% Bob, while away\n');
  // Ada is live with main.tex open, so she types in the editor (that is what reaches the room).
  await a.app(() => {
    const editor = window.__GITLATEX__.editor.get();
    const model = editor.getModel();
    const line = model.getLinesContent().findIndex((l) => l.includes('From A.')) + 1;
    model.pushEditOperations([], [
      { range: model.getFullModelRange().setEndPosition(1, 1), text: '% Ada, while Bob was away\n' },
      { range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: model.getLineMaxColumn(line) }, text: 'From A, the room’s way.' },
    ], () => null);
  });
  check(await until(async () => (await a.text('main.tex'))?.includes('% Ada, while Bob was away'), 'Ada edit'), 'A edits in the room while B is away');
  await a.flush();

  check(await join(b, invite), 'B rejoins');
  const merged = (t) => !!t && t.includes('% Bob, while away') && t.includes('% Ada, while Bob was away') && t.includes('From A, the room’s way.') && !t.includes('Bob’s way') && !t.includes('<<<<<<<');
  check(await until(async () => merged(await b.text('main.tex')), 'merge on B'), 'rejoining merges: both sides’ edits are kept, and the room wins the line both changed');
  check(await until(async () => merged(await a.text('main.tex')), 'merge on A'), '… and A gets Bob’s offline edit');
  if (!merged(await b.text('main.tex'))) console.log(`    B has:\n${await b.text('main.tex')}\n    A has:\n${await a.text('main.tex')}`);
  await Promise.all([a.flush(), b.flush()]);
  check(read(dirA, 'main.tex') === read(dirB, 'main.tex') && merged(read(dirB, 'main.tex')), '… on both disks');
} catch (err) {
  console.error(err);
  failures++;
} finally {
  await browser.close();
}

if (errors.length) {
  console.log('page errors:\n  ' + errors.join('\n  '));
  failures++;
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall collaboration checks passed');
process.exit(failures ? 1 : 0);
