/**
 * TexCompiler — a latexmk-style build orchestrator running inside the worker.
 *
 *  ┌ sync project files into the in-memory FS (only what changed)
 *  ├ predict required TeX Live collections + shelf bundles from the sources
 *  ├ loop:
 *  │   run TeX ─► missing file/font?  ─► fetch bundle, run again
 *  │           ─► BibTeX needed?      ─► bibtex8, run again
 *  │           ─► index changed?      ─► makeindex, run again
 *  │           ─► labels changed?     ─► run again (bounded by maxPasses)
 *  ├ XeTeX: xdvipdfmx  (.xdv → .pdf)
 *  └ collect PDF, SyncTeX, logs
 *
 * Auxiliary files (.aux, .toc, .bbl, …) are kept between compiles, so an
 * ordinary edit needs a single TeX pass — exactly like a local latexmk.
 */
import { BusyTexHost, PROJECT_ROOT, SHELF_ROOT } from './busytex-host';
import type { EngineDataPackage, EngineManifest } from './manifest';
import { findMissing } from './missing';
import { scanSources } from './scan';
import type { PackageShelf } from './shelf';
import type { CompileRequest, CompileResult, CompileStep, Progress, TexEngine } from './protocol';

export interface CompilerEvents {
  progress(p: Progress): void;
  stdout(line: string): void;
}

/** FNV-1a fingerprint of file contents, used to sync only changed files. */
function fingerprint(data: string | Uint8Array): string {
  let h = 0x811c9dc5;
  if (typeof data === 'string') {
    for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data.charCodeAt(i), 16777619);
  } else {
    for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i], 16777619);
  }
  return `${data.length}:${(h >>> 0).toString(36)}`;
}

