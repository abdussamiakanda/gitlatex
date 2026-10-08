/**
 * PackageShelf — on-demand TeX Live packages served as static files.
 *
 * See scripts/build-shelf.mjs for how the shelf is produced. Bundles are
 * content-addressed (hash in the file name), so once downloaded they are kept
 * forever in the Cache API and the IDE works offline for those packages.
 */
import { gunzip, parseTar, type TarEntry } from './tar';
import { cachedFetch } from './cache';

export interface ShelfBundle {
  /** Bundle (package) name. */
  n: string;
  /** Archive path relative to the shelf root. */
  f: string;
  /** Compressed size. */
  s: number;
  /** Uncompressed size. */
  u: number;
  /** File count. */
  c: number;
  /** Dependencies (bundle indices). */
  d: number[];
  /** Dependencies provided by optional engine collections (file names). */
  x?: string[];
}

export interface ShelfIndex {
  schema: 1;
  label: string;
  engine: string;
  overlay: { f: string; s: number };
  bundles: ShelfBundle[];
  fonts: Record<string, number>;
  files: string;
}

export const SHELF_CACHE = 'gitlatex-shelf-v1';

export const normaliseFontName = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');

export class PackageShelf {
  readonly mounted = new Set<number>();
  overlayMounted = false;
  private readonly files = new Map<string, number>();
  private readonly lower = new Map<string, number>();

  private constructor(
    readonly root: string,
    readonly index: ShelfIndex,
  ) {
    for (const line of index.files.split('\n')) {
      const tab = line.indexOf('\t');
      if (tab < 0) continue;
      const name = line.slice(0, tab);
      const id = Number(line.slice(tab + 1));
      this.files.set(name, id);
      this.lower.set(name.toLowerCase(), id);
    }
  }

  /** Load the shelf index (network first so updates propagate, cache as offline fallback). */
  static async open(indexUrl: string): Promise<PackageShelf> {
    const res = await cachedFetch(indexUrl, SHELF_CACHE, { networkFirst: true });
    const index = (await res.json()) as ShelfIndex;
    if (index.schema !== 1) throw new Error('Unsupported shelf index');
    return new PackageShelf(new URL('.', indexUrl).href, index);
  }

  get size() {
    return this.index.bundles.length;
  }

  bundleName(id: number) {
    return this.index.bundles[id]?.n ?? `#${id}`;
  }

  resolveFile(name: string): number | undefined {
    return this.files.get(name) ?? this.lower.get(name.toLowerCase());
  }

  resolveFont(name: string): number | undefined {
    const key = normaliseFontName(name);
    if (key in this.index.fonts) return this.index.fonts[key];
    // "TeX Gyre Pagella" often matches "texgyrepagellaregular"; try a prefix match.
    for (const [k, v] of Object.entries(this.index.fonts)) if (k.startsWith(key)) return v;
    return undefined;
  }

  /** Bundles (plus transitive dependencies) not yet mounted. */
  closure(ids: Iterable<number>, limitBytes = 64 * 1048576): number[] {
    const out: number[] = [];
    const seen = new Set<number>();
    let bytes = 0;
    const stack = [...ids];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id) || this.mounted.has(id)) continue;
      seen.add(id);
      const b = this.index.bundles[id];
      if (!b) continue;
      if (bytes + b.s > limitBytes && out.length) continue; // keep huge closures in check; reruns catch the rest
      bytes += b.s;
      out.push(id);
      stack.push(...b.d);
    }
    return out;
  }

  private async fetchArchive(path: string): Promise<TarEntry[]> {
    const res = await cachedFetch(new URL(path, this.root).href, SHELF_CACHE, { immutable: true });
    return parseTar(await gunzip(new Uint8Array(await res.arrayBuffer())));
  }

  /** Download (or read from cache) and mount bundles via `write`. Returns the names mounted. */
  async mount(
    ids: number[],
    write: (path: string, data: Uint8Array) => void,
    onProgress?: (done: number, total: number, name: string) => void,
  ): Promise<string[]> {
    const todo = ids.filter((id) => !this.mounted.has(id));
    const names: string[] = [];
    let done = 0;
    // Fetch in parallel (bounded), mount sequentially.
    const results = await mapLimit(todo, 6, async (id) => {
      const entries = await this.fetchArchive(this.index.bundles[id].f);
      onProgress?.(++done, todo.length, this.bundleName(id));
      return [id, entries] as const;
    });
    for (const [id, entries] of results) {
      for (const e of entries) write(e.path, e.data);
      this.mounted.add(id);
      names.push(this.bundleName(id));
    }
    return names;
  }

  async mountOverlay(write: (path: string, data: Uint8Array) => void): Promise<void> {
    if (this.overlayMounted) return;
    for (const e of await this.fetchArchive(this.index.overlay.f)) write(e.path, e.data);
    this.overlayMounted = true;
  }

  /** How many bundles are already in the browser cache (for the UI). */
  async cachedCount(): Promise<number> {
    try {
      const cache = await caches.open(SHELF_CACHE);
      return (await cache.keys()).filter((r) => r.url.endsWith('.tgz')).length;
    } catch {
      return 0;
    }
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
