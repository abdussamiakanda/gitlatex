/**
 * Settings sections for the gitlatex editor features: Vim mode, spell
 * checking (with the personal dictionary) and the snippet manager.
 */
import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, Upload, Download, X } from 'lucide-react';
import { useStore, updateSettings, toast } from '../state/store';
import { onSpellStatus, removeWordFromDictionary, type SpellStatus } from '../editor/spell';
import { exportSnippetsJson, importSnippets, loadSnippets, onSnippets, saveSnippets, type Snippet, type SnippetScope } from '../editor/snippets';
import { pickFiles } from '../storage/local-disk';
import { downloadBlob } from '../utils/misc';
import { Button, IconButton, TextInput, Toggle, clsx } from './ui';

const VIM_KEYS: [string, string][] = [
  ['Text objects', 'ie/ae environment · i$/a$ math · ic/ac command · id/ad delimiters · iP/aP section · im/am item'],
  ['Motions', ']] [[ sections · ]m [m \\begin · ]M [M \\end · ]n [n math · % pairs \\begin/\\end'],
  ['Change', 'dse cse tse environment · dsc csc tsc command · ds$ cs$ ts$ math · dsd csd tsd \\left…\\right · tsf \\frac'],
  ['Leader', '\\ll compile · \\lv show in PDF · \\lt outline · \\le errors'],
  ['Insert', ']] closes the current environment'],
  ['Ex', ':w · :VimtexCompile · :VimtexView · :VimtexToc · :VimtexErrors'],
];