const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export class TexCompiler {
  private synced = new Map<string, string>();
  /** Key describing the inputs of the last BibTeX run (citations + databases + style). */
  private lastBibtexKey: string | null = null;
  private lastMakeindexKey: string | null = null;

  constructor(
    public host: BusyTexHost,
    readonly manifest: EngineManifest,
    public shelf: PackageShelf | null,
    private readonly events: CompilerEvents,
  ) {}

  private progress(message: string, phase: Progress['phase'] = 'compile', loaded?: number, total?: number) {
    this.events.progress({ phase, message, loaded, total });
  }

  /** Forget all state (after the host was recreated). */
  reset(host: BusyTexHost) {
    this.host = host;
    this.synced.clear();
    this.lastBibtexKey = null;
    this.lastMakeindexKey = null;
    if (this.shelf) {
      this.shelf.mounted.clear();
      this.shelf.overlayMounted = false;
    }
  }

  // -------------------------------------------------------------------------

  private syncProject(req: CompileRequest) {
    const host = this.host;
    if (req.clean) {
      host.clearDir(PROJECT_ROOT);
      this.synced.clear();
      this.lastBibtexKey = null;
      this.lastMakeindexKey = null;
    }
    const seen = new Set<string>();
    for (const f of req.files) {
      const path = f.path.replace(/^\/+/, '');
      if (!path || path.includes('..')) continue;
      seen.add(path);
      const fp = fingerprint(f.data);
      if (this.synced.get(path) === fp && host.exists(`${PROJECT_ROOT}/${path}`)) continue;
      host.writeFile(`${PROJECT_ROOT}/${path}`, f.data);
      this.synced.set(path, fp);
    }
    // Remove files deleted from the project (generated files are never in `synced`).
    for (const path of [...this.synced.keys()]) {
      if (!seen.has(path)) {
        host.unlink(`${PROJECT_ROOT}/${path}`);
        this.synced.delete(path);
      }
    }
  }

  /** Which data packages (TeX Live collections) provide the given file names? */
  private collectionsFor(names: Iterable<string>): EngineDataPackage[] {
    const need = new Map<string, EngineDataPackage>();
    const all = this.manifest.packages;
    for (const name of names) {
      const providers = all.filter((p) => p.provides.includes(name));
      if (!providers.length) continue;
      if (providers.some((p) => this.host.loaded.has(p.id))) continue;
      // Prefer the smallest package that provides the file.
      const best = providers.sort((a, b) => a.bytes - b.bytes)[0];
      need.set(best.id, best);
    }
    return [...need.values()];
  }

  private async mountCollections(pkgs: EngineDataPackage[]): Promise<string[]> {
    const mounted: string[] = [];
    for (const pkg of pkgs) {
      if (this.host.loaded.has(pkg.id)) continue;
      this.progress(`Mounting ${pkg.label}…`, 'packages');
      await this.host.loadPackage(pkg);
      mounted.push(pkg.id);
    }
    if (mounted.length) this.host.writeLsR('/texmf/texmf-dist');
    return mounted;
  }

  private shelfWrite = (path: string, data: Uint8Array) => this.host.writeFile(`${SHELF_ROOT}/${path}`, data);

  private async mountBundles(ids: number[]): Promise<string[]> {
    if (!this.shelf || !ids.length) return [];
    const closure = this.shelf.closure(ids);
    if (!closure.length) return [];
    // Shelf packages may depend on engine collections (e.g. pgf → xcolor): mount those too.
    const hints = closure.flatMap((id) => this.shelf!.index.bundles[id].x ?? []);
    const collections = await this.mountCollections(this.collectionsFor(hints));
    const names = await this.shelf.mount(closure, this.shelfWrite, (done, total, name) =>
      this.progress(`Fetching package ${name} (${done}/${total})…`, 'shelf', done, total),
    );
    this.host.writeLsR(SHELF_ROOT);
    return [...collections, ...names];
  }

  /** Map missing file/font names to collections or shelf bundles. Returns what was mounted. */
  private async resolve(
    files: Iterable<string>,
    fonts: Iterable<string>,
    useShelf: boolean,
  ): Promise<{ mounted: string[]; unresolved: string[] }> {
    const names = [...files];
    const mounted = await this.mountCollections(this.collectionsFor(names));
    const inEngine = (n: string) => this.manifest.packages.some((p) => p.provides.includes(n));
    const unresolved: string[] = [];
    const ids = new Set<number>();
    const shelf = useShelf ? this.shelf : null;
    for (const n of names) {
      const id = shelf?.resolveFile(n);
      if (id !== undefined) {
        if (!shelf!.mounted.has(id)) ids.add(id);
      } else if (!inEngine(n)) unresolved.push(n);
    }
    for (const f of fonts) {
      const id = shelf?.resolveFont(f);
      if (id !== undefined) {
        if (!shelf!.mounted.has(id)) ids.add(id);
      } else unresolved.push(`font “${f}”`);
    }
    mounted.push(...(await this.mountBundles([...ids])));
    return { mounted, unresolved };
  }

  // -------------------------------------------------------------------------

  private texCommand(engine: TexEngine, main: string, req: CompileRequest): string[] {
    // -no-shell-escape is essential: with restricted shell escape enabled, XeTeX
    // tries to spawn a shell during start-up and blocks forever inside WebAssembly.
    const common = ['-no-shell-escape', '-interaction=nonstopmode', '-file-line-error'];
    if (req.synctex) common.unshift('-synctex=1');
    if (req.haltOnError) common.push('-halt-on-error');
    switch (engine) {
      case 'xetex':
        return ['xelatex', ...common, '-no-pdf', '-fmt', this.manifest.fmt.xetex, main];
      case 'luatex':
        return ['luahblatex', ...common, '--nosocket', '-fmt', this.manifest.fmt.luahbtex, main];
      default:
        return ['pdflatex', ...common, '-fmt', this.manifest.fmt.pdftex, main];
    }
  }

  async compile(req: CompileRequest): Promise<CompileResult> {
    const t0 = performance.now();
    const host = this.host;
    const steps: CompileStep[] = [];
    const transcript: string[] = [];
    const fetched: string[] = [];
    const notices: string[] = [];
    let unresolved: string[] = [];

    if (!this.manifest.engines.includes(req.engine)) {
      throw new Error(`${req.engine === 'luatex' ? 'LuaLaTeX' : req.engine} is not available in the ${this.manifest.name} engine build.`);
    }
    const mainPath = req.mainFile.replace(/^\/+/, '');
    const mainName = basename(mainPath);
    const job = mainName.replace(/\.[^.]+$/, '');
    const cwd = dirname(mainPath) ? `${PROJECT_ROOT}/${dirname(mainPath)}` : PROJECT_ROOT;
    const out = (ext: string) => `${cwd}/${job}.${ext}`;

    this.progress('Syncing project files…');
    this.syncProject(req);
    if (!host.exists(`${PROJECT_ROOT}/${mainPath}`)) {
      throw new Error(`Main file "${mainPath}" does not exist in the project`);
    }
    // Stale outputs must never be mistaken for fresh ones.
    for (const ext of ['pdf', 'xdv', 'synctex.gz', 'log']) host.unlink(out(ext));

    // Predict collections + bundles from the sources before the first pass.
    const texts = req.files.filter((f) => typeof f.data === 'string' && /\.(tex|sty|cls|ltx)$/i.test(f.path)).map((f) => f.data as string);
    const scan = scanSources(texts);
    // Files provided by the project itself are not dependencies.
    const projectNames = new Set(req.files.map((f) => basename(f.path)));
    const predicted = [...scan.files].filter((n) => !projectNames.has(n));
    if (this.shelf && req.useShelf && !this.shelf.overlayMounted) {
      this.progress('Loading font maps…', 'shelf');
      await this.shelf.mountOverlay(this.shelfWrite);
      this.host.writeLsR(SHELF_ROOT);
    }
    fetched.push(...(await this.resolve(predicted, scan.fonts, req.useShelf)).mounted);
    if (scan.biblatexBackend === 'biber' && !this.manifest.features.biber) {
      notices.push(
        'biblatex is set to use Biber, which cannot run in the browser. Use \\usepackage[backend=bibtex]{biblatex} to build the bibliography with BibTeX.',
      );
    }

    host.chdir(cwd);
    const texCmd = this.texCommand(req.engine, mainName, req);

    let lastRun = { exitCode: 0, stdout: '', stderr: '', ms: 0 };
    const run = (cmd: string[], label = cmd[0]): number => {
      this.progress(`Running ${label}…`);
      const r = (lastRun = host.run(cmd));
      steps.push({ tool: cmd[0], args: cmd.slice(1), exitCode: r.exitCode, ms: Math.round(r.ms) });
      const stderr = r.stderr.replace(/^program exited \(with status: \d+\), but EXIT_RUNTIME is not set.*$/gm, '').trim();
      transcript.push(`$ ${cmd.join(' ')}`, r.stdout, stderr, `[exit ${r.exitCode}, ${Math.round(r.ms)} ms]`, '');
      return r.exitCode;
    };

    let passes = 0;
    let resolveRounds = 0;
    let bibtexLog: string | null = null;
    let log = '';
    let lastExit = 0;
    const maxPasses = Math.max(1, Math.min(req.maxPasses, 8));

    // Files whose change between passes means another pass is needed (latexmk's rule).
    const trackedExts = ['aux', 'toc', 'lof', 'lot', 'out', 'nav', 'snm', 'loa', 'lol'];
    const tracked = () => trackedExts.map((e) => host.readText(out(e)) ?? '').join('\u0000');

    for (;;) {
      const auxBefore = host.readText(out('aux'));
      const trackedBefore = tracked();
      passes++;
      lastExit = run(texCmd, `${texCmd[0]} (pass ${passes})`);
      log = host.readText(out('log')) ?? lastRun.stdout;

      // 1. Missing packages / fonts → fetch and try again.
      if (resolveRounds < 10) {
        const missing = findMissing(`${log}\n${lastRun.stdout}\n${lastRun.stderr}`);
        if (missing.files.length || missing.fonts.length) {
          const { mounted, unresolved: u } = await this.resolve(missing.files, missing.fonts, req.useShelf);
          unresolved = u;
          if (mounted.length) {
            fetched.push(...mounted);
            resolveRounds++;
            passes--;
            host.unlink(out('aux')); // an aborted run leaves a truncated .aux
            if (auxBefore !== null) host.writeFile(out('aux'), auxBefore);
            continue;
          }
        }
      }

      const pdfMade = req.engine === 'xetex' ? host.exists(out('xdv')) : host.exists(out('pdf'));
      if (!pdfMade || (req.haltOnError && lastExit !== 0)) break;

      // 2. BibTeX
      const aux = host.readText(out('aux')) ?? '';
      if (req.bibtex !== 'never' && (req.bibtex === 'always' || /\\bibdata\{/.test(aux))) {
        const key = bibtexKey(aux, req);
        if (key !== this.lastBibtexKey || !host.exists(out('bbl'))) {
          let code = run(['bibtex8', '--8bit', '--huge', `${job}.aux`], 'BibTeX');
          bibtexLog = host.readText(out('blg'));
          // BibTeX style missing? Fetch it and run BibTeX again.
          const miss = findMissing(bibtexLog ?? '');
          if (miss.files.length) {
            const { mounted } = await this.resolve(miss.files, [], req.useShelf);
            if (mounted.length) {
              fetched.push(...mounted);
              code = run(['bibtex8', '--8bit', '--huge', `${job}.aux`], 'BibTeX');
              bibtexLog = host.readText(out('blg'));
            }
          }
          this.lastBibtexKey = key;
          if (code <= 1 && passes < maxPasses) continue; // exit 1 = warnings only
        }
      }

      // 3. makeindex
      if (req.makeindex && host.exists(out('idx'))) {
        const idx = host.readText(out('idx')) ?? '';
        const key = fingerprint(idx);
        if (idx.trim() && key !== this.lastMakeindexKey) {
          run(['makeindex', `${job}.idx`], 'makeindex');
          this.lastMakeindexKey = key;
          if (passes < maxPasses) continue;
        }
      }

      // 4. Cross-references / TOC settled?
      // latexmk's rule: rerun while the files TeX reads back keep changing. A
      // "Rerun" warning alone (e.g. a genuinely undefined \ref) doesn't loop.
      if (passes < maxPasses && tracked() !== trackedBefore) continue;
      break;
    }

    // XeTeX writes .xdv; convert it to PDF.
    if (req.engine === 'xetex' && host.exists(out('xdv'))) {
      const code = run(['xdvipdfmx', '-q', '-o', `${job}.pdf`, `${job}.xdv`], 'xdvipdfmx');
      if (code !== 0) {
        const missing = findMissing(`${lastRun.stdout}\n${lastRun.stderr}`);
        if (missing.files.length) {
          const { mounted } = await this.resolve(missing.files, [], req.useShelf);
          if (mounted.length) {
            fetched.push(...mounted);
            run(['xdvipdfmx', '-q', '-o', `${job}.pdf`, `${job}.xdv`], 'xdvipdfmx');
          }
        }
      }
    }

    const pdf = host.readBytes(out('pdf'));
    const hasErrors = /^(! |.+:\d+: )/m.test(log) || lastExit !== 0;
    const hasWarnings = /(LaTeX|Package|Class) [\w-]* ?Warning|Overfull|Underfull/.test(log);
    const status = !pdf ? 'failed' : hasErrors ? 'errors' : hasWarnings ? 'warnings' : 'success';

    return {
      id: req.id,
      status,
      pdf: pdf ? pdf.slice() : null,
      synctex: req.synctex ? (host.readBytes(out('synctex.gz'))?.slice() ?? null) : null,
      log,
      bibtexLog,
      transcript: transcript.join('\n'),
      aux: host.readText(out('aux')),
      steps,
      passes,
      fetched,
      unresolved: [...new Set(unresolved)],
      collections: [...host.loaded],
      notices,
      durationMs: Math.round(performance.now() - t0),
      jobName: job,
    };
  }
}

/** Everything that influences BibTeX output. */
function bibtexKey(aux: string, req: CompileRequest): string {
  const relevant = aux
    .split('\n')
    .filter((l) => /^\\(citation|bibdata|bibstyle)\{/.test(l))
    .join('\n');
  const dbs = /\\bibdata\{([^}]*)\}/.exec(aux)?.[1].split(',') ?? [];
  const bibFingerprints = req.files
    .filter((f) => f.path.endsWith('.bib') && dbs.some((d) => f.path.endsWith(d.endsWith('.bib') ? d : `${d}.bib`)))
    .map((f) => fingerprint(f.data))
    .join(',');
  return fingerprint(relevant) + '|' + bibFingerprints;
}

