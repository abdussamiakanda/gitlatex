/**
 * Interactive helpers opened from the slash menu: table grid, matrix builder,
 * image picker, citation picker (with DOI import), reference picker, symbols.
 */
import { useEffect, useMemo, useState } from 'react';
import { Table2, Braces, ImagePlus, BookMarked, Hash, Upload, Search, Sigma, Plus } from 'lucide-react';
import { closeDialog, toast, useStore } from '../state/store';
import { addFiles, ensurePackage, includePathFor, workspace } from '../state/actions';
import { editorBridge } from '../editor/bridge';
import { mathAt } from '../editor/providers';
import { MathPreview } from '../editor/SlashMenu';
import { tableSnippet, matrixSnippet, matrixPreview, SYMBOL_GROUPS, type MatrixKind, type MatrixFill, type Wizard } from '../editor/slash-commands';
import { parseBib, formatEntry, bibtexFromDoi } from '../latex/bib';
import { labels, loadedPackages } from '../latex/analysis';
import { pickFiles, readFileList } from '../storage/local-disk';
import { basename, isImagePath, stripExt, extname } from '../utils/paths';
import { Button, Modal, TextInput, Toggle, clsx } from './ui';

export function WizardDialog({ wizard }: { wizard: Wizard }) {
  switch (wizard) {
    case 'table':
      return <TableWizard />;
    case 'matrix':
      return <MatrixWizard />;
    case 'image':
      return <ImageWizard />;
    case 'cite':
      return <CiteWizard />;
    case 'ref':
      return <RefWizard />;
    case 'symbols':
      return <SymbolWizard />;
  }
}

function insertAndClose(snippet: string) {
  closeDialog();
  // Let the modal unmount and focus return to the editor first.
  setTimeout(() => editorBridge.insertSnippet(snippet), 20);
}

// ---------------------------------------------------------------------------

