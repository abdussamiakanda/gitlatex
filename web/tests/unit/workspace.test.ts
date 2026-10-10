import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workspace, guessMainFile, looksBinary } from '../../src/state/workspace';

/**
 * A stand-in for the gitlatex server's project API (gitlatex/routes/workspace.py):
 * one project folder, kept as path → content, plus the folders that exist.
 */
function fakeServer() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const log: string[] = [];
  const parents = (p: string) => {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  };
  const under = (p: string, root: string) => p === root || p.startsWith(root + '/');
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  const handler = async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const route = url.split('?')[0];
    log.push(route);
    switch (route) {
      case '/api/project/create': {
        for (const f of body.files as { path: string; text?: string; base64?: string }[]) {
          files.set(f.path, f.text ?? `b64:${f.base64}`);
          parents(f.path);
        }
        return json({ success: true, name: String(body.name).replace(/\s+/g, '-') });
      }
      case '/api/project/open':
        return json({
          name: body.name,
          hasGit: true,
          files: [...files].map(([path, v]) => (v.startsWith('b64:') ? { path, base64: v.slice(4) } : { path, text: v })),
          folders: [...dirs].sort(),
        });
      case '/api/fs/write':
        files.set(String(body.path), (body.text as string) ?? `b64:${String(body.base64)}`);
        parents(String(body.path));
        return json({ success: true });
      case '/api/fs/mkdir':
        dirs.add(String(body.path));
        parents(String(body.path));
        return json({ success: true });
      case '/api/fs/delete':
        for (const p of [...files.keys()]) if (under(p, String(body.path))) files.delete(p);
        for (const d of [...dirs]) if (under(d, String(body.path))) dirs.delete(d);
        return json({ success: true });
      case '/api/fs/move': {
        const [from, to] = [String(body.from), String(body.to)];
        if (![...files.keys(), ...dirs].some((p) => under(p, from))) return json({ error: 'Source not found' }, 404);
        for (const [p, v] of [...files]) if (under(p, from)) (files.delete(p), files.set(to + p.slice(from.length), v));
        for (const d of [...dirs]) if (under(d, from)) (dirs.delete(d), dirs.add(to + d.slice(from.length)));
        parents(to);
        return json({ success: true });
      }
    }
    return json({ error: `no route ${route}` }, 404);
  };
  return { files, dirs, log, handler };
}