export function EditorFeatureSettings({ section }: { section: (title: string) => React.ReactNode }) {
  const s = useStore((st) => st.settings);
  const [spell, setSpell] = useState<SpellStatus>({ available: null, userWords: [] });
  const [showKeys, setShowKeys] = useState(false);
  useEffect(() => onSpellStatus(setSpell), []);

  return (
    <>
      {section('Editor')}
      <Toggle label="Vim keybindings" description="Normal, insert and visual modes, with VimTeX-style mappings in .tex files" checked={s.vim} onChange={(v) => updateSettings({ vim: v })} />
      {s.vim && (
        <div className="pb-2">
          <button className="text-[12px] text-accent hover:underline" onClick={() => setShowKeys((v) => !v)}>
            {showKeys ? 'Hide' : 'Show'} the VimTeX keys
          </button>
          {showKeys && (
            <table className="mt-2 w-full text-[11.5px]">
              <tbody>
                {VIM_KEYS.map(([what, keys]) => (
                  <tr key={what} className="align-top">
                    <td className="whitespace-nowrap py-0.5 pr-3 text-muted">{what}</td>
                    <td className="py-0.5 font-mono text-fg">{keys}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {section('Spell checking')}
      <Toggle
        label="Check spelling"
        description={
          spell.available === false
            ? 'Unavailable: install the checker with  pip install symspellpy'
            : 'Underlines unknown words in .tex, .txt and .md files; comments, math and command arguments are skipped. Fix one with Ctrl+. or the lightbulb.'
        }
        checked={s.spellCheck && spell.available !== false}
        onChange={(v) => updateSettings({ spellCheck: v })}
      />
      <div className="pb-2">
        <div className="text-[12px] text-muted">
          Personal dictionary · {spell.userWords.length} word{spell.userWords.length === 1 ? '' : 's'}
        </div>
        {spell.userWords.length > 0 && (
          <div className="mt-1.5 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
            {spell.userWords.map((w) => (
              <span key={w} className="inline-flex items-center gap-1 rounded bg-panel-2 py-0.5 pl-1.5 pr-0.5 text-[11.5px] text-fg">
                {w}
                <button aria-label={`Remove ${w}`} className="rounded p-0.5 text-faint hover:bg-hover hover:text-fg" onClick={() => void removeWordFromDictionary(w)}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {section('Snippets')}
      <SnippetManager />
    </>
  );
}

const EMPTY: Snippet = { prefix: '', body: '', description: '', scope: 'latex' };
const SCOPE_LABEL: Record<SnippetScope, string> = { latex: '.tex', bib: '.bib', all: 'all' };

function SnippetManager() {
  const [list, setList] = useState<Snippet[]>([]);
  const [editing, setEditing] = useState<{ index: number; value: Snippet } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const off = onSnippets(setList);
    void loadSnippets(true);
    return off;
  }, []);

  const save = async (next: Snippet[]) => {
    try {
      await saveSnippets(next);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const submit = async () => {
    if (!editing) return;
    const v = { ...editing.value, prefix: editing.value.prefix.trim(), description: editing.value.description.trim() };
    if (!v.prefix || /\s/.test(v.prefix)) return setError('The prefix must be one word with no spaces.');
    if (!v.body.trim()) return setError('The snippet body is empty.');
    if (list.some((x, i) => i !== editing.index && x.prefix === v.prefix && x.scope === v.scope)) return setError(`Another snippet already uses "${v.prefix}".`);
    const next = list.slice();
    if (editing.index >= 0) next[editing.index] = v;
    else next.push(v);
    if (await save(next)) setEditing(null);
  };

  return (
    <div className="pb-2 text-[13px]">
      <p className="text-[12px] text-muted">
        Type a prefix and press Tab (or pick it from the suggestions) to insert its body. Bodies use tab stops: <code>$1</code>, <code>{'${1:default}'}</code>, <code>{'${1|a,b|}'}</code>, <code>$0</code>. Select text in the editor and right-click → Save
        Selection as Snippet to make one. Saved in <code>~/.gitlatex/snippets.json</code>, shared by all projects.
      </p>

      {list.length > 0 && (
        <div className="mt-2 divide-y divide-line rounded-lg border border-line">
          {list.map((sn, i) => (
            <div key={`${sn.scope}:${sn.prefix}`} className="flex items-center gap-2 px-2 py-1">
              <code className="shrink-0 rounded bg-panel-2 px-1.5 text-[12px] text-accent">{sn.prefix}</code>
              <span className="min-w-0 flex-1 truncate text-[12px] text-muted" title={sn.body}>
                {sn.description || sn.body.split('\n')[0]}
              </span>
              <span className="shrink-0 text-[11px] text-faint">{SCOPE_LABEL[sn.scope]}</span>
              <IconButton size="sm" label="Edit snippet" onClick={() => (setError(null), setEditing({ index: i, value: { ...sn } }))}>
                <Pencil className="size-3.5" />
              </IconButton>
              <IconButton
                size="sm"
                label="Delete snippet"
                onClick={() => {
                  if (editing?.index === i) setEditing(null);
                  void save(list.filter((_, k) => k !== i));
                }}
              >
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="mt-2 space-y-2 rounded-lg border border-accent/40 bg-panel-2 p-3">
          <div className="flex gap-2">
            <label className="block flex-1 text-[12px] text-muted">
              Prefix
              <TextInput className="mt-1" autoFocus placeholder="fig" value={editing.value.prefix} onChange={(e) => setEditing({ ...editing, value: { ...editing.value, prefix: e.target.value } })} />
            </label>
            <label className="block w-28 text-[12px] text-muted">
              Files
              <select
                value={editing.value.scope}
                onChange={(e) => setEditing({ ...editing, value: { ...editing.value, scope: e.target.value as SnippetScope } })}
                className="mt-1 h-8 w-full rounded-md border border-line bg-panel px-2 text-[13px] text-fg"
              >
                <option value="latex">.tex</option>
                <option value="bib">.bib</option>
                <option value="all">All files</option>
              </select>
            </label>
          </div>
          <label className="block text-[12px] text-muted">
            Description
            <TextInput className="mt-1" placeholder="Figure with caption and label" value={editing.value.description} onChange={(e) => setEditing({ ...editing, value: { ...editing.value, description: e.target.value } })} />
          </label>
          <label className="block text-[12px] text-muted">
            Body
            <textarea
              rows={6}
              value={editing.value.body}
              placeholder={'\\begin{figure}[ht]\n  \\centering\n  \\includegraphics[width=${1:0.8}\\linewidth]{$2}\n  \\caption{$3}\n  \\label{fig:$4}\n\\end{figure}$0'}
              onChange={(e) => setEditing({ ...editing, value: { ...editing.value, body: e.target.value } })}
              className="focus-ring mt-1 w-full resize-y rounded-md border border-line bg-panel px-2 py-1.5 font-mono text-[12px] text-fg"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={() => void submit()}>
              Save snippet
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      <div className={clsx('flex flex-wrap gap-2', 'mt-2')}>
        <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => (setError(null), setEditing({ index: -1, value: { ...EMPTY } }))}>
          New snippet
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Upload className="size-3.5" />}
          onClick={async () => {
            const [file] = await pickFiles({ accept: '.json,.code-snippets', multiple: false });
            if (!file) return;
            try {
              const n = await importSnippets(await file.text());
              setError(null);
              toast({ kind: 'success', title: `Imported ${n} snippet${n === 1 ? '' : 's'}` });
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          Import
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Download className="size-3.5" />}
          disabled={!list.length}
          onClick={() => downloadBlob(new Blob([exportSnippetsJson()], { type: 'application/json' }), 'gitlatex-snippets.json')}
        >
          Export
        </Button>
      </div>
    </div>
  );
}