function TableWizard() {
  const [hover, setHover] = useState({ r: 3, c: 3 });
  const [size, setSize] = useState({ r: 3, c: 3 });
  const [header, setHeader] = useState(true);
  const [booktabs, setBooktabs] = useState(true);
  const [caption, setCaption] = useState(true);
  const [align, setAlign] = useState<'l' | 'c' | 'r'>('c');
  const R = 10;
  const C = 8;
  const insert = () => insertAndClose(tableSnippet({ rows: size.r, cols: size.c, header, booktabs, caption, align }));
  return (
    <Modal title="Insert table" icon={<Table2 className="size-4 text-accent" />} onClose={closeDialog} width="max-w-xl" footer={<><Button variant="ghost" onClick={closeDialog}>Cancel</Button><Button variant="primary" onClick={insert}>Insert {size.r} × {size.c} table</Button></>}>
      <div className="flex flex-col gap-5 sm:flex-row">
        <div>
          <div className="mb-2 text-xs text-muted">Pick the size (rows × columns)</div>
          <div className="inline-grid gap-1" style={{ gridTemplateColumns: `repeat(${C}, 1.4rem)` }} onMouseLeave={() => setHover(size)}>
            {Array.from({ length: R * C }, (_, i) => {
              const r = Math.floor(i / C) + 1;
              const c = (i % C) + 1;
              const on = r <= hover.r && c <= hover.c;
              return (
                <button
                  key={i}
                  aria-label={`${r} by ${c}`}
                  onMouseEnter={() => setHover({ r, c })}
                  onClick={() => setSize({ r, c })}
                  onDoubleClick={() => {
                    setSize({ r, c });
                    insertAndClose(tableSnippet({ rows: r, cols: c, header, booktabs, caption, align }));
                  }}
                  className={clsx('size-[1.4rem] rounded-[4px] border transition-colors', on ? 'border-accent bg-accent/30' : 'border-line bg-panel-2', r === size.r && c === size.c && 'ring-2 ring-accent')}
                />
              );
            })}
          </div>
          <div className="mt-2 text-center text-sm font-medium text-fg">{hover.r} × {hover.c}</div>
        </div>
        <div className="flex-1">
          <Toggle label="Header row" checked={header} onChange={setHeader} />
          <Toggle label="Professional rules (booktabs)" description="\toprule, \midrule, \bottomrule instead of \hline" checked={booktabs} onChange={setBooktabs} />
          <Toggle label="Caption & label" description="Makes it a numbered, referenceable float" checked={caption} onChange={setCaption} />
          <div className="py-2">
            <div className="mb-1 text-[13px] text-fg">Column alignment</div>
            <div className="flex gap-1">
              {(['l', 'c', 'r'] as const).map((a) => (
                <button key={a} onClick={() => setAlign(a)} className={clsx('rounded-md border px-3 py-1 text-xs', align === a ? 'border-accent bg-accent/15 text-fg' : 'border-line text-muted')}>
                  {a === 'l' ? 'Left' : a === 'c' ? 'Center' : 'Right'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

const MATRIX_KINDS: { kind: MatrixKind; label: string }[] = [
  { kind: 'pmatrix', label: '( )' },
  { kind: 'bmatrix', label: '[ ]' },
  { kind: 'Bmatrix', label: '{ }' },
  { kind: 'vmatrix', label: '| |' },
  { kind: 'Vmatrix', label: '‖ ‖' },
  { kind: 'matrix', label: 'none' },
];

function MatrixWizard() {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [kind, setKind] = useState<MatrixKind>('pmatrix');
  const [fill, setFill] = useState<MatrixFill>('placeholders');
  const [display, setDisplay] = useState(() => {
    const e = editorBridge.get();
    const m = e?.getModel();
    const p = e?.getPosition();
    return !(m && p && mathAt(m, p));
  });
  const stepper = (label: string, v: number, set: (n: number) => void) => (
    <label className="flex items-center justify-between gap-3 text-[13px] text-fg">
      {label}
      <span className="flex items-center gap-1">
        <Button size="sm" onClick={() => set(Math.max(1, v - 1))}>−</Button>
        <span className="w-6 text-center tabular-nums">{v}</span>
        <Button size="sm" onClick={() => set(Math.min(10, v + 1))}>+</Button>
      </span>
    </label>
  );
  return (
    <Modal
      title="Insert matrix"
      icon={<Braces className="size-4 text-accent" />}
      onClose={closeDialog}
      width="max-w-xl"
      footer={<><Button variant="ghost" onClick={closeDialog}>Cancel</Button><Button variant="primary" onClick={() => insertAndClose(matrixSnippet(rows, cols, kind, fill, display))}>Insert matrix</Button></>}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-3">
          {stepper('Rows', rows, setRows)}
          {stepper('Columns', cols, setCols)}
          <div>
            <div className="mb-1 text-[13px] text-fg">Brackets</div>
            <div className="grid grid-cols-3 gap-1">
              {MATRIX_KINDS.map((k) => (
                <button key={k.kind} onClick={() => setKind(k.kind)} className={clsx('rounded-md border py-1 font-mono text-xs', kind === k.kind ? 'border-accent bg-accent/15 text-fg' : 'border-line text-muted')}>
                  {k.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-[13px] text-fg">Fill with</div>
            <select value={fill} onChange={(e) => setFill(e.target.value as MatrixFill)} className="focus-ring h-8 w-full rounded-md border border-line bg-panel-2 px-2 text-[13px] text-fg">
              <option value="placeholders">Editable placeholders (Tab to jump)</option>
              <option value="symbolic">Symbols a₁₁ … aₙₙ</option>
              <option value="identity">Identity matrix</option>
              <option value="zeros">Zeros</option>
            </select>
          </div>
          <Toggle label="Display on its own line" description="Wrap in \[ … \]" checked={display} onChange={setDisplay} />
        </div>
        <div className="flex items-center justify-center rounded-xl border border-line bg-panel-2 p-4">
          <MathPreview tex={matrixPreview(rows, cols, kind, fill)} />
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function ImageWizard() {
  const treeVersion = useStore((s) => s.treeVersion);
  const images = useMemo(() => (workspace()?.paths() ?? []).filter((p) => isImagePath(p) && !['svg', 'eps', 'bmp', 'webp', 'gif'].includes(extname(p))), [treeVersion]);
  const [picked, setPicked] = useState<string | null>(images[0] ?? null);
  const [width, setWidth] = useState(80);
  const [caption, setCaption] = useState('');
  const [float, setFloat] = useState(true);
  const upload = async () => {
    const files = await pickFiles({ accept: 'image/png,image/jpeg,application/pdf', multiple: true });
    if (!files.length) return;
    const added = addFiles(await readFileList(files, 'images'));
    if (added[0]) setPicked(added[0]);
  };
  const insert = () => {
    if (!picked) return;
    const path = includePathFor(picked);
    const w = width === 100 ? '\\linewidth' : `${(width / 100).toFixed(2)}\\linewidth`;
    const label = stripExt(basename(picked)).replace(/[^A-Za-z0-9]+/g, '-');
    const snippet = float
      ? `\\begin{figure}[htbp]\n\t\\centering\n\t\\includegraphics[width=${w}]{${path}}\n\t\\caption{\${1:${caption || 'Caption'}}}\n\t\\label{fig:\${2:${label}}}\n\\end{figure}\n$0`
      : `\\includegraphics[width=${w}]{${path}}$0`;
    ensurePackage('graphicx');
    insertAndClose(snippet);
  };
  return (
    <Modal
      title="Insert image"
      icon={<ImagePlus className="size-4 text-accent" />}
      onClose={closeDialog}
      width="max-w-2xl"
      footer={<><Button variant="ghost" onClick={closeDialog}>Cancel</Button><Button variant="primary" disabled={!picked} onClick={insert}>Insert image</Button></>}
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
        <div>
          <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto">
            <button onClick={upload} className="flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-line text-xs text-muted hover:border-accent hover:text-accent">
              <Upload className="size-5" /> Upload image
            </button>
            {images.map((p) => (
              <Thumb key={p} path={p} selected={p === picked} onClick={() => setPicked(p)} onDoubleClick={() => { setPicked(p); setTimeout(insert, 0); }} />
            ))}
          </div>
          {!images.length && <p className="mt-2 text-xs text-muted">No images in the project yet — upload PNG, JPG or PDF figures. They are stored in your browser and read by LaTeX from the virtual file system.</p>}
        </div>
        <div className="space-y-3">
          <label className="block text-[13px] text-fg">
            Width: {width}% of the text width
            <input type="range" min={10} max={100} step={5} value={width} onChange={(e) => setWidth(Number(e.target.value))} className="mt-1 w-full accent-[var(--c-accent)]" />
          </label>
          <Toggle label="As a figure" description="Numbered, with caption and label" checked={float} onChange={setFloat} />
          {float && <TextInput placeholder="Caption" value={caption} onChange={(e) => setCaption(e.target.value)} />}
          {picked && <code className="block break-all rounded bg-panel-2 p-2 text-[11px] text-muted">{includePathFor(picked)}</code>}
        </div>
      </div>
    </Modal>
  );
}

function Thumb({ path, selected, onClick, onDoubleClick }: { path: string; selected: boolean; onClick: () => void; onDoubleClick: () => void }) {
  const data = workspace()?.get(path)?.data;
  const url = useMemo(() => (data && extname(path) !== 'pdf' ? URL.createObjectURL(new Blob([data as BlobPart], { type: `image/${extname(path).replace('jpg', 'jpeg')}` })) : null), [data, path]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return (
    <button onClick={onClick} onDoubleClick={onDoubleClick} title={path} className={clsx('flex aspect-[4/3] flex-col overflow-hidden rounded-lg border bg-panel-2', selected ? 'border-accent ring-2 ring-accent/40' : 'border-line hover:border-muted')}>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-white/90">
        {url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-xs font-semibold text-danger">PDF</span>}
      </div>
      <div className="truncate px-1.5 py-1 text-left text-[10.5px] text-muted">{basename(path)}</div>
    </button>
  );
}

// ---------------------------------------------------------------------------

function CiteWizard() {
  const treeVersion = useStore((s) => s.treeVersion);
  const contentVersion = useStore((s) => s.contentVersion);
  const entries = useMemo(() => (workspace()?.textFiles('.bib') ?? []).flatMap((f) => parseBib(f.text, f.path)), [treeVersion, contentVersion]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [doi, setDoi] = useState('');
  const [busy, setBusy] = useState(false);
  const main = workspace()?.getText(workspace()?.project.mainFile ?? '') ?? '';
  const pkgs = loadedPackages(main);
  const commands = pkgs.has('biblatex') ? ['autocite', 'parencite', 'textcite', 'cite'] : pkgs.has('natbib') ? ['citep', 'citet', 'cite'] : ['cite'];
  const [cmd, setCmd] = useState(commands[0]);
  const shown = entries.filter((e) => `${e.key} ${e.fields.title ?? ''} ${e.fields.author ?? ''} ${e.fields.year ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  const importDoi = async () => {
    setBusy(true);
    try {
      const record = await bibtexFromDoi(doi);
      const ws = workspace()!;
      const bibs = ws.paths().filter((p) => p.endsWith('.bib'));
      const target = bibs[0] ?? 'references.bib';
      ws.writeFile(target, (ws.getText(target) ?? '') + (ws.getText(target) ? '\n' : '') + record);
      const key = /@\w+\s*\{\s*([^,\s]+)/.exec(record)?.[1];
      if (key) setSel((s) => [...s, key]);
      setDoi('');
      if (!/\\(bibliography|addbibresource)\b/.test(main)) {
        toast({ kind: 'warning', title: 'No bibliography yet', message: `Added to ${target}. Insert /bibliography at the end of your document to print it.` });
      } else toast({ kind: 'success', title: 'Reference imported', message: `${key} → ${target}` });
    } catch (err) {
      toast({ kind: 'error', title: 'DOI import failed', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Insert citation"
      icon={<BookMarked className="size-4 text-accent" />}
      onClose={closeDialog}
      width="max-w-2xl"
      footer={
        <>
          <select value={cmd} onChange={(e) => setCmd(e.target.value)} className="focus-ring mr-auto h-8 rounded-md border border-line bg-panel-2 px-2 text-[13px] text-fg">
            {commands.map((c) => <option key={c} value={c}>\{c}</option>)}
          </select>
          <Button variant="ghost" onClick={closeDialog}>Cancel</Button>
          <Button variant="primary" disabled={!sel.length} onClick={() => insertAndClose(`\\${cmd}{${sel.join(',')}}$0`)}>Cite {sel.length || ''}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Search className="size-4 text-faint" />
          <TextInput autoFocus placeholder="Search by key, title, author, year…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
          {!shown.length ? (
            <div className="p-4 text-center text-xs text-muted">{entries.length ? 'No matches.' : 'No .bib entries in this project yet — import one by DOI below.'}</div>
          ) : (
            shown.map((e) => {
              const on = sel.includes(e.key);
              return (
                <button
                  key={`${e.file}:${e.key}`}
                  onClick={() => setSel((s) => (on ? s.filter((k) => k !== e.key) : [...s, e.key]))}
                  onDoubleClick={() => insertAndClose(`\\${cmd}{${[...new Set([...sel, e.key])].join(',')}}$0`)}
                  className={clsx('flex w-full items-start gap-2 border-b border-line/60 px-3 py-2 text-left last:border-0', on ? 'bg-accent/10' : 'hover:bg-hover')}
                >
                  <input type="checkbox" readOnly checked={on} className="mt-1 accent-[var(--c-accent)]" />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-fg">{e.fields.title ?? e.key}</span>
                    <span className="block truncate text-[11px] text-muted">{formatEntry(e)}</span>
                    <span className="font-mono text-[10.5px] text-faint">{e.key}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div className="flex gap-2">
          <TextInput placeholder="Import by DOI, e.g. 10.1145/3292500.3330701" value={doi} onChange={(e) => setDoi(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doi && void importDoi()} />
          <Button icon={<Plus className="size-3.5" />} loading={busy} disabled={!doi.trim()} onClick={() => void importDoi()}>Import</Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function RefWizard() {
  const contentVersion = useStore((s) => s.contentVersion);
  const all = useMemo(() => labels(workspace()?.textFiles('.tex') ?? []), [contentVersion]);
  const [q, setQ] = useState('');
  const main = workspace()?.getText(workspace()?.project.mainFile ?? '') ?? '';
  const pkgs = loadedPackages(main);
  const commands = [...(pkgs.has('cleveref') ? ['cref', 'Cref'] : []), ...(pkgs.has('hyperref') ? ['autoref'] : []), 'ref', 'eqref', 'pageref'];
  const [cmd, setCmd] = useState(commands[0]);
  const shown = all.filter((l) => (l.label + l.context).toLowerCase().includes(q.toLowerCase()));
  const pick = (label: string) => {
    const c = cmd === 'ref' && label.startsWith('eq:') && commands.includes('eqref') ? 'eqref' : cmd;
    if (c === 'eqref') ensurePackage('amsmath');
    insertAndClose(`${c === 'ref' ? '~' : ''}\\${c}{${label}}$0`);
  };
  return (
    <Modal title="Insert cross-reference" icon={<Hash className="size-4 text-accent" />} onClose={closeDialog} width="max-w-xl"
      footer={<><select value={cmd} onChange={(e) => setCmd(e.target.value)} className="focus-ring mr-auto h-8 rounded-md border border-line bg-panel-2 px-2 text-[13px] text-fg">{commands.map((c) => <option key={c} value={c}>\{c}</option>)}</select><Button variant="ghost" onClick={closeDialog}>Cancel</Button></>}>
      <TextInput autoFocus placeholder="Filter labels…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-line">
        {!shown.length ? (
          <div className="p-4 text-center text-xs text-muted">No labels found. Add one with /label (e.g. after a \section or inside a figure).</div>
        ) : (
          shown.map((l) => (
            <button key={`${l.file}:${l.label}`} onClick={() => pick(l.label)} className="flex w-full flex-col items-start border-b border-line/60 px-3 py-2 text-left last:border-0 hover:bg-hover">
              <span className="font-mono text-[12.5px] text-fg">{l.label}</span>
              <span className="w-full truncate text-[11px] text-muted">{l.file}:{l.line} · {l.context}</span>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function SymbolWizard() {
  const [group, setGroup] = useState(0);
  const insert = (sym: string) => {
    const e = editorBridge.get();
    const m = e?.getModel();
    const p = e?.getPosition();
    const inMath = !!(m && p && mathAt(m, p));
    if (sym.includes('mathbb')) ensurePackage('amssymb');
    closeDialog();
    setTimeout(() => editorBridge.insertSnippet(inMath ? `${sym} ` : `$${sym}$`), 20);
  };
  return (
    <Modal title="Symbols" icon={<Sigma className="size-4 text-accent" />} onClose={closeDialog} width="max-w-2xl">
      <div className="mb-3 flex flex-wrap gap-1">
        {SYMBOL_GROUPS.map((g, i) => (
          <button key={g.name} onClick={() => setGroup(i)} className={clsx('rounded-md px-2.5 py-1 text-xs', i === group ? 'bg-accent text-white' : 'bg-panel-2 text-muted hover:text-fg')}>
            {g.name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
        {SYMBOL_GROUPS[group].symbols.map(([cmd]) => (
          <button key={cmd} onClick={() => insert(cmd)} title={cmd} className="flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg border border-line bg-panel-2 hover:border-accent hover:bg-accent/10">
            <MathPreview tex={cmd} display={false} className="pointer-events-none text-lg" />
            <span className="max-w-full truncate px-1 font-mono text-[9px] text-faint">{cmd}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
