/**
 * Shape of `public/engine/manifest.json`, generated at build time by
 * `scripts/fetch-engine.mjs`. It tells the worker where the WebAssembly
 * binary and the TeX Live data packages live and how to drive them.
 */
export interface EngineDataPackage {
  id: string;
  label: string;
  /** Emscripten loader script (relative to manifest.base). */
  js: string;
  /** LZ4-compressed payload (relative to manifest.base). */
  data: string;
  bytes: number;
  fileCount: number;
  /** Mounted when the engine boots. */
  preload: boolean;
  /**
   * For builds whose packages are nested supersets (extra ⊃ recommended ⊃ basic),
   * the nesting level; null for additive packages.
   */
  supersetLevel: number | null;
  /** Basenames of .sty/.cls/.bst/… files this package provides. */
  provides: string[];
}

export interface EngineManifest {
  schema: 1;
  id: string;
  name: string;
  texlive: string;
  /** TeX engines this build can run. */
  engines: Array<'pdftex' | 'xetex' | 'luatex'>;
  /** Directory of the assets, relative to the manifest URL. */
  base: string;
  js: string;
  wasm: string;
  wasmBytes: number;
  /** Size of the memory snapshot restored between tool invocations. */
  memHeaderBytes: number;
  fmt: { pdftex: string; xetex: string; luahbtex: string };
  env: Record<string, string>;
  features: { kpseRemote: boolean; biber: boolean };
  packages: EngineDataPackage[];
  /** Short content hashes per asset file name (cache busting). */
  hashes?: Record<string, string>;
}

export async function loadManifest(url: string): Promise<EngineManifest> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(
      `TeX engine manifest not found (${res.status} at ${url}). ` +
        'Run "npm run engine:fetch" to download the WebAssembly TeX engine.',
    );
  }
  const manifest = (await res.json()) as EngineManifest;
  if (manifest.schema !== 1) throw new Error(`Unsupported engine manifest schema ${String(manifest.schema)}`);
  return manifest;
}
