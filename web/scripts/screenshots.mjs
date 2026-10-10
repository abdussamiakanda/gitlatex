#!/usr/bin/env node
// Takes the README screenshots against running gitlatex servers and a local
// collab relay, and saves them to docs/images/.
//
//   (in a clone of github.com/abdussamiakanda/gitlatex-collab)
//   echo ADMIN_TOKEN=shots-admin > .dev.vars && npx wrangler dev --port 8787
//   gitlatex --no-browser --port 5201 --repos /tmp/shots-a
//   gitlatex --no-browser --port 5202 --repos /tmp/shots-b
//   node scripts/screenshots.mjs http://127.0.0.1:5201 /tmp/shots-a http://127.0.0.1:5202 /tmp/shots-b localhost:8787 shots-admin
//
// Both repos folders should start empty: the script creates the demo projects.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [baseA, dirA, baseB, dirB, relay = 'localhost:8787', adminToken = 'shots-admin'] = process.argv.slice(2);
if (!dirB) {
  console.error('usage: node scripts/screenshots.mjs <url A> <repos A> <url B> <repos B> [relay host] [admin token]');
  process.exit(2);
}
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/images');
fs.mkdirSync(out, { recursive: true });

const PAPER = 'graph-diffusion-paper';
const VIEWPORT = { width: 1440, height: 900 };

const MAIN_TEX = String.raw`\documentclass[11pt,a4paper]{article}

\usepackage[margin=2.5cm]{geometry}
\usepackage{amsmath, amssymb, amsthm}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{caption}
\usepackage{xcolor}
\usepackage[numbers,sort&compress]{natbib}
\usepackage[colorlinks=true, allcolors=blue]{hyperref}
\usepackage{cleveref}

\newtheorem{theorem}{Theorem}
\newtheorem{lemma}[theorem]{Lemma}

\title{Sparse Spectral Methods for Fast Heat Diffusion on Graphs}
\author{Ada Rahman\thanks{Department of Physics, University of Dhaka.}
  \and Bob Hossain}
\date{}

\begin{document}
\maketitle

\begin{abstract}
Heat diffusion on graphs underlies clustering, ranking and graph neural
networks, but exact solutions scale poorly. We show that a sparse
Chebyshev expansion of the heat kernel reaches the accuracy of dense
eigendecomposition at a fraction of the cost.
\end{abstract}

\section{Introduction}\label{sec:intro}
Given a graph Laplacian $L$, the heat kernel $e^{-tL}$ describes how
information spreads in time $t$. Classic treatments follow
\citet{knuth1984} and \citet{lamport1994}.

\section{Method}\label{sec:method}
We approximate the kernel with a truncated Chebyshev series,
\begin{equation}\label{eq:cheb}
  e^{-tL} \approx \sum_{k=0}^{K} c_k(t)\, T_k\!\left(\tfrac{2}{\lambda_{\max}} L - I\right),
\end{equation}
where $T_k$ are Chebyshev polynomials and $c_k(t)$ are Bessel coefficients.

\begin{theorem}\label{thm:error}
For every $K \ge 1$, the error of \cref{eq:cheb} is bounded by
$\|e^{-tL} - p_K(L)\| \le 2\,\frac{(t\lambda_{\max}/2)^{K+1}}{(K+1)!}$.
\end{theorem}

\begin{proof}
Follows from the Bessel series of $e^{-x}$ on $[-1,1]$.
\end{proof}

\section{Results}\label{sec:results}
\Cref{fig:results} and \cref{tab:results} compare our method with
dense and Krylov baselines.

\begin{figure}[h]
  \centering
  \includegraphics[width=0.42\linewidth]{figures/results.png}
  \caption{Accuracy against runtime.}\label{fig:results}
\end{figure}

\begin{table}[t]
  \centering
  \caption{Runtime on $10^6$-node graphs.}\label{tab:results}
  \begin{tabular}{lrr}
    \toprule
    Method & Error & Time (s) \\
    \midrule
    Dense eigendecomposition & $10^{-12}$ & 4120 \\
    Krylov & $10^{-8}$ & 63 \\
    \textbf{Sparse Chebyshev (ours)} & $\mathbf{10^{-9}}$ & $\mathbf{11}$ \\
    \bottomrule
  \end{tabular}
\end{table}

\section{Conclusion}
Sparse spectral methods make heat diffusion practical at scale.

\bibliographystyle{plainnat}
\bibliography{references}

\end{document}
`;