describe('Workspace', () => {
  let server: ReturnType<typeof fakeServer>;
  const errors: unknown[] = [];

  beforeEach(() => {
    server = fakeServer();
    errors.length = 0;
    Workspace.onError = (err) => errors.push(err);
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => server.handler(url, init)));
  });
  afterEach(() => vi.unstubAllGlobals());

  /** Make the next /api/project/open read the folder now but answer only when released. */
  const holdOpen = () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const res = await server.handler(url, init);
        if (url === '/api/project/open') await held;
        return res;
      }),
    );
    return release;
  };

  it('refresh() keeps what was typed, created or deleted while it read the disk', async () => {
    const id = await Workspace.create('p', 'blank', [
      { path: 'main.tex', text: 'a\nb\nc\nd\ne\n' },
      { path: 'gone.tex', text: 'g' },
    ]);
    const ws = await Workspace.open(id);
    // A pull changes the folder: line e, and a new file.
    server.files.set('main.tex', 'a\nb\nc\nd\nE (pulled)\n');
    server.files.set('pulled.tex', 'p');

    const release = holdOpen();
    const refreshing = ws.refresh();
    await Promise.resolve();
    // Meanwhile the user types, adds a file and deletes one.
    ws.setText('main.tex', 'A (typed)\nb\nc\nd\ne\n');
    ws.writeFile('new.tex', 'n');
    ws.delete('gone.tex');
    release();
    await refreshing;

    expect(ws.getText('main.tex')).toBe('A (typed)\nb\nc\nd\nE (pulled)\n');
    expect(ws.getText('new.tex')).toBe('n');
    expect(ws.get('gone.tex')).toBeUndefined();
    expect(ws.getText('pulled.tex')).toBe('p');
    await ws.flush();
    expect(errors).toEqual([]);
    expect(server.files.get('main.tex')).toBe('A (typed)\nb\nc\nd\nE (pulled)\n');
    expect(server.files.get('new.tex')).toBe('n');
    expect(server.files.has('gone.tex')).toBe(false);
  });

  it('refresh() lets your typing win where the disk changed the same line meanwhile', async () => {
    const id = await Workspace.create('q', 'blank', [{ path: 'main.tex', text: 'a\nb\nc\n' }]);
    const ws = await Workspace.open(id);
    server.files.set('main.tex', 'a\nB (disk)\nc\n');
    const release = holdOpen();
    const refreshing = ws.refresh();
    await Promise.resolve();
    ws.setText('main.tex', 'a\nB (typed)\nc\n');
    release();
    await refreshing;
    expect(ws.getText('main.tex')).toBe('a\nB (typed)\nc\n');
    await ws.flush();
    expect(server.files.get('main.tex')).toBe('a\nB (typed)\nc\n');
  });

  it('refresh() takes the disk for files nobody touched meanwhile', async () => {
    const id = await Workspace.create('r', 'blank', [
      { path: 'main.tex', text: 'a\n' },
      { path: 'old.tex', text: 'o' },
    ]);
    const ws = await Workspace.open(id);
    server.files.set('main.tex', 'a (pulled)\n');
    server.files.delete('old.tex');
    expect((await ws.refresh()).sort()).toEqual(['main.tex', 'old.tex']);
    expect(ws.getText('main.tex')).toBe('a (pulled)\n');
    expect(ws.get('old.tex')).toBeUndefined();
    expect(ws.hasPendingWrites).toBe(false);
  });

  it('creates, edits, renames and deletes, and the folder on disk follows', async () => {
    const id = await Workspace.create('Test paper', 'blank', [
      { path: 'main.tex', text: '\\documentclass{article}\\begin{document}Hi\\end{document}' },
      { path: 'img/logo.png', data: new Uint8Array([137, 80, 0]) },
    ]);
    expect(id).toBe('Test-paper');
    const ws = await Workspace.open(id);
    expect(ws.project.mainFile).toBe('main.tex');
    expect(ws.paths()).toEqual(['img/logo.png', 'main.tex']);
    expect(ws.get('img/logo.png')?.data).toEqual(new Uint8Array([137, 80, 0]));

    ws.setText('main.tex', 'changed');
    ws.writeFile('chapters/one.tex', 'one');
    ws.createFolder('empty');
    expect(ws.folders()).toEqual(['chapters', 'empty', 'img']);
    // chapters/one.tex has not been written yet: the rename must write it first.
    expect(ws.rename('chapters', 'parts')).toEqual([['chapters/one.tex', 'parts/one.tex']]);
    expect(ws.delete('img')).toEqual(['img/logo.png']);
    ws.rename('main.tex', 'root.tex');
    expect(ws.project.mainFile).toBe('root.tex');
    await ws.flush();

    expect(errors).toEqual([]);
    expect([...server.files.keys()].sort()).toEqual(['parts/one.tex', 'root.tex']);
    expect(server.files.get('root.tex')).toBe('changed');

    const again = await Workspace.open(id);
    expect(again.paths()).toEqual(['parts/one.tex', 'root.tex']);
    expect(again.folders()).toEqual(['empty', 'parts']);
    expect(again.project.mainFile).toBe('root.tex');
  });

  it('keeps build output out of compiles and records server-written files without writing them back', async () => {
    const id = await Workspace.create('p', 'blank', [
      { path: 'main.tex', text: '\\documentclass{article}' },
      { path: 'main.aux', text: '\\relax' },
      { path: 'main.log', text: 'This is pdfTeX' },
      { path: 'refs.bib', text: '@misc{a}' },
    ]);
    const ws = await Workspace.open(id);
    ws.putClean('main.pdf', new Uint8Array([37, 80, 68, 70]));
    await ws.flush();
    expect(server.log).not.toContain('/api/fs/write');
    expect(ws.paths()).toContain('main.pdf');
    expect(ws.compileFiles().map((f) => f.path).sort()).toEqual(['main.tex', 'refs.bib']);
  });

  it('reports failed disk operations', async () => {
    const ws = await Workspace.open((await Workspace.create('p', 'blank', [{ path: 'main.tex', text: 'x' }])));
    server.files.delete('main.tex'); // changed behind the editor's back
    ws.rename('main.tex', 'other.tex');
    await ws.flush();
    expect(errors).toHaveLength(1);
  });

  it('guesses the main file and sniffs binaries', () => {
    expect(guessMainFile([{ path: 'ch/a.tex', text: 'x' }, { path: 'paper.tex', text: '\\documentclass{x}' }])).toBe('paper.tex');
    expect(looksBinary(new Uint8Array([1, 2, 0]))).toBe(true);
    expect(looksBinary(new TextEncoder().encode('plain'))).toBe(false);
  });
});
