/**
 * Cache API helpers used by the compile worker. Engine binaries and package
 * bundles are large and immutable, so we keep them in CacheStorage: the IDE
 * then boots and compiles fully offline after the first visit.
 */

export interface CachedFetchOptions {
  /** The URL's content never changes (hashed file names): serve from cache without revalidating. */
  immutable?: boolean;
  /** Try the network first (to pick up updates), fall back to the cache when offline. */
  networkFirst?: boolean;
  /** Download progress callback. */
  onProgress?: (loaded: number, total: number) => void;
}

const hasCaches = () => typeof caches !== 'undefined';

async function readWithProgress(res: Response, onProgress?: (l: number, t: number) => void): Promise<Uint8Array> {
  const total = Number(res.headers.get('content-length') || 0);
  if (!res.body || !onProgress) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export async function cachedFetch(url: string, cacheName: string, opts: CachedFetchOptions = {}): Promise<Response> {
  const cache = hasCaches() ? await caches.open(cacheName).catch(() => null) : null;

  if (cache && !opts.networkFirst) {
    const hit = await cache.match(url);
    if (hit) return hit;
  }

  try {
    const res = await fetch(url, { cache: opts.immutable ? 'force-cache' : 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const bytes = await readWithProgress(res, opts.onProgress);
    const headers = { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream' };
    if (cache) await cache.put(url, new Response(bytes as BlobPart, { headers })).catch(() => undefined);
    return new Response(bytes as BlobPart, { headers });
  } catch (err) {
    if (cache) {
      const hit = await cache.match(url);
      if (hit) return hit;
    }
    throw err;
  }
}

export async function clearCaches(prefix = 'texbrowser-'): Promise<void> {
  if (!hasCaches()) return;
  for (const key of await caches.keys()) if (key.startsWith(prefix)) await caches.delete(key);
}