const browser = await chromium.launch();
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) }).then(() => console.log(`  saved ${name}.png`));
const until = async (fn, what, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out waiting for: ${what}`);
};

async function person(base, name, theme = 'dark') {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  await page.addInitScript((theme) => {
    localStorage.setItem('gitlatex.settings', JSON.stringify({ compiler: 'browser', theme, beginnerMode: false, spellCheck: false, autoCompile: false }));
  }, theme);
  await page.goto(base);
  await page.waitForFunction(() => window.__GITLATEX__ && !window.__GITLATEX__.store.getState().booting);
  const app = (fn, arg) => page.evaluate(fn, arg);
  return { page, app, name };
}

const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
const clearToasts = (p) => p.app(() => window.__GITLATEX__.store.setState({ toasts: [] }));

async function compiled(p) {
  await p.app(() => window.__GITLATEX__.actions.compile());
  await p.page.waitForFunction(
    () => {
      const c = window.__GITLATEX__.store.getState().compile;
      return (c.pdfFromCurrentRun && c.status !== 'running') || ['failed', 'crashed'].includes(c.status);
    },
    null,
    { timeout: 300000, polling: 500 },
  );
  const status = await p.app(() => window.__GITLATEX__.store.getState().compile.status);
  console.log(`  compile: ${status}`);
  await p.page.waitForTimeout(2500); // let pdf.js paint
  await clearToasts(p);
}

try {
  // --- Ada's workspace: a few projects for the home page, one real paper ---
  const a = await person(baseA, 'Ada');
  for (const [name, template] of [
    ['phd-thesis', 'thesis'],
    ['group-meeting-slides', 'beamer'],
    ['quantum-homework-3', 'homework'],
    ['curriculum-vitae', 'cv'],
    [PAPER, 'paper'],
  ]) {
    await a.app(([n, t]) => window.__GITLATEX__.actions.createProject(n, t, true), [name, template]);
    await a.app(() => window.__GITLATEX__.actions.workspace().flush());
  }
  const paperA = path.join(dirA, PAPER);
  fs.writeFileSync(path.join(paperA, 'main.tex'), MAIN_TEX);
  git(paperA, 'config', 'user.name', 'Ada Rahman');
  git(paperA, 'config', 'user.email', 'ada@example.org');
  git(paperA, 'add', '-A');
  git(paperA, 'commit', '-qm', 'Draft the method and results');

  // Home page.
  await a.app(() => window.__GITLATEX__.actions.closeProject?.());
  await a.page.goto(baseA);
  await a.page.getByRole('heading', { name: 'Projects' }).waitFor();
  await a.page.waitForTimeout(800);
  await shot(a.page, 'home');

  // Editor + PDF, dark.
  await a.app((n) => window.__GITLATEX__.actions.openProject(n), PAPER);
  await a.page.waitForFunction((n) => window.__GITLATEX__.store.getState().project?.id === n, PAPER);
  await a.app(() => window.__GITLATEX__.actions.openFile('main.tex'));
  await compiled(a);
  await shot(a.page, 'editor-dark');

  // Same view, light.
  await a.app(() => window.__GITLATEX__.actions.setTheme('light'));
  await a.page.waitForTimeout(1200);
  await shot(a.page, 'editor-light');
  await a.app(() => window.__GITLATEX__.actions.setTheme('dark'));

  // Source control: an uncommitted edit, with its diff open.
  await a.app(() => {
    const ws = window.__GITLATEX__.actions.workspace();
    const t = ws.getText('main.tex');
    ws.writeFile(
      'main.tex',
      t
        .replace('reaches the accuracy of dense\neigendecomposition at a fraction of the cost.', 'matches dense eigendecomposition to $10^{-9}$\nwhile running over $300\\times$ faster.')
        .replace('make heat diffusion practical at scale.', 'make heat diffusion practical on graphs\nwith millions of nodes.'),
    );
  });
  await a.app(() => window.__GITLATEX__.actions.workspace().flush());
  await a.app(() => window.__GITLATEX__.actions.refreshScm());
  await a.app(() => window.__GITLATEX__.store.setState({ sidebar: 'git' }));
  await a.page.waitForTimeout(1000);
  const changed = a.page.getByText('main.tex', { exact: true }).first();
  await changed.click().catch(() => undefined);
  await a.page.waitForTimeout(1500);
  await clearToasts(a);
  await shot(a.page, 'source-control');
  await a.page.keyboard.press('Escape');
  await a.app((t) => window.__GITLATEX__.actions.workspace().writeFile('main.tex', t), MAIN_TEX);
  await a.app(() => window.__GITLATEX__.actions.workspace().flush());

  // --- Live collaboration: Bob joins Ada's room from his own machine ---
  const paperB = path.join(dirB, PAPER);
  fs.rmSync(paperB, { recursive: true, force: true });
  git(dirB, 'clone', '-q', paperA, PAPER);
  git(paperB, 'config', 'user.name', 'Bob Hossain');
  git(paperB, 'config', 'user.email', 'bob@example.org');

  // A room left over from an earlier run would win over Ada's copy on join.
  await fetch(`http://${relay}/admin/rooms/${PAPER}`, { method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` } });

  await a.page.reload();
  await a.page.waitForFunction(() => window.__GITLATEX__ && !window.__GITLATEX__.store.getState().booting);
  await a.app((n) => window.__GITLATEX__.store.getState().project?.id === n || window.__GITLATEX__.actions.openProject(n), PAPER);
  await a.page.waitForFunction((n) => window.__GITLATEX__.store.getState().project?.id === n, PAPER);
  await a.app(() => window.__GITLATEX__.store.setState({ sidebar: 'collab' }));
  await a.page.getByRole('tab', { name: 'Host' }).click();
  await a.page.getByLabel('Relay address').fill(relay);
  await a.page.getByLabel('Admin token').fill(adminToken);
  await a.page.getByRole('button', { name: 'Connect' }).click();
  await a.page.getByRole('button', { name: 'Create room & go live' }).click();
  await until(() => a.app(() => window.__GITLATEX__.store.getState().collab?.status === 'connected'), 'Ada live');
  const invite = await a.page.locator('code[title^="gitlatex-invite:"]').getAttribute('title');

  const b = await person(baseB, 'Bob');
  await b.app((n) => window.__GITLATEX__.actions.openProject(n), PAPER);
  await b.page.waitForFunction((n) => window.__GITLATEX__.store.getState().project?.id === n, PAPER);
  await b.app(() => window.__GITLATEX__.store.setState({ sidebar: 'collab' }));
  await b.page.getByPlaceholder('Paste the invite').fill(invite);
  await b.page.getByRole('button', { name: 'Join', exact: true }).click();
  await until(() => b.app(() => window.__GITLATEX__.store.getState().collab?.status === 'connected'), 'Bob live');
  await until(() => a.app(() => window.__GITLATEX__.store.getState().collab?.peers.length > 0), 'Ada sees Bob');

  // Bob edits the abstract while Ada works on the results section.
  await a.app(() => window.__GITLATEX__.actions.openFile('main.tex'));
  await b.app(() => window.__GITLATEX__.actions.openFile('main.tex'));
  await b.app(() => {
    const e = window.__GITLATEX__.editor.get();
    const m = e.getModel();
    const line = m.getLinesContent().findIndex((l) => l.startsWith('networks, but exact')) + 1;
    e.focus();
    e.setPosition({ lineNumber: line, column: m.getLineMaxColumn(line) });
  });
  await b.page.keyboard.type(' On real road networks this matters most.', { delay: 15 });
  await a.app(() => {
    const e = window.__GITLATEX__.editor.get();
    const m = e.getModel();
    const line = m.getLinesContent().findIndex((l) => l.startsWith('Given a graph Laplacian')) + 1;
    e.focus();
    e.setSelection({ startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: m.getLineMaxColumn(line) });
    e.revealLineInCenterIfOutsideViewport(line);
  });
  await until(() => a.page.locator('.collab-caret').count().then((n) => n > 0), 'Bob’s caret on Ada’s screen');
  await a.page.waitForTimeout(2500); // the PDF from the last compile reloads after the page reload
  await clearToasts(a);
  await shot(a.page, 'live-collaboration');

  await b.app(() => window.__GITLATEX__.actions.leaveCollab(true));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
